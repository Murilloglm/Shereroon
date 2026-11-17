// Teste REAL de atualização entre duas versões instaladas (Windows). Não roda no "npm test": demora alguns
// minutos e instala uma cópia de teste por usuário. Uso: npm --prefix desktop run test:update
//
// 1. Gera um par de chaves de TESTE e compila duas versões (0.0.1 e 0.0.2) da cópia "CosmicNightUpdateTest",
//    que tem outro nome, outro identificador e outra pasta: o Cosmic Night instalado de verdade não é tocado.
// 2. Instala a 0.0.1 sem administrador e grava um arquivo na pasta de dados dela.
// 3. Sem servidor: a 0.0.1 avisa que está sem conexão e continua funcionando.
// 4. Servidor com a 0.0.2 assinada por OUTRA chave: a 0.0.1 recusa, apaga o arquivo e continua na 0.0.1.
// 5. Servidor com a 0.0.2 assinada pela chave certa: baixa, confere, instala sozinha e reabre já na 0.0.2,
//    no mesmo lugar, com os dados preservados e sem uma segunda instalação.
// 6. Desinstala a cópia de teste e apaga tudo o que criou.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { signManifestText } from './update-signing.mjs';

if (process.platform !== 'win32') throw new Error('Este teste instala um aplicativo de Windows.');
const require = createRequire(import.meta.url);
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'CosmicNightUpdateTest';
const EXE = `${NAME}.exe`;
const appData = process.env.APPDATA;
const userData = join(appData, NAME);
const work = mkdtempSync(join(tmpdir(), 'cn-update-real-'));
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Falhou: ${name}${detail ? ` (${detail})` : ''}`);
};
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// --- chaves de teste ------------------------------------------------------------------------------
const pem = (pair) => ({ publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }), privatePem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const testKey = pem(generateKeyPairSync('ed25519'));
const otherKey = pem(generateKeyPairSync('ed25519'));
const keysFile = join(work, 'update-keys.json');
writeFileSync(keysFile, JSON.stringify({ keys: [testKey.publicPem] }));
const flagFile = join(work, 'update-test.json');
writeFileSync(flagFile, '{ "selfTest": true }\n');

// --- servidor local de versões ----------------------------------------------------------------------
let mode = 'offline';
const serveDir = join(work, 'servidor');
mkdirSync(serveDir);
const requests = [];
const server = createServer((req, res) => {
  requests.push(`${mode} ${req.method} ${req.url}`);
  if (mode === 'offline') {
    req.socket.destroy();
    return;
  }
  const name = basename(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = join(serveDir, mode, name);
  if (!name || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-length': statSync(file).size, 'content-type': 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const feed = `http://127.0.0.1:${server.address().port}/`;

// --- utilidades -------------------------------------------------------------------------------------
function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', env }).trim();
}
function installs() {
  const raw = powershell(
    `Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like '${NAME}*' } | ForEach-Object { "$($_.DisplayVersion)|$($_.InstallLocation)|$($_.QuietUninstallString)" }`,
  );
  // O NSIS por usuário não grava InstallLocation: a pasta é a do desinstalador.
  return raw ? raw.split(/\r?\n/).map((line) => {
    const [version, , quiet = ''] = line.split('|');
    const exe = /^"([^"]+)"/.exec(quiet)?.[1] ?? '';
    return { version, location: exe ? dirname(exe) : '', uninstall: exe ? { exe, args: quiet.slice(exe.length + 2).trim().match(/\S+/g) ?? [] } : null };
  }) : [];
}
function uninstallAll() {
  for (const entry of installs()) if (entry.uninstall) spawnSync(entry.uninstall.exe, entry.uninstall.args, { stdio: 'ignore', env });
}
function exeVersion(location) {
  return powershell(`(Get-Item -LiteralPath '${join(location, EXE).replace(/'/g, "''")}').VersionInfo.FileVersion`);
}
function killTestApp() {
  spawnSync('taskkill.exe', ['/IM', EXE, '/T', '/F'], { stdio: 'ignore' });
}
function readLog() {
  const file = join(userData, 'atualizacao-teste.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return {};
    }
  });
}
async function until(test, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = test();
    if (found) return found;
    await wait(500);
  }
  throw new Error(`Tempo esgotado esperando: ${label}. Últimas linhas do registro: ${JSON.stringify(readLog().slice(-5))}`);
}
function launch(location) {
  rmSync(join(userData, 'atualizacao-teste.jsonl'), { force: true });
  const child = spawn(join(location, EXE), ['--minimizado'], { env, detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}
function build(version) {
  const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'nsis', '--config', 'electron-builder.update-test.config.cjs', '--publish', 'never'], {
    cwd: desktop,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...env, SHAREROOM_UPDATE_TEST_URL: feed, SHAREROOM_UPDATE_TEST_VERSION: version, SHAREROOM_UPDATE_TEST_FLAG: flagFile, SHAREROOM_UPDATE_KEYS: keysFile },
  });
  if (result.status !== 0) throw new Error(`Falha ao compilar ${version}:\n${(result.stdout + result.stderr).slice(-3000)}`);
  return join(desktop, 'release-update-test', version);
}
const elevated = () => spawnSync('net.exe', ['session'], { stdio: 'ignore' }).status === 0;

// --- teste -------------------------------------------------------------------------------------------
const configFile = join(desktop, 'src', 'config.json');
const configBackup = existsSync(configFile) ? readFileSync(configFile) : null;
let failure = null;
try {
  killTestApp();
  uninstallAll();
  rmSync(userData, { recursive: true, force: true });
  step('o terminal não está como administrador (a instalação tem de funcionar sem)', !elevated());

  // Interface local: a cópia de teste não conversa com o servidor de produção.
  writeFileSync(configFile, `${JSON.stringify({ connectionMode: 'local', apiUrl: 'http://localhost:8787', siteUrl: '' }, null, 2)}\n`);
  console.log(`Compilando 0.0.1 e 0.0.2 (servidor de teste em ${feed})…`);
  const dirA = build('0.0.1');
  const dirB = build('0.0.2');
  step('as duas versões trazem o canal de atualização', existsSync(join(dirA, 'win-unpacked', 'resources', 'app-update.yml')) && existsSync(join(dirB, 'latest.yml')));

  // Versão boa: latest.yml assinado com a chave de teste. Versão adulterada: mesma 0.0.2, outra chave.
  const installerB = `${NAME}-Setup-0.0.2.exe`;
  for (const [folder, key, keys] of [['boa', testKey.privatePem, [testKey.publicPem]], ['adulterada', otherKey.privatePem, [otherKey.publicPem]]]) {
    mkdirSync(join(serveDir, folder));
    copyFileSync(join(dirB, installerB), join(serveDir, folder, installerB));
    writeFileSync(join(serveDir, folder, 'latest.yml'), signManifestText(readFileSync(join(dirB, 'latest.yml'), 'utf8'), key, keys).text);
  }

  // Instala a 0.0.1 (silenciosa, por usuário).
  const setupA = spawnSync(join(dirA, `${NAME}-Setup-0.0.1.exe`), ['/S'], { stdio: 'ignore', env });
  step('instalou a 0.0.1 sem administrador', setupA.status === 0, `código ${setupA.status}`);
  const [installed] = installs();
  step('uma instalação registrada só para este usuário', installs().length === 1 && /\\AppData\\Local\\/i.test(installed.location ?? ''), installed?.location);
  step('o executável instalado é a 0.0.1', exeVersion(installed.location) === '0.0.1');

  // Primeira abertura cria a pasta de dados; o marcador simula preferências e sessão da pessoa.
  mode = 'offline';
  launch(installed.location);
  const offline = await until(() => readLog().find((line) => line.messageKind === 'offline'), 60_000, 'aviso de sem conexão');
  step('sem conexão: aviso claro e o aplicativo segue aberto', /Sem conexão/.test(offline.message) && powershell(`@(Get-Process -Name ${NAME} -ErrorAction SilentlyContinue).Count`) !== '0', offline.message);
  writeFileSync(join(userData, 'marcador-do-teste.txt'), 'dados da pessoa');
  killTestApp();
  await wait(1500);

  mode = 'adulterada';
  launch(installed.location);
  const rejected = await until(() => readLog().find((line) => line.rejected), 120_000, 'recusa da versão adulterada');
  step('versão com assinatura de outra chave é recusada', rejected.rejected === 'assinatura', rejected.rejected);
  await wait(2000);
  step('nada foi instalado: continua na 0.0.1', exeVersion(installed.location) === '0.0.1' && installs().length === 1);
  killTestApp();
  await wait(1500);

  mode = 'boa';
  launch(installed.location);
  await until(() => readLog().find((line) => line.state === 'pronta' && line.running === '0.0.1'), 120_000, 'download conferido da 0.0.2');
  step('baixou a 0.0.2 e a assinatura conferiu', true);
  // A 0.0.1 fecha, o instalador roda em silêncio e reabre o aplicativo, que já registra como 0.0.2.
  const after = await until(() => readLog().find((line) => line.running === '0.0.2' && (line.state === 'atualizado' || line.state === 'verificando')), 180_000, 'reabrir na 0.0.2');
  step('reabriu sozinho já na 0.0.2', Boolean(after));
  const now = installs();
  step('continua uma instalação só, no mesmo lugar', now.length === 1 && now[0].location === installed.location && now[0].version === '0.0.2', JSON.stringify(now));
  step('o executável instalado é a 0.0.2', exeVersion(installed.location) === '0.0.2');
  step('os dados da pessoa foram preservados', readFileSync(join(userData, 'marcador-do-teste.txt'), 'utf8') === 'dados da pessoa');
  step('o servidor só recebeu pedidos do manifesto e do instalador', requests.every((line) => /latest\.yml|\.exe|\.blockmap/.test(line)), requests.slice(-4).join(' ; '));
} catch (error) {
  failure = error;
} finally {
  killTestApp();
  await wait(1000);
  uninstallAll();
  // O desinstalador se copia para a pasta temporária e termina em segundo plano.
  for (let i = 0; i < 60 && installs().length > 0; i += 1) await wait(500);
  rmSync(userData, { recursive: true, force: true });
  rmSync(join(process.env.LOCALAPPDATA, 'cosmicnight-update-test-updater'), { recursive: true, force: true });
  if (configBackup) writeFileSync(configFile, configBackup);
  server.close();
  rmSync(work, { recursive: true, force: true });
  console.log(`Limpeza: ${installs().length === 0 ? 'cópia de teste desinstalada' : 'ATENÇÃO: sobrou uma instalação de teste'}.`);
}
if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
} else {
  console.log(`\n${results.length} verificações do teste real de atualização passaram.`);
}
