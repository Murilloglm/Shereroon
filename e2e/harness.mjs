// Infraestrutura dos testes de ponta a ponta: sobe o LiveKit local e o backend (servindo o
// build do frontend) e abre o Chrome instalado na máquina. Nada aqui usa vídeo ou áudio falso
// como se fosse real: a captura é feita pelo getDisplayMedia de verdade.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ensureLivekit, livekitArgs } from '../scripts/livekit.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const API_PORT = 8790;
export const BASE_URL = `http://localhost:${API_PORT}`;
const LIVEKIT_PORT = 7880;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function portOpen(port) {
  return new Promise((done) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}

async function waitFor(check, what, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(200);
  }
  throw new Error(`Tempo esgotado esperando: ${what}`);
}

function start(label, command, args, options) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const tail = [];
  const keep = (chunk) => {
    tail.push(chunk.toString());
    if (tail.length > 60) tail.shift();
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.logs = () => `[${label}]\n${tail.join('')}`;
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill();
  await Promise.race([exited, sleep(3000)]);
}

/** Sobe LiveKit + backend. Reaproveita um LiveKit que já esteja rodando (por exemplo, do `npm run dev`). */
/**
 * O aplicativo de desenvolvimento lê desktop/src/config.json, que os builds geram (às vezes apontando para o
 * servidor online, que só aceita HTTPS público). Os testes do aplicativo usam o modo local, com o backend do
 * teste, e devolvem o arquivo como estava. Retorna a função que devolve.
 */
export function useLocalDesktopConfig() {
  const file = resolve(root, 'desktop/src/config.json');
  const previous = existsSync(file) ? readFileSync(file) : null;
  writeFileSync(file, `${JSON.stringify({ connectionMode: 'local', apiUrl: BASE_URL, siteUrl: '' }, null, 2)}\n`);
  return () => (previous ? writeFileSync(file, previous) : rmSync(file, { force: true }));
}

export async function startStack(env = {}) {
  if (!existsSync(resolve(root, 'web/dist/index.html'))) {
    throw new Error('Falta o build do frontend. Rode "npm run build" antes dos testes de ponta a ponta.');
  }
  const binary = await ensureLivekit();
  let livekit = null;
  const startLivekit = async () => {
    livekit = start('livekit', binary, livekitArgs());
    await waitFor(() => portOpen(LIVEKIT_PORT), 'LiveKit na porta 7880');
  };
  const ownsLivekit = !(await portOpen(LIVEKIT_PORT));
  if (ownsLivekit) await startLivekit();

  if (await portOpen(API_PORT)) throw new Error(`A porta ${API_PORT} já está em uso.`);
  const api = start('api', process.execPath, ['src/node.ts'], {
    cwd: resolve(root, 'server'),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      LIVEKIT_URL: `ws://localhost:${LIVEKIT_PORT}`,
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'secret',
      APP_SECRET: 'segredo-apenas-para-os-testes-e2e',
      ALLOWED_ORIGINS: BASE_URL,
      WEB_DIST: resolve(root, 'web/dist'),
      // Contas e grupos num banco só na memória: cada execução dos testes começa do zero.
      PGLITE_DIR: ':memory:',
      ...env,
    },
  });
  try {
    await waitFor(async () => {
      try {
        return (await fetch(`${BASE_URL}/api/health`)).ok;
      } catch {
        return false;
      }
    }, 'backend respondendo');
  } catch (error) {
    throw new Error(`${error.message}\n${api.logs()}`);
  }

  return {
    ownsLivekit,
    /** Derruba e sobe de novo o SFU, para testar a reconexão automática. */
    async restartLivekit(downMs = 2500) {
      if (!ownsLivekit) throw new Error('O LiveKit não foi iniciado por este teste; não dá para reiniciá-lo.');
      await stopChild(livekit);
      await sleep(downMs);
      await startLivekit();
    },
    logs: () => `${api.logs()}\n${livekit?.logs() ?? ''}`,
    async stop() {
      await stopChild(api);
      if (ownsLivekit) await stopChild(livekit);
    },
  };
}

/**
 * Abre o Chrome instalado. `captureTitle` faz o seletor de tela escolher sozinho a aba com esse título
 * (é o Chrome de verdade capturando uma aba de verdade, só sem o clique humano no seletor).
 */
export async function launchChrome({ headless = true, captureTitle, captureScreen, fakeMic = false, args = [] } = {}) {
  const flags = [
    '--autoplay-policy=no-user-gesture-required',
    // A janela de teste costuma ficar coberta por outras (o editor, por exemplo). Sem isto o Windows a marca
    // como oculta e o Chrome para de renderizar a aba capturada, zerando o FPS de captura.
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    ...args,
  ];
  if (captureTitle) flags.push(`--auto-select-tab-capture-source-by-title=${captureTitle}`);
  if (captureScreen) flags.push(`--auto-select-desktop-capture-source=${captureScreen}`);
  // Aceita sozinho o pedido de permissão de microfone; com fakeMic, usa o microfone sintético do Chrome.
  if (fakeMic) flags.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream');
  return chromium.launch({ channel: 'chrome', headless, args: flags });
}

/** Página animada usada como fonte de captura: quadros novos o tempo todo e um tom contínuo de 880 Hz. */
export function sourcePageHtml(title, toneHz = 880) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;background:#101018;overflow:hidden}canvas{width:100vw;height:100vh;display:block}</style></head>
<body><canvas id="c" width="1280" height="720"></canvas><script>
const c=document.getElementById('c'),x=c.getContext('2d');let n=0;
function draw(t){n++;x.fillStyle='hsl('+(n*3%360)+' 70% 20%)';x.fillRect(0,0,1280,720);
for(let i=0;i<24;i++){x.fillStyle='hsl('+((n*5+i*15)%360)+' 90% 60%)';
x.fillRect((n*7+i*53)%1280,(i*30+Math.sin(t/200+i)*40+360)%720,90,26);}
x.fillStyle='#fff';x.font='bold 64px sans-serif';x.fillText('quadro '+n,40,90);requestAnimationFrame(draw);}
requestAnimationFrame(draw);
const a=new AudioContext(),o=a.createOscillator(),g=a.createGain();o.frequency.value=${toneHz};g.gain.value=0.2;
o.connect(g).connect(a.destination);o.start();a.resume();
</script></body></html>`;
}

/** No navegador de quem assiste: mede a frequência dominante de cada faixa de áudio recebida. */
export async function receivedTones(page, { settleMs = 1200 } = {}) {
  return page.evaluate(async (wait) => {
    const results = [];
    for (const element of document.querySelectorAll('audio')) {
      const stream = element.srcObject;
      if (!(stream instanceof MediaStream) || stream.getAudioTracks().length === 0) continue;
      const context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 16384;
      context.createMediaStreamSource(stream).connect(analyser);
      await new Promise((done) => setTimeout(done, wait));
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      let peak = 0;
      for (let index = 1; index < bins.length; index++) if (bins[index] > bins[peak]) peak = index;
      results.push({ hz: (peak * context.sampleRate) / analyser.fftSize, db: bins[peak] });
      await context.close();
    }
    return results;
  }, settleMs);
}

/**
 * No navegador de quem assiste: nível (em dB) de frequências específicas no áudio recebido, somando todas
 * as faixas. Um tom presente fica dezenas de dB acima de um ausente.
 */
export async function toneLevels(page, frequencies, { settleMs = 900 } = {}) {
  return page.evaluate(
    async ({ frequencies, wait }) => {
      const context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 32768;
      analyser.smoothingTimeConstant = 0;
      let tracks = 0;
      for (const element of document.querySelectorAll('audio')) {
        const stream = element.srcObject;
        if (stream instanceof MediaStream && stream.getAudioTracks().length > 0) {
          context.createMediaStreamSource(stream).connect(analyser);
          tracks += 1;
        }
      }
      await new Promise((done) => setTimeout(done, wait));
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      const levels = {};
      for (const frequency of frequencies) {
        const center = Math.round((frequency * analyser.fftSize) / context.sampleRate);
        let best = -Infinity;
        for (let bin = center - 2; bin <= center + 2; bin++) best = Math.max(best, bins[bin]);
        levels[frequency] = Number.isFinite(best) ? Math.round(best * 10) / 10 : -200;
      }
      await context.close();
      return { tracks, levels };
    },
    { frequencies, wait: settleMs },
  );
}

/**
 * No navegador de quem assiste: nível (em dB) de uma faixa de frequências do áudio recebido, medido em
 * janelas curtas (~43 ms) durante `seconds`. Devolve percentis: com fala sobre ruído, p10 é o ruído das
 * pausas e p90 é o nível da voz; com som contínuo, os três ficam próximos.
 */
export async function bandStats(page, { lowHz = 100, highHz = 4000, seconds = 4 } = {}) {
  return page.evaluate(
    async ({ lowHz, highHz, seconds }) => {
      const context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      let tracks = 0;
      for (const element of document.querySelectorAll('audio')) {
        const stream = element.srcObject;
        if (stream instanceof MediaStream && stream.getAudioTracks().length > 0) {
          context.createMediaStreamSource(stream).connect(analyser);
          tracks += 1;
        }
      }
      const first = Math.max(1, Math.round((lowHz * analyser.fftSize) / context.sampleRate));
      const last = Math.min(analyser.frequencyBinCount - 1, Math.round((highHz * analyser.fftSize) / context.sampleRate));
      const bins = new Float32Array(analyser.frequencyBinCount);
      const levels = [];
      await new Promise((done) => setTimeout(done, 300));
      const until = performance.now() + seconds * 1000;
      while (performance.now() < until) {
        analyser.getFloatFrequencyData(bins);
        let power = 0;
        for (let bin = first; bin <= last; bin++) power += 10 ** (bins[bin] / 10);
        levels.push(power > 0 ? 10 * Math.log10(power) : -200);
        await new Promise((done) => setTimeout(done, 45));
      }
      await context.close();
      levels.sort((a, b) => a - b);
      const at = (fraction) => Math.round(Math.max(-200, levels[Math.floor((levels.length - 1) * fraction)] ?? -200) * 10) / 10;
      return { tracks, samples: levels.length, p10: at(0.1), p50: at(0.5), p90: at(0.9) };
    },
    { lowHz, highHz, seconds },
  );
}

export const HELPER_EXE = resolve(root, 'helper/bin/ShareRoomAudio.exe');

/**
 * Inicia o app auxiliar em modo de teste: sem bandeja, numa porta própria, com a origem do teste já
 * autorizada (o que normalmente o usuário faz respondendo "Sim" na janela do auxiliar).
 */
export async function startHelper({ port, origins = [BASE_URL] }) {
  if (!existsSync(HELPER_EXE)) throw new Error('Falta compilar o app auxiliar: npm run build:helper');
  const args = ['--console', '--no-prompt', '--port', String(port), ...origins.flatMap((origin) => ['--allow-origin', origin])];
  const child = spawn(HELPER_EXE, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  await waitFor(() => portOpen(port), `app auxiliar na porta ${port}`, 10_000).catch((error) => {
    throw new Error(`${error.message}\n${output.join('')}`);
  });
  return {
    port,
    logs: () => output.join(''),
    async stop() {
      // Fechar a entrada padrão encerra o auxiliar de forma limpa (ele solta todas as capturas).
      child.stdin.end();
      await stopChild(child);
    },
  };
}

/**
 * Um "aplicativo" de teste: cópia do executável do auxiliar com outro nome, tocando um tom bem baixo
 * (ou, com `noise`, um ruído de ventilador). Para o Windows é um programa de verdade, com processo e
 * sessão de áudio próprios.
 */
export async function startToneApp(name, hz, { seconds = 180, amplitude = 0.01, noise = false } = {}) {
  const { copyFileSync, mkdirSync } = await import('node:fs');
  const folder = resolve(root, 'e2e/.artifacts');
  mkdirSync(folder, { recursive: true });
  const exe = resolve(folder, `${name}.exe`);
  try {
    copyFileSync(HELPER_EXE, exe);
  } catch (error) {
    if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
  }
  const args = ['--tone', String(hz), '--seconds', String(seconds), '--amplitude', String(amplitude), ...(noise ? ['--noise'] : [])];
  const child = spawn(exe, args, { stdio: 'ignore' });
  await sleep(1200);
  if (child.exitCode !== null) throw new Error(`O tom de teste "${name}" não tocou: este PC está sem saída de áudio ativa?`);
  return { name: `${name}.exe`, pid: child.pid, stop: () => stopChild(child) };
}

/** Lê do <video> quantos quadros já foram decodificados e o tamanho real da imagem. */
export function videoFacts(page) {
  return page.evaluate(() => {
    const video = document.querySelector('[data-testid="stage-video"]');
    const quality = video.getVideoPlaybackQuality?.();
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      frames: quality?.totalVideoFrames ?? 0,
      paused: video.paused,
    };
  });
}

/** Extrai o primeiro número de um texto como "117 FPS" ou "14,8 Mbps". */
export function numberIn(text) {
  const match = /-?\d+(?:[.,]\d+)?/.exec(text ?? '');
  return match ? Number(match[0].replace(',', '.')) : null;
}

export { sleep, waitFor };
