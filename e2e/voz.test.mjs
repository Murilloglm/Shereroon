// Voz nas chamadas, com som de verdade passando pelo LiveKit:
//  1. indicador de fala: rajadas de tom com início conhecido entram como microfone; quem ouve mede o tempo
//     entre o som chegar e o anel do avatar acender;
//  2. mutar e desmutar: com um tom contínuo, três ciclos não reabrem o microfone nem trocam a faixa, e quem
//     ouve mede o degrau na onda nas transições (o estalo).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, root, startStack, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
const noSound = headless && 'o Chrome sem janela não entrega áudio de verdade';
const RATE = 48_000;
const TONE_HZ = 300;
const AMPLITUDE = 0.25;

let stack;
let hostBrowser;
let burstBrowser;
let toneBrowser;
let host;
let inviteUrl;

/** WAV mono de 16 bits. `level(t)` dá a amplitude (0 a 1) do tom no instante t, em segundos. */
function writeWav(name, seconds, level) {
  const samples = Math.round(seconds * RATE);
  const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / RATE;
    const value = level(t) * AMPLITUDE * Math.sin(2 * Math.PI * TONE_HZ * t);
    out.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  const folder = resolve(root, 'e2e/.artifacts');
  mkdirSync(folder, { recursive: true });
  const file = resolve(folder, name);
  writeFileSync(file, out);
  return file;
}

/** 1 s de tom, 1 s de silêncio, com 3 ms de rampa nas pontas (a fonte não tem estalo próprio). */
const burstLevel = (t) => {
  const phase = t % 2;
  if (phase >= 1) return 0;
  return Math.min(1, phase / 0.003, (1 - phase) / 0.003);
};

/** Sem o processamento do navegador: um tom contínuo seria tratado como ruído e apagado aos poucos. */
const RAW_MIC = JSON.stringify({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, gain: 1 });

async function enter(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((mic) => {
    localStorage.setItem('shareroom:microfone', mic);
    // Conta quantas vezes o microfone é aberto de verdade.
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__micOpens = 0;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (constraints?.audio) window.__micOpens += 1;
      return original(constraints);
    };
  }, RAW_MIC);
  const page = await context.newPage();
  await page.goto(inviteUrl);
  await page.getByTestId('gate-name').fill(name);
  await page.getByTestId('gate-join').click();
  await page.getByTestId('room').waitFor();
  return page;
}

/** No dono: grava o áudio recebido de quem tem o nome dado e registra quando o anel dessa pessoa acende. */
async function startListening(name) {
  await host.evaluate(async (who) => {
    const row = [...document.querySelectorAll('[data-testid="participant"]')].find((item) => item.textContent.includes(who));
    const audio = [...document.querySelectorAll('audio')].find((item) => item.srcObject?.getAudioTracks().length);
    const ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.resume();
    const source = ctx.createMediaStreamSource(audio.srcObject);
    // Gravador na thread de áudio: nada se perde quando a página está ocupada redesenhando a tela.
    const code = `registerProcessor('rec', class extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Float32Array(4800); this.n = 0; }
      process(inputs) {
        const ch = inputs[0][0];
        if (ch) { this.buf.set(ch, this.n); this.n += ch.length; }
        else { this.buf.fill(0, this.n, this.n + 128); this.n += 128; }
        if (this.n >= 4800 - 128) { this.port.postMessage({ frame: currentFrame, data: this.buf.slice(0, this.n) }); this.n = 0; }
        return true;
      }
    });`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const recorder = new AudioWorkletNode(ctx, 'rec');
    const state = { chunks: [], ringOn: [], start: performance.now(), trackId: audio.srcObject.getAudioTracks()[0].id };
    // Relógio do áudio convertido para o da página (para comparar com o anel).
    const origin = performance.now() - ctx.currentTime * 1000;
    recorder.port.onmessage = ({ data }) => {
      state.chunks.push({ at: origin + ((data.frame - data.data.length) / 48000) * 1000, data: data.data });
    };
    source.connect(recorder);
    let lit = false;
    const watch = () => {
      const now = row.querySelector('[data-speaking="true"]') !== null;
      if (now && !lit) state.ringOn.push(performance.now());
      lit = now;
    };
    new MutationObserver(watch).observe(row, { attributes: true, subtree: true, attributeFilter: ['data-speaking'] });
    window.__listen = { state, stop: () => { recorder.disconnect(); return ctx.close(); } };
  }, name);
}

async function stopListening() {
  return host.evaluate(async () => {
    const { state, stop } = window.__listen;
    await stop();
    // Inícios de som: RMS de janelas de 5 ms passando de -30 dBFS depois de pelo menos 300 ms de silêncio.
    const onsets = [];
    let quietSince = 0;
    let maxStep = 0;
    let peak = 0;
    let previous = state.chunks[0]?.data[0] ?? 0;
    for (const chunk of state.chunks) {
      for (let offset = 0; offset < chunk.data.length; offset += 240) {
        let sum = 0;
        for (let i = offset; i < offset + 240; i++) sum += chunk.data[i] * chunk.data[i];
        const rms = Math.sqrt(sum / 240);
        const at = chunk.at + (offset / 48000) * 1000;
        if (rms > 0.0316) {
          if (quietSince !== null && at - quietSince >= 300) onsets.push(at);
          quietSince = null;
        } else if (rms < 0.01) {
          quietSince ??= at;
        }
      }
      // Os primeiros 250 ms são o gravador ligando (blocos vazios enquanto a fonte começa a entregar som).
      const warming = chunk.at - state.start < 250;
      for (let i = 0; i < chunk.data.length; i++) {
        const sample = chunk.data[i];
        if (warming) {
          previous = sample;
          continue;
        }
        // Diferença entre amostras vizinhas: num tom de 300 Hz ela é pequena; um corte seco da onda a faz saltar.
        const step = Math.abs(sample - previous);
        if (step > 0.04) (state.steps ??= []).push([Math.round(chunk.at + (i / 48000) * 1000 - state.start), +step.toFixed(3), +previous.toFixed(3), +sample.toFixed(3)]);
        maxStep = Math.max(maxStep, step);
        peak = Math.max(peak, Math.abs(sample));
        previous = sample;
      }
    }
    return { onsets, ringOn: state.ringOn, maxStep, peak, trackId: state.trackId, steps: (state.steps ?? []).slice(0, 20) };
  });
}

before(async () => {
  stack = await startStack();
  hostBrowser = await launchChrome({ headless });
  burstBrowser = await launchChrome({
    fakeMic: true,
    headless,
    args: [`--use-file-for-fake-audio-capture=${writeWav('rajadas.wav', 8, burstLevel)}`],
  });
  toneBrowser = await launchChrome({
    fakeMic: true,
    headless,
    args: [`--use-file-for-fake-audio-capture=${writeWav('tom-continuo.wav', 8, () => 1)}`],
  });
  host = await (await hostBrowser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await host.goto(`${BASE_URL}/#/salas`);
  await host.getByTestId('home-user-name').fill('Murillo');
  await host.getByTestId('home-room-name').fill('Voz');
  await host.getByTestId('home-create').click();
  await host.getByTestId('room').waitFor();
  inviteUrl = await host.getByTestId('room-link').inputValue();
});

after(async () => {
  await hostBrowser?.close();
  await burstBrowser?.close();
  await toneBrowser?.close();
  await stack?.stop();
});

test('indicador de fala acende logo depois que o som chega e apaga nas pausas', { skip: noSound }, async () => {
  const talker = await enter(burstBrowser, 'Bia');
  await talker.getByTestId('dock-mic').click();
  const row = host.getByTestId('participant').filter({ hasText: 'Bia' });
  await waitFor(async () => (await row.getByTestId('mic-off').count()) === 0, 'o dono ver o microfone da Bia ligado');
  await waitFor(async () => (await host.locator('audio').count()) > 0, 'o áudio da Bia chegar');
  await host.waitForTimeout(1500);

  await startListening('Bia');
  await host.waitForTimeout(12_000);
  const { onsets, ringOn } = await stopListening();

  const delays = [];
  for (const onset of onsets) {
    const ring = ringOn.find((at) => at >= onset - 150 && at <= onset + 1000);
    if (ring !== undefined) delays.push(Math.round(ring - onset));
  }
  delays.sort((a, b) => a - b);
  const median = delays[Math.floor(delays.length / 2)];
  console.log(`  inícios de fala: ${onsets.length}; atraso do anel (ms): ${delays.join(', ')}; mediana ${median} ms`);
  assert.ok(onsets.length >= 4, 'mediu os inícios de fala');
  assert.ok(delays.length >= onsets.length - 1, 'o anel acendeu em (quase) todas as rajadas');
  // O anel apaga entre as rajadas (1 s de silêncio): acende uma vez por rajada, não fica aceso direto.
  assert.ok(ringOn.length >= onsets.length - 1, 'o anel apagou nas pausas e acendeu de novo');
  assert.ok(median <= 120, `o anel acendeu em até 120 ms (mediana ${median} ms)`);

  // Para quem fala, o próprio anel usa o medidor local e também acende.
  await waitFor(async () => (await talker.locator('[data-speaking="true"]').count()) > 0, 'o anel da Bia acender na tela dela');
  await talker.context().close();
  await waitFor(async () => (await host.getByTestId('participant').filter({ hasText: 'Bia' }).count()) === 0, 'a Bia sair');
});

test('mutar e desmutar não reabre o microfone, não troca a faixa e não estala', { skip: noSound }, async () => {
  const talker = await enter(toneBrowser, 'Caio');
  const row = host.getByTestId('participant').filter({ hasText: 'Caio' });
  await talker.getByTestId('dock-mic').click();
  await waitFor(async () => (await row.getByTestId('mic-off').count()) === 0, 'o dono ver o microfone do Caio ligado');
  await waitFor(async () => (await host.locator('audio').count()) > 0, 'o áudio do Caio chegar');
  await host.waitForTimeout(1500);

  await startListening('Caio');
  for (let cycle = 0; cycle < 3; cycle++) {
    await talker.getByTestId('dock-mic').click();
    await waitFor(async () => (await row.getByTestId('mic-off').count()) === 1, 'o dono ver o Caio mutado');
    await talker.waitForTimeout(600 + cycle * 137);
    await talker.getByTestId('dock-mic').click();
    await waitFor(async () => (await row.getByTestId('mic-off').count()) === 0, 'o dono ver o Caio desmutado');
    await talker.waitForTimeout(700 + cycle * 91);
  }
  const { maxStep, peak, trackId, steps } = await stopListening();

  assert.equal(await talker.evaluate(() => window.__micOpens), 1, 'o microfone foi aberto uma vez só');
  const audioIds = await host.evaluate(() => [...document.querySelectorAll('audio')].map((item) => item.srcObject?.getAudioTracks()[0]?.id));
  assert.ok(audioIds.includes(trackId), 'a mesma faixa continuou chegando (nada republicado)');
  // Num tom de 300 Hz a maior diferença entre amostras vizinhas é ~4% da amplitude. Um corte seco da onda
  // (o estalo) salta para perto da amplitude inteira.
  const ratio = maxStep / peak;
  console.log(`  pico ${peak.toFixed(3)}, maior salto entre amostras ${maxStep.toFixed(4)} (${(ratio * 100).toFixed(1)}% do pico)`);
  assert.ok(peak > 0.05, 'o tom chegou ao dono');
  // Antes da correção cada mute dava um salto de ~70% do pico na casa de quem ouve.
  assert.ok(ratio < 0.08, `sem estalo nas transições (salto de ${(ratio * 100).toFixed(1)}% do pico; saltos ${JSON.stringify(steps)})`);
});
