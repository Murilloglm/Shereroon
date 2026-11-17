// ShareRoom para Windows. A interface é a mesma do site, servida de dentro do aplicativo (app://shareroom),
// e o que o navegador não oferece vem daqui: seletor próprio de telas e janelas, áudio do computador e por
// aplicativo sem instalar nada à parte, bandeja do sistema, funcionamento em segundo plano e atualização.
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, nativeTheme, powerSaveBlocker, protocol, session, shell, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeConnection } from './connection-config.mjs';
import { DEEP_SCHEME, linkFromArgv } from './deep-link.mjs';
import { cleanAutostart, HIDDEN_FLAG, loginItemFor, readAutostart, writeAutostart } from './autostart.mjs';
import { contentSecurityPolicy } from './csp.mjs';
import { readPublicKeys } from './update-trust.mjs';
import { createUpdates } from './updates.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEME = 'app';
const HOST = 'shareroom';
const ORIGIN = `${SCHEME}://${HOST}`;
const E2E = process.env.SHAREROOM_E2E === '1';

const resource = (packagedPath, devPath) => (app.isPackaged ? join(process.resourcesPath, packagedPath) : resolve(here, devPath));
const WEB_ROOT = resource('web', '../../web/dist');
const HELPER_EXE = resource('helper/ShareRoomAudio.exe', '../../helper/bin/ShareRoomAudio.exe');
const ICON = resource('icon.png', '../build/icon.png');
/** Chaves públicas que podem assinar atualizações (não são segredo). */
const UPDATE_KEYS = resource('update-keys.json', '../update-keys.json');
/** Cópia gerada só para o teste automatizado da atualização (nunca vai para uma versão publicada). */
const UPDATE_TEST = app.isPackaged && existsSync(join(process.resourcesPath, 'update-test.json'));
/** Canal: as pré-versões sem certificado vêm marcadas como prerelease no GitHub. */
const UPDATE_CHANNEL = (() => {
  try {
    return JSON.parse(readFileSync(resource('update-channel.json', '../build/update-channel-preview.json'), 'utf8'));
  } catch {
    return {};
  }
})();

// Pasta de dados própria para testes automatizados: não mistura com a do aplicativo instalado.
if (process.env.SHAREROOM_USER_DATA) app.setPath('userData', process.env.SHAREROOM_USER_DATA);
else if (UPDATE_TEST) app.setPath('userData', join(app.getPath('appData'), 'CosmicNightUpdateTest'));
// O aplicativo mudou de nome (era ShareRoom), mas continua na mesma pasta de dados: quem já usava não perde
// a conta conectada, as salas recentes nem as preferências.
else app.setPath('userData', join(app.getPath('appData'), 'ShareRoom'));

/** Endereço do backend e do site público. Vêm do arquivo gerado na compilação; variáveis de ambiente valem por cima. */
function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(readFileSync(resolve(here, 'config.json'), 'utf8'));
  } catch {
    // sem arquivo: uso local, com o backend na própria máquina
  }
  return runtimeConnection(file, process.env, app.isPackaged);
}

let config;
let connectionError = false;
try {
  config = loadConfig();
} catch {
  connectionError = true;
}
let win = null;
let tray = null;
let quitting = false;
let helper = null;
let helperPort = null;
let helperRestarts = 0;
let sleepBlocker = null;
let warnedAboutTray = false;
let roomState = { inRoom: false, sharing: false, micOn: false, roomName: null };
/** Fonte que a pessoa acabou de escolher no seletor. Vale para uma captura só, por poucos segundos. */
let armedSource = null;
/** Fontes mostradas na última listagem: só elas podem ser escolhidas. */
const knownSources = new Set();
let externalOpener = (url) => shell.openExternal(url);

// ---------------------------------------------------------------------------------------------
// Interface servida de dentro do aplicativo

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// A página só carrega código de dentro do aplicativo; imagens também do backend configurado (fotos de perfil,
// banners e emojis). Detalhes em csp.mjs.
const CSP = contentSecurityPolicy(config?.apiUrl);

async function serveApp(request) {
  const url = new URL(request.url);
  if (url.host !== HOST || request.method !== 'GET') return new Response('', { status: 404 });
  const path = decodeURIComponent(url.pathname);
  const file = resolve(WEB_ROOT, `.${path === '/' ? '/index.html' : path}`);
  // Nada fora da pasta da interface.
  if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + sep)) return new Response('', { status: 403 });
  try {
    const body = await readFile(file);
    return new Response(body, {
      headers: {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-security-policy': CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache',
      },
    });
  } catch {
    return new Response('', { status: 404 });
  }
}

const fromApp = (url) => typeof url === 'string' && (url === ORIGIN || url.startsWith(`${ORIGIN}/`));
/** A mensagem veio da nossa janela, da página do próprio aplicativo? */
const trusted = (event) => Boolean(win) && event.sender === win.webContents && fromApp(event.senderFrame?.url);

// ---------------------------------------------------------------------------------------------
// Componente de áudio (captura por aplicativo e do sistema, pelo WASAPI). Sobe junto com o aplicativo,
// numa porta livre de 127.0.0.1, aceitando somente a página deste aplicativo.

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

function startHelper() {
  if (process.platform !== 'win32' || !existsSync(HELPER_EXE) || helperPort === null) return;
  const child = spawn(HELPER_EXE, ['--console', '--no-prompt', '--port', String(helperPort), '--allow-origin', ORIGIN], {
    // A entrada padrão fica aberta de propósito: quando o aplicativo fecha (ou cai), ela fecha e o componente
    // encerra sozinho, soltando todas as capturas.
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
  });
  helper = child;
  child.on('error', () => undefined);
  child.on('exit', () => {
    if (helper === child) helper = null;
    // Caiu com o aplicativo aberto: tenta de novo na mesma porta, algumas vezes.
    if (!quitting && helperRestarts < 5) {
      helperRestarts += 1;
      setTimeout(startHelper, 1000 * helperRestarts);
    }
  });
}

function stopHelper() {
  const child = helper;
  helper = null;
  if (!child) return;
  try {
    child.stdin.end();
  } catch {
    // já tinha fechado
  }
  setTimeout(() => child.exitCode === null && child.kill(), 1500).unref();
}

// ---------------------------------------------------------------------------------------------
// Captura de tela: o aplicativo só libera a fonte que a pessoa escolheu no seletor, uma vez.

const SOURCE_TYPES = ['screen', 'window'];

async function listSources() {
  // O identificador é "window:<janela>:<n>"; o último número varia, então a comparação é pela janela.
  const own = win?.getMediaSourceId().split(':')[1];
  const sources = await desktopCapturer.getSources({ types: SOURCE_TYPES, thumbnailSize: { width: 384, height: 216 }, fetchWindowIcons: true });
  knownSources.clear();
  return sources
    // A própria janela do ShareRoom fica de fora (seria um espelho dentro do espelho).
    .filter((source) => !(source.id.startsWith('window:') && source.id.split(':')[1] === own))
    .map((source) => {
      knownSources.add(source.id);
      return {
        id: source.id,
        name: source.name,
        kind: source.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
        icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
      };
    });
}

function installCapture(ses) {
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const choice = armedSource;
    armedSource = null;
    const deny = () => {
      try {
        callback();
      } catch {
        // versões que exigem um objeto: sem vídeo nem áudio o pedido é recusado do mesmo jeito
      }
    };
    if (!choice || choice.expires < Date.now() || !fromApp(request.frame?.url)) return deny();
    desktopCapturer
      .getSources({ types: SOURCE_TYPES, thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const source = sources.find((item) => item.id === choice.id);
        // Só vídeo: o som vem do componente de áudio, que deixa de fora o próprio ShareRoom (sem eco).
        if (source) callback({ video: source });
        else deny();
      })
      .catch(deny);
  });
}

// ---------------------------------------------------------------------------------------------
// Bandeja do sistema

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Link de convite que abriu o aplicativo (ou chegou à instância que já estava aberta). Fica guardado até a
// interface pegar: assim nenhum se perde enquanto a janela ainda carrega.
let pendingLink = linkFromArgv(process.argv);
const startHidden = process.argv.includes(HIDDEN_FLAG) && !pendingLink;

/** Iniciar com o Windows. No app instalado vai para a lista de inicialização do usuário; nos testes, só para o arquivo. */
function autostartState() {
  const saved = readAutostart(app.getPath('userData'));
  const supported = process.platform === 'win32' && (app.isPackaged || E2E);
  if (app.isPackaged) {
    // A pessoa pode ter desligado pelo Gerenciador de Tarefas: vale o que o Windows diz.
    saved.enabled = app.getLoginItemSettings({ path: process.execPath, args: saved.minimized ? [HIDDEN_FLAG] : [] }).openAtLogin;
  }
  return { ...saved, supported };
}

function setAutostart(input) {
  const next = cleanAutostart(input, readAutostart(app.getPath('userData')));
  if (app.isPackaged) {
    // Tira a entrada antiga (com ou sem a marca de minimizado) antes de gravar a nova.
    app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: [HIDDEN_FLAG] });
    app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: [] });
    app.setLoginItemSettings(loginItemFor(next, process.execPath));
  }
  writeAutostart(app.getPath('userData'), next);
  return autostartState();
}

function deliverLink(link) {
  if (!link) return;
  pendingLink = link;
  showWindow();
  win?.webContents.send('desktop:link');
}

const command = (name) => win?.webContents.send('desktop:command', name);

function trayTemplate() {
  const state = roomState;
  return [
    { label: 'Abrir o Cosmic Night', click: showWindow },
    { type: 'separator' },
    { label: state.inRoom ? `Sala: ${state.roomName || 'sem nome'}` : 'Você não está em uma sala', enabled: false },
    { label: state.micOn ? 'Desligar o microfone' : 'Ligar o microfone', enabled: state.inRoom, click: () => command('toggle-mic') },
    { label: 'Parar de transmitir a tela', enabled: state.sharing, click: () => command('stop-share') },
    { label: 'Sair da sala', enabled: state.inRoom, click: () => command('leave') },
    { type: 'separator' },
    { label: 'Fechar o Cosmic Night', click: quit },
  ];
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
  tray.setToolTip(roomState.sharing ? 'Cosmic Night — transmitindo a sua tela' : roomState.inRoom ? `Cosmic Night — ${roomState.roomName || 'em uma sala'}` : 'Cosmic Night');
}

function createTray() {
  const image = nativeImage.createFromPath(ICON);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 32, height: 32, quality: 'best' }));
  tray.on('click', showWindow);
  refreshTray();
}

function applyRoomState(next) {
  roomState = {
    inRoom: next?.inRoom === true,
    sharing: next?.sharing === true,
    micOn: next?.micOn === true,
    roomName: typeof next?.roomName === 'string' ? next.roomName.slice(0, 80) : null,
  };
  refreshTray();
  // Transmitindo: a tela não apaga nem entra em descanso no meio da transmissão.
  if (roomState.sharing && sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
  if (!roomState.sharing && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
  }
}

function quit() {
  quitting = true;
  app.quit();
}

// ---------------------------------------------------------------------------------------------
// Atualização automática (só existe no aplicativo instalado a partir de uma versão publicada)
//
// O instalador novo vem por HTTPS da página de versões do GitHub. Antes de rodar, precisa bater com o SHA-512
// publicado E com a assinatura Ed25519 feita no GitHub Actions (chave privada nos Secrets; a pública vai
// embutida aqui). Nas versões assinadas com certificado, o Windows também confere o autor. Nada é baixado nem
// instalado sem a pessoa pedir, e reiniciar no meio de uma chamada pede confirmação.

let updates = null;
let updateStatus = { supported: false, currentVersion: app.getVersion(), state: 'indisponivel', reason: null, message: null };

function sendUpdate(status) {
  updateStatus = { ...status, supported: true, reason: null };
  win?.webContents.send('update:status', updateStatus);
}

/** Só nas cópias de teste da atualização: registra cada passo num arquivo para o teste ler. */
function updateTestLog(entry) {
  try {
    appendFileSync(join(app.getPath('userData'), 'atualizacao-teste.jsonl'), `${JSON.stringify({ ...entry, running: app.getVersion() })}\n`);
  } catch {
    // só diagnóstico
  }
}

async function setupUpdater() {
  if (!app.isPackaged || !existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    updateStatus.reason = app.isPackaged
      ? 'Esta cópia veio de um instalador sem canal de atualização. Instale a versão nova uma vez pela página de downloads; a partir dela, o Cosmic Night se atualiza sozinho.'
      : 'A atualização automática só existe no aplicativo instalado.';
    return;
  }
  const publicKeys = readPublicKeys(UPDATE_KEYS);
  if (publicKeys.length === 0) {
    updateStatus.reason = 'Esta cópia não tem a chave para conferir atualizações, então não instala nenhuma sozinha. Baixe a versão nova pela página de downloads.';
    return;
  }
  const { default: module } = await import('electron-updater');
  const updater = module.autoUpdater;
  updater.autoDownload = false;
  // A instalação ao fechar é feita por nós (em before-quit), depois de conferir o arquivo de novo.
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = UPDATE_CHANNEL.prerelease === true;
  updater.disableWebInstaller = true;
  if (UPDATE_TEST) updater.logger = { info: () => {}, warn: (m) => updateTestLog({ warn: String(m).slice(0, 300) }), error: (m) => updateTestLog({ fail: String(m).slice(0, 300) }), debug: () => {} };
  updates = createUpdates({
    updater,
    currentVersion: app.getVersion(),
    publicKeys,
    prefsDir: app.getPath('userData'),
    activity: () => roomState,
    send: sendUpdate,
    // Instalação silenciosa por usuário (sem administrador), no mesmo lugar da atual e com os dados intactos.
    install: (mode) => {
      quitting = true;
      updater.quitAndInstall(true, mode === 'agora');
    },
    selfTest: UPDATE_TEST,
    log: UPDATE_TEST ? updateTestLog : undefined,
  });
  sendUpdate(updates.status());
  updates.start();
}

// ---------------------------------------------------------------------------------------------
// Janela

const ALLOWED_PERMISSIONS = new Set([
  'media', // microfone, quando a pessoa clica em ligar
  'display-capture',
  'fullscreen',
  'clipboard-sanitized-write',
  'speaker-selection',
  // Conversa com o componente de áudio em 127.0.0.1:
  'local-network-access',
  'loopback-network',
  'local-network',
]);

function createWindow() {
  win = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 420,
    minHeight: 620,
    show: false,
    title: 'Cosmic Night',
    backgroundColor: '#0b0914',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: resolve(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // Com o jogo em primeiro plano, a janela do ShareRoom fica coberta ou minimizada: as medições e o
      // ajuste automático de qualidade continuam no ritmo normal.
      backgroundThrottling: false,
    },
  });
  // Aberto pelo Windows com "iniciar minimizado": fica só na bandeja até a pessoa abrir.
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });
  win.on('close', (event) => {
    if (quitting || !roomState.inRoom) return;
    // Em uma sala, fechar a janela não derruba a transmissão: o aplicativo continua na bandeja.
    event.preventDefault();
    win.hide();
    if (!warnedAboutTray) {
      warnedAboutTray = true;
      tray?.displayBalloon({ title: 'O Cosmic Night continua aberto', content: 'Você segue na sala. Para sair de vez, use o ícone perto do relógio.' });
    }
  });
  win.on('closed', () => {
    win = null;
  });

  const contents = win.webContents;
  // A janela nunca sai da interface do aplicativo; links para fora abrem no navegador padrão.
  contents.on('will-navigate', (event, url) => {
    if (!fromApp(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!fromApp(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void externalOpener(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  if (!app.isPackaged) {
    contents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') contents.toggleDevTools();
    });
  }
  void win.loadURL(`${ORIGIN}/index.html`);
}

function installPermissions(ses) {
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === win?.webContents && fromApp(details.requestingUrl ?? contents.getURL()) && ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => fromApp(requestingOrigin) && ALLOWED_PERMISSIONS.has(permission));
}

function installIpc() {
  ipcMain.on('desktop:config', (event) => {
    event.returnValue = trusted(event)
      ? { ...config, helperPort: process.platform === 'win32' && existsSync(HELPER_EXE) ? helperPort : null, version: app.getVersion(), packaged: app.isPackaged }
      : null;
  });
  ipcMain.handle('capture:sources', (event) => (trusted(event) ? listSources() : []));
  ipcMain.handle('capture:choose', (event, id) => {
    if (!trusted(event) || typeof id !== 'string' || !knownSources.has(id)) return false;
    armedSource = { id, expires: Date.now() + 10_000 };
    return true;
  });
  ipcMain.on('room:state', (event, state) => {
    if (trusted(event)) applyRoomState(state);
  });
  ipcMain.handle('autostart:get', (event) => (trusted(event) ? autostartState() : null));
  ipcMain.handle('autostart:set', (event, input) => (trusted(event) ? setAutostart(input) : null));
  ipcMain.handle('desktop:take-link', (event) => {
    if (!trusted(event)) return null;
    const link = pendingLink;
    pendingLink = null;
    return link;
  });
  ipcMain.handle('update:status', (event) => (trusted(event) ? updateStatus : null));
  ipcMain.handle('update:check', async (event) => {
    if (trusted(event) && updates) await updates.check({ manual: true });
    return updateStatus;
  });
  ipcMain.handle('update:download', async (event) => {
    if (trusted(event) && updates) await updates.download();
    return updateStatus;
  });
  ipcMain.handle('update:restart', async (event, input) => {
    if (!trusted(event) || !updates) return { ok: false };
    return updates.restart({ confirmed: input?.confirmed === true });
  });
  ipcMain.handle('update:later', (event) => {
    if (trusted(event) && updates) updates.later();
    return updateStatus;
  });
  ipcMain.handle('update:auto-check', (event, on) => {
    if (trusted(event) && updates && typeof on === 'boolean') updates.setAutoCheck(on);
    return updateStatus;
  });
  ipcMain.handle('update:dismiss', (event) => {
    if (trusted(event) && updates) updates.dismiss();
    return updateStatus;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Abrir de novo (ou clicar num link cosmicnight://) só traz a janela que já existe: nunca duas cópias.
  app.on('second-instance', (_event, argv) => {
    showWindow();
    deliverLink(linkFromArgv(argv));
  });
  let quitReviewed = false;
  app.on('before-quit', (event) => {
    quitting = true;
    // "Instalar depois": ao fechar de vez, confere o arquivo de novo e só então roda o instalador.
    if (quitReviewed || !updates?.status().installOnQuit) return;
    event.preventDefault();
    quitReviewed = true;
    void updates.installOnQuit().then((started) => {
      if (!started) app.quit();
    });
  });
  app.on('will-quit', stopHelper);
  // Com a janela fechada fora de uma sala, o aplicativo encerra (não fica escondido à toa).
  app.on('window-all-closed', quit);

  app.whenReady().then(async () => {
    if (connectionError) {
      dialog.showErrorBox('Cosmic Night', 'Esta versão não possui um servidor online válido. Baixe uma versão atualizada do Cosmic Night quando o serviço estiver disponível.');
      app.quit();
      return;
    }
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('app.shareroom.desktop');
    protocol.handle(SCHEME, serveApp);
    // Links cosmicnight:// abrem este aplicativo. O instalador já registra (só para este usuário, sem
    // administrador); registrar de novo aqui conserta o registro se outra cópia o tiver trocado.
    if (app.isPackaged && !UPDATE_TEST) app.setAsDefaultProtocolClient(DEEP_SCHEME);
    installPermissions(session.defaultSession);
    installCapture(session.defaultSession);
    installIpc();
    helperPort = await freePort().catch(() => null);
    startHelper();
    createTray();
    createWindow();
    void setupUpdater();

    if (E2E) {
      // Ganchos só para os testes automatizados: ler o menu da bandeja e acioná-lo sem um clique de verdade.
      const opened = [];
      externalOpener = async (url) => void opened.push(url);
      globalThis.__shareroom = {
        opened,
        window: () => win,
        tray: () => trayTemplate().map((item) => ({ label: item.label ?? null, enabled: item.enabled !== false })),
        clickTray: (label) => trayTemplate().find((item) => item.label === label)?.click?.(),
        tooltip: () => (roomState.sharing ? 'transmitindo' : roomState.inRoom ? 'em sala' : 'livre'),
        helperRunning: () => Boolean(helper) && helper.exitCode === null,
        helperPid: () => helper?.pid ?? null,
        sleepBlocked: () => sleepBlocker !== null,
        openLink: (argv) => deliverLink(linkFromArgv(argv)),
      };
    }
  });
}
