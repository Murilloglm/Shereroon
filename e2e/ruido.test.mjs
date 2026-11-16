// Supressão de ruído, de ponta a ponta e com som de verdade:
//  1. microfone: uma voz gravada com ruído de ventilador por cima entra como microfone do Chrome; quem
//     assiste mede o ruído das pausas cair e a voz continuar no mesmo nível;
//  2. aplicativo: um programa tocando ruído de ventilador é filtrado sozinho no mixer, antes da mixagem,
//     enquanto outro programa (um tom) segue intacto e a transmissão não reinicia.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { bandStats, BASE_URL, launchChrome, root, sourcePageHtml, startHelper, startStack, startToneApp, toneLevels, videoFacts, waitFor } from './harness.mjs';

const windows = process.platform === 'win32';
const noSound = process.env.E2E_HEADLESS === '1' && 'o Chrome sem janela não entrega áudio de verdade';
const skipMic = noSound;
const skipApps = noSound || (!windows && 'a captura por aplicativo só existe no Windows');
const PORT = 47898;
const TONE_HZ = 3000;
const NOISE_BAND = { lowHz: 100, highHz: 1500 };
const VOICE_BAND = { lowHz: 100, highHz: 4000 };

let stack;
let helper;
let noiseApp;
let toneApp;
let hostBrowser;
let guestBrowser;
let micBrowser;
let host;
let guest;
let talker;
let inviteUrl;

/** Voz real (a mesma dos testes de unidade) com ruído de ventilador por cima: vira o "microfone" do Chrome. */
function writeNoisyVoice() {
  const voice = readFileSync(resolve(root, 'web/test/fixtures/voz.wav'));
  const dataAt = voice.indexOf(Buffer.from('data')) + 8;
  const out = Buffer.from(voice);
  let seed = 12345;
  let low = 0;
  const smoothing = 1 - Math.exp((-2 * Math.PI * 1000) / 48000);
  for (let offset = dataAt; offset + 1 < out.length; offset += 2) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    low += smoothing * ((seed >>> 8) / 8388608 - 1 - low);
    // ~-34 dBFS de ruído contínuo: bem audível por baixo da voz.
    const sample = out.readInt16LE(offset) + low * 4200;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), offset);
  }
  const folder = resolve(root, 'e2e/.artifacts');
  mkdirSync(folder, { recursive: true });
  const file = resolve(folder, 'voz-com-ventilador.wav');
  writeFileSync(file, out);
  return file;
}

const row = (page, exe) => page.getByTestId(`mixer-row-${exe}`);
const modal = (page) => page.getByTestId('noise-modal');
const closeModal = (page) => page.getByRole('dialog', { name: 'Supressão de Ruído IA' }).getByRole('button', { name: 'Fechar' }).click();
const filterSwitch = (page) => modal(page).getByRole('switch', { name: /^Supressão de ruído em / });
const originalSwitch = (page) => modal(page).getByRole('switch', { name: /^Transmitir o som original de / });
const guestAudioId = () => guest.evaluate(() => document.querySelector('audio')?.srcObject?.getAudioTracks()[0]?.id);

async function waitForBand(page, band, check, what) {
  let stats;
  await waitFor(
    async () => {
      stats = await bandStats(page, band);
      return check(stats);
    },
    what,
    40_000,
  ).catch((error) => {
    throw new Error(`${error.message}. Última medição (dB): ${JSON.stringify(stats)}`);
  });
  return stats;
}

before(async () => {
  if (skipMic) return;
  stack = await startStack();
  hostBrowser = await launchChrome({ captureTitle: 'sr-fonte-ruido', headless: false });
  guestBrowser = await launchChrome({ headless: false });
  micBrowser = await launchChrome({ fakeMic: true, headless: false, args: [`--use-file-for-fake-audio-capture=${writeNoisyVoice()}`] });

  const context = await hostBrowser.newContext({ viewport: { width: 1672, height: 941 } });
  await context.addInitScript((port) => localStorage.setItem('shareroom:auxiliar-porta', String(port)), PORT);
  await (await context.newPage()).setContent(sourcePageHtml('sr-fonte-ruido', 880));
  host = await context.newPage();
  await host.goto(BASE_URL);
  await host.getByTestId('home-user-name').fill('Murillo');
  await host.getByTestId('home-create').click();
  await host.getByTestId('room').waitFor();
  inviteUrl = await host.getByTestId('room-link').inputValue();

  guest = await (await guestBrowser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await guest.goto(inviteUrl);
  await guest.getByTestId('gate-name').fill('Lucas');
  await guest.getByTestId('gate-join').click();
  await guest.getByTestId('room').waitFor();
});

after(async () => {
  await hostBrowser?.close();
  await guestBrowser?.close();
  await micBrowser?.close();
  await noiseApp?.stop();
  await toneApp?.stop();
  await helper?.stop();
  await stack?.stop();
});

let micBase;

test('microfone sem filtro: quem assiste ouve a voz e o ventilador', { skip: skipMic }, async () => {
  talker = await (await micBrowser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await talker.goto(inviteUrl);
  await talker.getByTestId('gate-name').fill('Bia');
  await talker.getByTestId('gate-join').click();
  await talker.getByTestId('room').waitFor();

  // Linha de base honesta: sem a supressão do navegador e sem o ajuste automático de volume.
  await talker.getByTestId('dock-settings').click();
  await talker.getByRole('switch', { name: 'Supressão de ruído do navegador' }).click();
  await talker.getByRole('switch', { name: 'Ajuste automático de volume' }).click();
  assert.equal(await talker.getByTestId('noise-button-mic').getAttribute('data-on'), 'false', 'a supressão por IA vem desligada');
  await talker.getByRole('dialog', { name: 'Configurações' }).getByRole('button', { name: 'Fechar' }).click();

  await talker.getByTestId('dock-mic').click();
  micBase = await waitForBand(guest, VOICE_BAND, (stats) => stats.tracks === 1 && stats.p90 - stats.p10 > 6 && stats.p10 > -75, 'a voz com ruído chegar a quem assiste');
});

test('microfone com IA no modo Forte: o ruído das pausas cai e a voz fica no mesmo nível, sem republicar', { skip: skipMic }, async () => {
  const trackBefore = await guestAudioId();
  await talker.getByTestId('dock-settings').click();
  await talker.getByTestId('noise-button-mic').click();
  await modal(talker).waitFor();
  await talker.getByTestId('noise-level-forte').click();
  await filterSwitch(talker).click();
  await waitFor(async () => (await modal(talker).getAttribute('data-engine')) === 'ia', 'o modelo de IA entrar no ar no microfone');
  assert.match(await talker.getByTestId('noise-status').textContent(), /modelo de IA \(RNNoise\), neste computador/);

  const filtered = await waitForBand(guest, VOICE_BAND, (stats) => stats.tracks === 1 && micBase.p10 - stats.p10 >= 10, 'o ruído das pausas cair pelo menos 10 dB');
  assert.ok(Math.abs(filtered.p90 - micBase.p90) <= 5, `a voz segue no mesmo nível: antes ${micBase.p90} dB, depois ${filtered.p90} dB`);
  assert.equal(await guestAudioId(), trackBefore, 'a faixa do microfone é a mesma (não houve republicação)');
  console.log(`      microfone — pausas: ${micBase.p10} → ${filtered.p10} dB; voz: ${micBase.p90} → ${filtered.p90} dB`);

  // O painel mostra medição de verdade, vinda do filtro.
  await waitFor(async () => Number(await talker.getByTestId('noise-cpu').getAttribute('data-value')) > 0, 'a medição de processamento aparecer');
  const cpu = Number(await talker.getByTestId('noise-cpu').getAttribute('data-value'));
  assert.ok(cpu < 15, `o filtro é leve: ${cpu}% de um núcleo`);
  console.log(`      microfone — processamento medido no Chrome: ${cpu}% de um núcleo`);
});

test('interruptor geral e comparação: o som original volta na hora, e o filtro retorna depois', { skip: skipMic }, async () => {
  await talker.getByRole('switch', { name: 'Desligar toda a supressão de ruído' }).click();
  await waitForBand(guest, VOICE_BAND, (stats) => micBase.p10 - stats.p10 <= 4, 'o ruído voltar com o interruptor geral');
  await talker.getByRole('switch', { name: 'Desligar toda a supressão de ruído' }).click();
  await waitForBand(guest, VOICE_BAND, (stats) => micBase.p10 - stats.p10 >= 10, 'o filtro voltar a agir');

  await originalSwitch(talker).click();
  await waitForBand(guest, VOICE_BAND, (stats) => micBase.p10 - stats.p10 <= 4, 'o original ser transmitido na comparação');
  await originalSwitch(talker).click();

  // Gravar e ouvir as duas versões: a gravação existe e as duas reproduções funcionam.
  await talker.getByTestId('noise-record').click();
  await talker.getByTestId('noise-play-wet').waitFor({ timeout: 15_000 });
  await talker.getByTestId('noise-play-dry').click();
  await talker.getByTestId('noise-play-wet').click();
  await talker.getByTestId('noise-play-wet').click();
});

test('a escolha do microfone fica guardada e a supressão do navegador fica em pausa (sem filtrar duas vezes)', { skip: skipMic }, async () => {
  await closeModal(talker);
  const browserNs = talker.getByRole('switch', { name: 'Supressão de ruído do navegador' });
  assert.equal(await browserNs.isDisabled(), true);
  const saved = await talker.evaluate(() => JSON.parse(localStorage.getItem('shareroom:ruido')));
  assert.deepEqual(saved.mic, { on: true, level: 'forte' });
  await talker.context().close();
  await waitFor(async () => (await guest.locator('audio').count()) === 0, 'o microfone sumir para quem assiste');
});

let appBase;
let toneBase;

test('mixer: ruído e tom de dois aplicativos chegam a quem assiste, nada filtrado por conta própria', { skip: skipApps }, async () => {
  helper = await startHelper({ port: PORT });
  noiseApp = await startToneApp('ruido-teste', 0, { noise: true, amplitude: 0.02 });
  toneApp = await startToneApp('spotify-teste', TONE_HZ);

  await host.getByRole('button', { name: 'Opções de áudio' }).click();
  await host.getByTestId('open-mixer').click();
  await waitFor(async () => (await host.getByTestId('mixer-panel').getAttribute('data-phase')) === 'conectado', 'o mixer conectar ao auxiliar');
  await row(host, noiseApp.name).waitFor();
  await row(host, toneApp.name).waitFor();
  assert.equal(await host.getByTestId(`noise-button-${noiseApp.name}`).getAttribute('data-on'), 'false');
  assert.equal(await host.getByTestId(`noise-button-${toneApp.name}`).getAttribute('data-on'), 'false');

  await row(host, noiseApp.name).getByRole('switch').click();
  await row(host, toneApp.name).getByRole('switch').click();
  await host.getByTestId('dock-share').click();
  await guest.getByTestId('stage-owner').waitFor();

  appBase = await waitForBand(guest, NOISE_BAND, (stats) => stats.tracks === 1 && stats.p50 > -75, 'o ruído do aplicativo chegar a quem assiste');
  toneBase = (await toneLevels(guest, [TONE_HZ])).levels[TONE_HZ];
  assert.ok(toneBase > -70, `o tom do outro aplicativo também chega: ${toneBase} dB`);
});

test('mixer: filtro só no aplicativo com ruído — ele cai, o outro aplicativo não muda, a transmissão não reinicia', { skip: skipApps }, async () => {
  const trackBefore = await guestAudioId();
  const videoBefore = await videoFacts(guest);

  await host.getByTestId(`noise-button-${noiseApp.name}`).click();
  await modal(host).waitFor();
  await host.getByTestId('noise-level-forte').click();
  await filterSwitch(host).click();
  await waitFor(async () => (await modal(host).getAttribute('data-engine')) === 'ia', 'o modelo de IA entrar no ar nessa fonte');

  const filtered = await waitForBand(guest, NOISE_BAND, (stats) => appBase.p50 - stats.p50 >= 12, 'o ruído do aplicativo cair pelo menos 12 dB');
  const tone = (await toneLevels(guest, [TONE_HZ])).levels[TONE_HZ];
  assert.ok(Math.abs(tone - toneBase) <= 3, `o outro aplicativo não foi tocado: ${toneBase} → ${tone} dB`);
  assert.equal(await guestAudioId(), trackBefore, 'a faixa de áudio é a mesma (não houve republicação)');
  assert.ok((await videoFacts(guest)).frames > videoBefore.frames, 'o vídeo seguiu sem interrupção');
  assert.equal(await host.getByTestId(`noise-button-${toneApp.name}`).getAttribute('data-running'), 'false', 'o outro aplicativo segue sem filtro');
  console.log(`      aplicativo — ruído: ${appBase.p50} → ${filtered.p50} dB (Forte); tom vizinho: ${toneBase} → ${tone} dB`);

  await waitFor(async () => Number(await host.getByTestId('noise-reduction').getAttribute('data-value')) >= 10, 'o indicador de redução mostrar a queda');
});

test('mixer: trocar a intensidade ao vivo (Leve limita a redução a ~12 dB)', { skip: skipApps }, async () => {
  await host.getByTestId('noise-level-leve').click();
  const light = await waitForBand(guest, NOISE_BAND, (stats) => appBase.p50 - stats.p50 >= 7 && appBase.p50 - stats.p50 <= 16, 'a redução ficar perto de 12 dB no modo Leve');
  console.log(`      aplicativo — ruído no modo Leve: ${appBase.p50} → ${light.p50} dB`);
});

test('mixer: desligar o filtro devolve a fonte à mixagem comum, com o som original', { skip: skipApps }, async () => {
  await filterSwitch(host).click();
  await waitForBand(guest, NOISE_BAND, (stats) => Math.abs(appBase.p50 - stats.p50) <= 3, 'o ruído voltar ao nível original');
  assert.equal(await modal(host).getAttribute('data-engine'), '');
  await closeModal(host);
  assert.match(await row(host, noiseApp.name).textContent(), /transmitindo/);
});

test('jogo, música e vídeo: o filtro só liga depois de o usuário confirmar o aviso', { skip: skipApps }, async () => {
  await host.getByTestId(`noise-button-${toneApp.name}`).click();
  await modal(host).waitFor();
  const toggle = filterSwitch(host);
  assert.match(await modal(host).textContent(), /Não recomendado em música e vídeo/);
  assert.equal(await toggle.isDisabled(), true, 'bloqueado até confirmar');
  await host.getByTestId('noise-agree').check();
  assert.equal(await toggle.isDisabled(), false);
  await toggle.click();
  await waitFor(async () => (await modal(host).getAttribute('data-engine')) === 'ia', 'o filtro ligar depois da confirmação');
  assert.equal(await host.getByTestId(`noise-button-${toneApp.name}`).getAttribute('data-running'), 'true');
  await filterSwitch(host).click();
  await waitFor(async () => (await modal(host).getAttribute('data-engine')) === '', 'o filtro sair ao desligar');
  await closeModal(host);
});
