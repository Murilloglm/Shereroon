// Estado e regras da atualização automática, separados do Electron para poder ser testados com um updater de
// mentira. Quem decide baixar e reiniciar é a pessoa: o aplicativo só procura sozinho (se ela deixar), avisa,
// baixa quando ela pede, confere o arquivo e instala ao reiniciar ou ao fechar, se ela escolher "depois".
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { friendlyUpdateError, notesToText, REJECTION_TEXT, verifyDownload } from './update-trust.mjs';

const PREFS_FILE = 'atualizacoes.json';
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function readUpdatePrefs(dir) {
  try {
    const raw = JSON.parse(readFileSync(join(dir, PREFS_FILE), 'utf8'));
    return { autoCheck: raw?.autoCheck !== false };
  } catch {
    return { autoCheck: true };
  }
}

export function writeUpdatePrefs(dir, prefs) {
  writeFileSync(join(dir, PREFS_FILE), `${JSON.stringify({ autoCheck: prefs.autoCheck !== false })}\n`);
}

/**
 * @param {object} deps
 * @param {import('node:events').EventEmitter & { checkForUpdates(): Promise<unknown>, downloadUpdate(): Promise<unknown> }} deps.updater
 * @param {string} deps.currentVersion
 * @param {string[]} deps.publicKeys chaves Ed25519 que podem assinar atualizações
 * @param {string} deps.prefsDir pasta de dados do aplicativo
 * @param {() => { inRoom: boolean, sharing: boolean }} deps.activity
 * @param {(status: object) => void} deps.send
 * @param {(mode: 'agora' | 'ao-fechar') => void} deps.install roda o instalador conferido
 * @param {boolean} [deps.selfTest] só nas cópias de teste: baixa e instala sem esperar clique
 */
export function createUpdates({ updater, currentVersion, publicKeys, prefsDir, activity, send, install, selfTest = false, log = () => {} }) {
  const prefs = readUpdatePrefs(prefsDir);
  let status = {
    supported: true,
    currentVersion,
    autoCheck: prefs.autoCheck,
    state: 'ocioso',
    version: null,
    releaseName: null,
    releaseDate: null,
    notes: '',
    size: null,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    installOnQuit: false,
    lastCheck: null,
    message: null,
    messageKind: null,
  };
  /** Arquivo baixado e já conferido (só ele pode ser instalado). */
  let verified = null;
  let pendingInfo = null;
  let manualCheck = false;
  let installing = false;
  let timer = null;

  const set = (patch) => {
    status = { ...status, ...patch };
    log({ at: Date.now(), ...status });
    send(status);
  };

  const fail = (error, fallbackState) => {
    const friendly = friendlyUpdateError(error);
    log({ at: Date.now(), error: String(error?.message ?? error).slice(0, 300) });
    set({ state: fallbackState ?? (pendingInfo ? 'disponivel' : 'erro'), percent: null, bytesPerSecond: null, message: friendly.message, messageKind: friendly.kind === 'offline' ? 'offline' : 'erro' });
  };

  updater.on('checking-for-update', () => set({ state: 'verificando', message: null, messageKind: null }));
  updater.on('update-not-available', () => {
    pendingInfo = null;
    set({ state: 'atualizado', version: null, releaseName: null, notes: '', size: null, lastCheck: Date.now(), percent: null, message: manualCheck ? 'Você já está na versão mais recente.' : null, messageKind: manualCheck ? 'info' : null });
    manualCheck = false;
  });
  updater.on('update-available', (info) => {
    manualCheck = false;
    // Uma versão nova apareceu depois de outra já baixada: a baixada deixa de valer.
    if (verified && verified.version !== info?.version) verified = null;
    pendingInfo = info;
    const size = Array.isArray(info?.files) ? info.files.find((file) => /\.exe$/i.test(String(file?.url)))?.size ?? null : null;
    set({
      state: verified ? 'pronta' : 'disponivel',
      version: String(info?.version ?? ''),
      releaseName: typeof info?.releaseName === 'string' ? info.releaseName.slice(0, 120) : null,
      releaseDate: typeof info?.releaseDate === 'string' ? info.releaseDate : null,
      notes: notesToText(info?.releaseNotes),
      size: typeof size === 'number' ? size : null,
      lastCheck: Date.now(),
      message: null,
      messageKind: null,
    });
    if (selfTest && !verified) void download();
  });
  updater.on('download-progress', (progress) => {
    set({
      state: 'baixando',
      percent: Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0))),
      transferred: Number(progress?.transferred) || 0,
      total: Number(progress?.total) || null,
      bytesPerSecond: Number(progress?.bytesPerSecond) || 0,
    });
  });
  updater.on('update-downloaded', (info) => void accept(info));
  updater.on('error', (error) => {
    if (status.state === 'conferindo' || status.state === 'pronta') return;
    manualCheck = false;
    fail(error);
  });

  async function accept(info) {
    set({ state: 'conferindo', percent: 100, bytesPerSecond: null });
    const result = await verifyDownload(info, info?.downloadedFile, publicKeys);
    if (!result.ok) {
      verified = null;
      // Arquivo recusado nunca fica guardado para uma instalação futura.
      try {
        if (typeof info?.downloadedFile === 'string') rmSync(info.downloadedFile, { force: true });
      } catch {
        // pasta temporária do updater; se não der para apagar agora, a próxima conferência recusa de novo
      }
      log({ at: Date.now(), rejected: result.reason });
      set({ state: 'recusada', percent: null, message: REJECTION_TEXT[result.reason] ?? REJECTION_TEXT.assinatura, messageKind: 'erro' });
      return;
    }
    verified = { info, file: info.downloadedFile, version: String(info.version) };
    set({ state: 'pronta', version: verified.version, percent: 100, message: null, messageKind: null });
    if (selfTest) void restart({ confirmed: true });
  }

  async function check({ manual = false } = {}) {
    if (status.state === 'verificando' || status.state === 'baixando' || status.state === 'conferindo') return status;
    manualCheck = manual;
    try {
      await updater.checkForUpdates();
    } catch (error) {
      manualCheck = false;
      fail(error);
    }
    return status;
  }

  async function download() {
    if (!pendingInfo || status.state === 'baixando' || status.state === 'conferindo' || verified) return status;
    set({ state: 'baixando', percent: 0, transferred: 0, total: status.size, bytesPerSecond: 0, message: null, messageKind: null });
    try {
      await updater.downloadUpdate();
    } catch (error) {
      if (status.state !== 'recusada') fail(error, 'disponivel');
    }
    return status;
  }

  /** Confere de novo logo antes de instalar: o arquivo pode ter sido trocado no disco desde o download. */
  async function stillValid() {
    if (!verified) return false;
    const result = await verifyDownload(verified.info, verified.file, publicKeys);
    if (result.ok) return true;
    verified = null;
    set({ state: 'recusada', message: REJECTION_TEXT[result.reason] ?? REJECTION_TEXT.assinatura, messageKind: 'erro', installOnQuit: false });
    return false;
  }

  /** Reiniciar e atualizar. Numa chamada ou transmissão, só com a confirmação da pessoa. */
  async function restart({ confirmed = false } = {}) {
    if (!verified || installing) return { ok: false };
    const now = activity();
    if (!confirmed && (now.inRoom || now.sharing)) return { ok: false, needsConfirm: now.sharing ? 'transmissao' : 'chamada' };
    if (!(await stillValid())) return { ok: false };
    installing = true;
    set({ state: 'instalando' });
    install('agora');
    return { ok: true };
  }

  /** "Instalar depois": fica para quando o aplicativo fechar de vez. */
  function later() {
    if (!verified) return status;
    set({ installOnQuit: true, message: 'A atualização será instalada quando você fechar o Cosmic Night.', messageKind: 'info' });
    return status;
  }

  /** Chamado ao fechar o aplicativo. Devolve true se o instalador foi disparado. */
  async function installOnQuit() {
    if (!status.installOnQuit || installing || !(await stillValid())) return false;
    installing = true;
    install('ao-fechar');
    return true;
  }

  function setAutoCheck(on) {
    const autoCheck = on === true;
    writeUpdatePrefs(prefsDir, { autoCheck });
    set({ autoCheck });
    schedule();
    return status;
  }

  function dismiss() {
    if (status.state === 'recusada' || status.state === 'erro') {
      set({ state: pendingInfo ? 'disponivel' : status.lastCheck ? 'atualizado' : 'ocioso', message: null, messageKind: null });
    } else {
      set({ message: null, messageKind: null });
    }
    return status;
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = null;
    if (!status.autoCheck) return;
    timer = setInterval(() => void check(), CHECK_EVERY_MS);
    timer.unref?.();
  }

  function start() {
    schedule();
    if (status.autoCheck || selfTest) void check();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { status: () => status, check, download, restart, later, installOnQuit, setAutoCheck, dismiss, start, stop };
}
