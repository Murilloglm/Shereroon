import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeChecksums } from './write-checksums.mjs';
import { writePreviewChecksums } from './write-preview-checksums.mjs';
const require = createRequire(import.meta.url);
const { createSigningConfig } = require('./windows-signing.cjs');
const preserveUninstaller = require('./preserve-uninstaller.cjs');
const base = { SHAREROOM_REQUIRE_SIGNING: '1', SHAREROOM_PUBLISHER_NAME: 'Editor validado' };

test('preview público mantém fuses, recusa assinatura/test hooks e não habilita updater', () => {
  const run = extra => spawnSync(process.execPath, ['-e', `const c=require(${JSON.stringify(require.resolve('../electron-builder.preview.config.cjs'))});process.stdout.write(JSON.stringify(c));`], {
    encoding: 'utf8', env: { ...process.env, SHAREROOM_REQUIRE_SIGNING: '0', SHAREROOM_SIGNING_PROVIDER: '', SHAREROOM_TEST_BUILD: '0', ...extra },
  });
  const result = run({});
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.publish, null);
  assert.equal(config.win.signExecutable, false);
  assert.equal(config.electronFuses.onlyLoadAppFromAsar, true);
  assert.equal(config.directories.output, 'release-preview');
  assert.notEqual(run({ SHAREROOM_REQUIRE_SIGNING: '1' }).status, 0);
  assert.notEqual(run({ SHAREROOM_SIGNING_PROVIDER: 'signtool' }).status, 0);
  assert.notEqual(run({ SHAREROOM_TEST_BUILD: '1' }).status, 0);
});

test('preview só publica hashes quando a auditoria unsigned corresponde aos bytes finais', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'shareroom-preview-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const installer = 'CosmicNight-Setup-0.1.0.exe';
  await writeFile(join(dir, installer), 'preview');
  const sha256 = createHash('sha256').update('preview').digest('hex');
  const report = { requireValid: false, files: [{ path: installer, status: 'NotSigned', sha256 }] };
  await writeFile(join(dir, 'signature-report.json'), JSON.stringify(report));
  await writePreviewChecksums(dir);
  assert.equal(await readFile(join(dir, `${installer}.sha256`), 'utf8'), `${sha256}  ${installer}\n`);
  await writeFile(join(dir, installer), 'bytes alterados depois da auditoria');
  await assert.rejects(writePreviewChecksums(dir), /não corresponde/);
  report.requireValid = true;
  await writeFile(join(dir, 'signature-report.json'), JSON.stringify(report));
  await assert.rejects(writePreviewChecksums(dir), /somente/);
});

test('release exige um provedor e a identidade real; preview não assina automaticamente', () => {
  assert.equal(createSigningConfig({}).options.signExecutable, false);
  assert.throws(() => createSigningConfig(base), /PROVIDER/);
  assert.throws(() => createSigningConfig({ ...base, SHAREROOM_SIGNING_PROVIDER: 'self-signed' }), /PROVIDER/);
  assert.throws(() => createSigningConfig({ SHAREROOM_SIGNING_PROVIDER: 'signtool' }), /PUBLISHER_NAME/);
  assert.throws(() => createSigningConfig({ ...base, SHAREROOM_TEST_BUILD: '1' }), /TEST_BUILD/);
});

test('assinatura exige um método, SHA256, DLLs e identidade para updates', () => {
  const env = { ...base, SHAREROOM_SIGNING_PROVIDER: 'signtool', SHAREROOM_CERTIFICATE_SHA1: 'A'.repeat(40) };
  const { options } = createSigningConfig(env);
  assert.equal(options.forceCodeSigning, true);
  assert.equal(options.verifyUpdateCodeSignature, true);
  assert.deepEqual(options.signExts, ['.exe', '.dll', '.node']);
  assert.deepEqual(options.signtoolOptions.signingHashAlgorithms, ['sha256']);
  assert.equal(options.signtoolOptions.publisherName, base.SHAREROOM_PUBLISHER_NAME);
  assert.throws(() => createSigningConfig({ ...env, SHAREROOM_CERTIFICATE_SHA1: 'invalido' }), /thumbprint/);
  assert.throws(() => createSigningConfig({ ...env, WIN_CSC_LINK: 'segredo' }), /exatamente um/);
  assert.throws(() => createSigningConfig({ ...env, SHAREROOM_CERTIFICATE_SHA1: '' }), /exatamente um/);
  const remote = createSigningConfig({ ...base, SHAREROOM_SIGNING_PROVIDER: 'signtool', SHAREROOM_SIGN_HOOK: './scripts/provedor.cjs' });
  assert.equal(remote.options.signtoolOptions.sign, './scripts/provedor.cjs');
});

test('Azure exige perfil/conta e endpoint HTTPS; segredos ficam só no ambiente', () => {
  const env = { ...base, SHAREROOM_SIGNING_PROVIDER: 'azure', SHAREROOM_AZURE_ENDPOINT: 'https://eus.codesigning.azure.net',
    SHAREROOM_AZURE_ACCOUNT: 'conta', SHAREROOM_AZURE_PROFILE: 'public-trust', AZURE_CLIENT_SECRET: 'nao-serializar' };
  const { options } = createSigningConfig(env);
  assert.equal(options.azureSignOptions.fileDigest, 'SHA256');
  assert.equal(options.azureSignOptions.timestampDigest, 'SHA256');
  assert.equal(JSON.stringify(options).includes(env.AZURE_CLIENT_SECRET), false);
  assert.equal(options.signtoolOptions, undefined);
  assert.throws(() => createSigningConfig({ ...env, SHAREROOM_AZURE_PROFILE: '' }), /PROFILE/);
  assert.throws(() => createSigningConfig({ ...env, SHAREROOM_AZURE_ENDPOINT: 'http://example.test' }), /HTTPS/);
  assert.throws(() => createSigningConfig({ ...env, CSC_LINK: 'segredo' }), /combinado/);
});

test('hashes usam os bytes finais e só assets de distribuição; pastas ambíguas falham', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'shareroom-checksums-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const installer = 'CosmicNight-Setup-1.2.3.exe';
  const assets = [installer, `${installer}.blockmap`, 'latest.yml', 'signature-report.json'];
  for (const name of assets) await writeFile(join(dir, name), `final:${name}`);
  await writeFile(join(dir, 'builder-debug.yml'), 'interno');
  await writeFile(join(dir, 'CosmicNight-Setup-1.2.3.__uninstaller.exe'), 'temporario');
  assert.deepEqual(await writeChecksums(dir), assets);
  const expected = assets.map(name => `${createHash('sha256').update(`final:${name}`).digest('hex')}  ${name}\n`).join('');
  assert.equal(await readFile(join(dir, 'SHA256SUMS.txt'), 'utf8'), expected);
  assert.equal(await readFile(join(dir, `${installer}.sha256`), 'utf8'), expected.split('\n')[0] + '\n');
  await rm(join(dir, 'latest.yml'));
  await assert.rejects(writeChecksums(dir), /ENOENT/);
  await writeFile(join(dir, 'CosmicNight-Setup-1.2.4.exe'), 'outra versão');
  await assert.rejects(writeChecksums(dir), /exatamente um/);
});

test('preserva bytes do desinstalador depois de assinar e rejeita assinatura omitida', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'shareroom-uninstaller-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'out'));
  const file = join(dir, 'CosmicNight-Setup-1.2.3.__uninstaller.exe');
  const packager = { signIf: async path => { await writeFile(path, 'bytes-assinados'); return true; } };
  await preserveUninstaller({ packager, outDir: join(dir, 'out'), electronPlatformName: 'win32' });
  assert.equal(await packager.signIf(file), true);
  assert.equal(await readFile(join(dir, 'out/signing-audit/ShareRoom-uninstaller.exe'), 'utf8'), 'bytes-assinados');
  const bad = { signIf: async () => false };
  await preserveUninstaller({ packager: bad, outDir: dir, electronPlatformName: 'win32' });
  await assert.rejects(bad.signIf(file), /não foi assinado/);
});
