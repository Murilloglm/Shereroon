import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createUpdates, readUpdatePrefs } from '../src/updates.mjs';
import { friendlyUpdateError, notesToText, readPublicKeys, signUpdate, verifyDownload } from '../src/update-trust.mjs';

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }), privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};
const official = pair();
const intruder = pair();

function release(dir, version, { key = official.privatePem, content = `instalador ${version}`, signature } = {}) {
  const file = `CosmicNight-Setup-${version}.exe`;
  const path = join(dir, file);
  writeFileSync(path, content);
  const sha512 = createHash('sha512').update(content).digest('base64');
  const info = { version, files: [{ url: file, sha512, size: content.length }], path: file, sha512, releaseNotes: '<p>Novidades</p><ul><li>Chat &amp; voz</li></ul>' };
  info.cosmicSignature = signature ?? signUpdate(key, { version, file, sha512 });
  return { info, path };
}

const withDir = async (run) => {
  const dir = mkdtempSync(join(tmpdir(), 'cn-upd-'));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('aceita só o instalador com SHA-512 e assinatura Ed25519 da chave oficial', () =>
  withDir(async (dir) => {
    const good = release(dir, '0.3.0');
    assert.deepEqual(await verifyDownload(good.info, good.path, [official.publicPem]), { ok: true });
    assert.equal((await verifyDownload(good.info, good.path, [])).reason, 'sem-chave');
    assert.equal((await verifyDownload({ ...good.info, cosmicSignature: undefined }, good.path, [official.publicPem])).reason, 'sem-assinatura');

    const forged = release(dir, '0.3.1', { key: intruder.privatePem });
    assert.equal((await verifyDownload(forged.info, forged.path, [official.publicPem])).reason, 'assinatura', 'assinada com outra chave');

    const swapped = release(dir, '0.3.2');
    writeFileSync(swapped.path, 'outro conteúdo');
    assert.equal((await verifyDownload(swapped.info, swapped.path, [official.publicPem])).reason, 'hash', 'arquivo trocado depois do download');

    // Assinatura válida de uma versão reaproveitada para outra versão: recusada.
    const old = release(dir, '0.3.3');
    const replay = release(dir, '0.3.4', { signature: old.info.cosmicSignature });
    assert.equal((await verifyDownload(replay.info, replay.path, [official.publicPem])).reason, 'assinatura');

    assert.equal((await verifyDownload({ ...good.info, version: '0.3.0\nlatest' }, good.path, [official.publicPem])).reason, 'manifesto');
    assert.equal((await verifyDownload(good.info, join(dir, 'outro.exe'), [official.publicPem])).reason, 'arquivo');

    // Rotação: qualquer uma das chaves embutidas vale.
    assert.deepEqual(await verifyDownload(forged.info, forged.path, [official.publicPem, intruder.publicPem]), { ok: true });
  }));

test('chaves públicas embutidas: só Ed25519 válidas', () =>
  withDir((dir) => {
    const file = join(dir, 'keys.json');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' });
    writeFileSync(file, JSON.stringify({ keys: [official.publicPem, rsa, 'lixo', 3] }));
    assert.deepEqual(readPublicKeys(file), [official.publicPem]);
    assert.deepEqual(readPublicKeys(join(dir, 'nao-existe.json')), []);
  }));

test('novidades em texto simples e erros em português', () => {
  assert.equal(notesToText('<h2>0.3.0</h2><ul><li>Chat &amp; voz</li><li>Corrige <b>eco</b></li></ul><script>alert(1)</script>'), '0.3.0\n\n• Chat & voz\n• Corrige eco');
  assert.equal(notesToText([{ version: '1', note: '<p>a</p>' }, { version: '2', note: 'b' }]), 'a\n\nb');
  assert.equal(notesToText(null), '');
  assert.equal(friendlyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED')).kind, 'offline');
  assert.equal(friendlyUpdateError(new Error('Error: net::ERR_EMPTY_RESPONSE')).kind, 'offline');
  assert.equal(friendlyUpdateError(Object.assign(new Error('x'), { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' })).kind, 'sem-versao');
  assert.equal(friendlyUpdateError(new Error('sha512 checksum mismatch, expected a, got b')).kind, 'integridade');
});

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.next = null;
    this.downloads = 0;
    this.checkError = null;
    this.downloadError = null;
  }
  async checkForUpdates() {
    this.emit('checking-for-update');
    if (this.checkError) {
      this.emit('error', this.checkError);
      throw this.checkError;
    }
    if (this.next) this.emit('update-available', this.next.info);
    else this.emit('update-not-available', {});
  }
  async downloadUpdate() {
    this.downloads += 1;
    if (this.downloadError) {
      this.emit('error', this.downloadError);
      throw this.downloadError;
    }
    this.emit('download-progress', { percent: 50, transferred: 5, total: 10, bytesPerSecond: 100 });
    this.emit('update-downloaded', { ...this.next.info, downloadedFile: this.next.path });
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function harness(dir, overrides = {}) {
  const updater = new FakeUpdater();
  const sent = [];
  const installs = [];
  let now = { inRoom: false, sharing: false };
  const updates = createUpdates({
    updater,
    currentVersion: '0.2.0',
    publicKeys: [official.publicPem],
    prefsDir: dir,
    activity: () => now,
    send: (status) => sent.push(status),
    install: (mode) => installs.push(mode),
    ...overrides,
  });
  return { updater, updates, sent, installs, setActivity: (next) => (now = next) };
}

test('fluxo completo: procura, mostra novidades, baixa só quando pedem, confere e reinicia', () =>
  withDir(async (dir) => {
    const { updater, updates, sent, installs } = harness(dir);
    await updates.check({ manual: true });
    assert.equal(updates.status().state, 'atualizado');
    assert.equal(updates.status().message, 'Você já está na versão mais recente.');

    updater.next = release(dir, '0.3.0');
    await updates.check({ manual: true });
    assert.equal(updates.status().state, 'disponivel');
    assert.equal(updates.status().version, '0.3.0');
    assert.equal(updates.status().notes, 'Novidades\n\n• Chat & voz');
    assert.equal(updater.downloads, 0, 'não baixa sem a pessoa pedir');

    await updates.download();
    await settle();
    assert.ok(sent.some((status) => status.state === 'baixando' && status.percent === 50), 'mostra o progresso');
    assert.equal(updates.status().state, 'pronta');
    assert.deepEqual(await updates.restart(), { ok: true });
    assert.deepEqual(installs, ['agora']);
    assert.equal(updates.status().state, 'instalando');
  }));

test('em chamada ou transmitindo, reiniciar pede confirmação', () =>
  withDir(async (dir) => {
    const { updater, updates, installs, setActivity } = harness(dir);
    updater.next = release(dir, '0.3.0');
    await updates.check();
    await updates.download();
    await settle();
    setActivity({ inRoom: true, sharing: false });
    assert.deepEqual(await updates.restart(), { ok: false, needsConfirm: 'chamada' });
    setActivity({ inRoom: true, sharing: true });
    assert.deepEqual(await updates.restart(), { ok: false, needsConfirm: 'transmissao' });
    assert.deepEqual(installs, []);
    assert.deepEqual(await updates.restart({ confirmed: true }), { ok: true });
    assert.deepEqual(installs, ['agora']);
  }));

test('instalar depois: só ao fechar, e conferindo o arquivo de novo', () =>
  withDir(async (dir) => {
    const { updater, updates, installs } = harness(dir);
    assert.equal(await updates.installOnQuit(), false, 'nada baixado, nada instalado');
    updater.next = release(dir, '0.3.0');
    await updates.check();
    await updates.download();
    await settle();
    updates.later();
    assert.equal(updates.status().installOnQuit, true);
    writeFileSync(updater.next.path, 'trocado no disco');
    assert.equal(await updates.installOnQuit(), false);
    assert.deepEqual(installs, []);
    assert.equal(updates.status().state, 'recusada');
  }));

test('atualização com assinatura falsa é recusada e apagada', () =>
  withDir(async (dir) => {
    const { updater, updates, installs } = harness(dir);
    updater.next = release(dir, '0.3.0', { key: intruder.privatePem });
    await updates.check();
    await updates.download();
    await settle();
    assert.equal(updates.status().state, 'recusada');
    assert.match(updates.status().message, /assinatura/);
    assert.equal(existsSync(updater.next.path), false, 'o arquivo recusado é apagado');
    assert.deepEqual(await updates.restart({ confirmed: true }), { ok: false });
    assert.deepEqual(installs, []);
    updates.dismiss();
    assert.equal(updates.status().state, 'disponivel');
    assert.equal(updates.status().message, null);
  }));

test('sem internet: mensagem clara, e o download pode ser tentado de novo', () =>
  withDir(async (dir) => {
    const { updater, updates } = harness(dir);
    updater.checkError = new Error('net::ERR_INTERNET_DISCONNECTED');
    await updates.check({ manual: true });
    assert.equal(updates.status().messageKind, 'offline');
    updater.checkError = null;
    updater.next = release(dir, '0.3.0');
    await updates.check();
    updater.downloadError = new Error('net::ERR_CONNECTION_RESET');
    await updates.download();
    assert.equal(updates.status().state, 'disponivel', 'volta a poder baixar');
    assert.equal(updates.status().messageKind, 'offline');
    updater.downloadError = null;
    await updates.download();
    await settle();
    assert.equal(updates.status().state, 'pronta');
  }));

test('procurar ao iniciar pode ser desligado e a escolha fica guardada', () =>
  withDir(async (dir) => {
    const { updater, updates } = harness(dir);
    let checks = 0;
    updater.on('checking-for-update', () => (checks += 1));
    updates.setAutoCheck(false);
    assert.deepEqual(readUpdatePrefs(dir), { autoCheck: false });
    updates.start();
    await settle();
    assert.equal(checks, 0);
    updates.stop();
    const again = harness(dir);
    assert.equal(again.updates.status().autoCheck, false);
    again.updates.setAutoCheck(true);
    let rechecks = 0;
    again.updater.on('checking-for-update', () => (rechecks += 1));
    again.updates.start();
    await settle();
    assert.equal(rechecks, 1);
    again.updates.stop();
  }));

test('assinatura do latest.yml no GitHub Actions: lida pelo electron-updater e conferida pelo app', async () => {
  const { signManifestText } = await import('./update-signing.mjs');
  const { load } = (await import('js-yaml')).default;
  const sha = createHash('sha512').update('x').digest('base64');
  const yml = `version: 0.3.0\nfiles:\n  - url: CosmicNight-Setup-0.3.0.exe\n    sha512: ${sha}\n    size: 1\npath: CosmicNight-Setup-0.3.0.exe\nsha512: ${sha}\nreleaseDate: '2026-11-17T12:00:00.000Z'\n`;
  const { text } = signManifestText(yml, official.privatePem, [official.publicPem]);
  const parsed = load(text);
  assert.equal(parsed.version, '0.3.0');
  assert.equal(typeof parsed.cosmicSignature, 'string');
  // Assinar de novo troca a assinatura, não acumula campos.
  const again = signManifestText(text, official.privatePem, [official.publicPem]).text;
  assert.equal(again.match(/cosmicSignature:/g).length, 1);
  await withDir(async (dir) => {
    writeFileSync(join(dir, 'CosmicNight-Setup-0.3.0.exe'), 'x');
    assert.deepEqual(await verifyDownload(parsed, join(dir, 'CosmicNight-Setup-0.3.0.exe'), [official.publicPem]), { ok: true });
  });
  assert.throws(() => signManifestText(yml, intruder.privatePem, [official.publicPem]), /não corresponde/);
  assert.throws(() => signManifestText(yml.replace('url: CosmicNight-Setup-0.3.0.exe', 'url: Outro.exe'), official.privatePem, [official.publicPem]), /ambíguo/);
});

test('gerar chaves nunca sobrescreve e só põe a pública no repositório', async () => {
  const { generateKeys } = await import('./update-signing.mjs');
  await withDir((dir) => {
    const privatePath = join(dir, 'privada.pem');
    const keysFile = join(dir, 'update-keys.json');
    generateKeys(privatePath, keysFile);
    assert.equal(readPublicKeys(keysFile).length, 1);
    assert.doesNotMatch(readFileSync(keysFile, 'utf8'), /PRIVATE/);
    assert.throws(() => generateKeys(privatePath, keysFile), /Não sobrescrevo/);
  });
});
