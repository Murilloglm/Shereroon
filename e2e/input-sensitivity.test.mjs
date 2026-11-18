import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, root, startStack, waitFor } from './harness.mjs';
let stack, browser, page;
const screen = () => page.getByTestId('input-sensitivity');
async function open() { await page.getByTestId('account-settings-open').click(); await page.getByTestId('settings-nav-voz').click(); }
before(async () => {
  stack = await startStack({ DATABASE_URL: '' });
  browser = await launchChrome({ headless: true, fakeMic: true, args: [`--use-file-for-fake-audio-capture=${resolve(root, 'web/test/fixtures/voz.wav')}`] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await context.addInitScript(() => {
    window.__micTracks = []; window.__constraints = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (options) => {
      window.__constraints.push(options.audio);
      const stream = await capture(options); window.__micTracks.push(...stream.getTracks()); return stream;
    };
  });
  page = await context.newPage(); page.setDefaultTimeout(20_000);
  await page.goto(BASE_URL);
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill('sensibilidade');
  await page.getByTestId('auth-display-name').fill('Sensibilidade');
  await page.getByTestId('auth-password').fill('senha-apenas-teste-1');
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('account-settings-open').waitFor();
});
after(async () => { await browser?.close(); await stack?.stop(); });

test('configuração fora da call: perfis, teste local, comparação e persistência', async () => {
  await open();
  await screen().getByTestId('input-profile-isolation').click();
  await screen().getByTestId('input-test').click();
  await screen().getByTestId('input-test-result').waitFor();
  assert.match(await screen().getByTestId('input-test-result').textContent(), /RNNoise ativo/);
  assert.ok(await page.evaluate(() => window.__micTracks.every(t => t.readyState === 'ended')), 'capturas liberadas antes de ouvir');
  const constraints = await page.evaluate(() => window.__constraints.at(-1));
  assert.equal(constraints.noiseSuppression, false); assert.equal(constraints.autoGainControl, false);
  await screen().getByLabel('Estou usando fones para ouvir o teste').check();
  await screen().getByRole('button', { name: 'Ouvir processado', exact: true }).click();
  await screen().getByRole('button', { name: 'Parar reprodução', exact: true }).click();
  await screen().getByTestId('input-profile-custom').click();
  await screen().getByRole('button', { name: 'Manual', exact: true }).click();
  await screen().getByLabel('Limiar de entrada', { exact: true }).fill('-62');
  await page.reload(); await open();
  assert.equal(await screen().getByLabel('Limiar de entrada', { exact: true }).inputValue(), '-62');
  assert.equal(await screen().getByTestId('input-profile-custom').getAttribute('aria-checked'), 'true');
  mkdirSync('e2e/.artifacts', { recursive: true });
  await page.getByTestId('settings-screen').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: 'e2e/.artifacts/input-sensitivity.png', fullPage: true });
});

test('estúdio desliga WebRTC e gate; fechar o teste libera o microfone', async () => {
  await screen().getByTestId('input-profile-studio').click();
  await screen().getByTestId('input-test').click();
  await screen().getByTestId('input-test-result').waitFor();
  const constraints = await page.evaluate(() => window.__constraints.at(-1));
  assert.equal(constraints.noiseSuppression, false); assert.equal(constraints.autoGainControl, false); assert.equal(constraints.echoCancellation, false);
  await screen().getByTestId('input-test').click();
  await waitFor(async () => page.evaluate(() => window.__micTracks.some(t => t.readyState === 'live')), 'abrir microfone');
  await page.getByTestId('settings-screen').getByRole('button', { name: 'Fechar', exact: true }).click();
  await waitFor(async () => page.evaluate(() => window.__micTracks.every(t => t.readyState === 'ended')), 'liberar ao fechar');
});

test('canal de voz: modo manual, mute e reconexão preservam a preferência', async () => {
  await page.getByTestId('rail-create').click(); await page.getByTestId('group-name').fill('Áudio'); await page.getByTestId('group-create').click();
  await page.getByTestId('chat').waitFor();
  await page.getByTestId('channel').filter({ hasText: /^Sala de voz$/ }).click();
  await page.getByTestId('connection').waitFor();
  await open(); await screen().getByTestId('input-profile-custom').click();
  await screen().getByRole('button', { name: 'Manual', exact: true }).click();
  await screen().getByLabel('Limiar de entrada', { exact: true }).fill('-62');
  await page.getByTestId('settings-screen').getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByTestId('dock-mic').click();
  await open();
  await waitFor(async () => await screen().getByTestId('input-meter').getAttribute('data-open') === 'true', 'sensibilidade abrir com a voz', 20_000);
  await page.getByTestId('settings-screen').getByRole('button', { name: 'Fechar', exact: true }).click();
  for (let i=0; i<2; i++) { await page.getByTestId('dock-mic').click(); await page.getByTestId('dock-mic').click(); }
  assert.ok(stack.ownsLivekit); await stack.restartLivekit(2000);
  await waitFor(async () => await page.getByTestId('connection').getAttribute('data-phase') === 'connected', 'reconexão', 60_000);
  await open(); assert.equal(await screen().getByLabel('Limiar de entrada', { exact: true }).inputValue(), '-62');
});

test('chamada privada usa a mesma sensibilidade e envia áudio ao segundo participante', async () => {
  await page.getByTestId('settings-screen').getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByTestId('dock-leave').click();
  await page.goto(`${BASE_URL}/#/salas`);
  await page.getByTestId('home-user-name').fill('Sensibilidade');
  await page.getByTestId('home-room-name').fill('Teste de entrada');
  await page.getByTestId('home-create').click();
  await page.getByTestId('room').waitFor();
  const invite = await page.getByTestId('room-link').inputValue();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const guest = await context.newPage(); guest.setDefaultTimeout(20_000);
  try {
    await guest.goto(invite);
    await guest.getByTestId('gate-name').fill('Ouvinte'); await guest.getByTestId('gate-join').click();
    await guest.getByTestId('room').waitFor();
    await waitFor(async () => await guest.locator('audio').evaluateAll(elements => elements.some(element => element.srcObject?.getAudioTracks().some(track => track.readyState === 'live'))), 'faixa de voz recebida', 20_000);
    const peak = await guest.evaluate(async () => {
      const element = [...document.querySelectorAll('audio')].find(element => element.srcObject?.getAudioTracks().length);
      const context = new AudioContext(); await context.resume();
      const source = context.createMediaStreamSource(element.srcObject), analyser = context.createAnalyser(), silent = context.createGain();
      silent.gain.value = 0; source.connect(analyser); analyser.connect(silent); silent.connect(context.destination);
      const samples = new Float32Array(analyser.fftSize); let peak = 0;
      try {
        for (let i=0;i<60;i++) { await new Promise(resolve => setTimeout(resolve, 50)); analyser.getFloatTimeDomainData(samples); for (const value of samples) peak = Math.max(peak, Math.abs(value)); }
        return peak;
      } finally { source.disconnect(); analyser.disconnect(); silent.disconnect(); await context.close(); }
    });
    assert.ok(peak > 0.00005, `áudio decodificado chegou ao outro cliente: pico ${peak}`);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('shareroom:entrada')).thresholdDb), -62);
    await page.getByTestId('dock-mic').click(); await page.getByTestId('dock-mic').click();
    await waitFor(async () => await guest.locator('audio').evaluateAll(elements => elements.some(element => element.srcObject?.getAudioTracks().some(track => track.readyState === 'live'))), 'faixa preservada após mute');
  } finally { await context.close(); }
});
