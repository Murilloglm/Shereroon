// Recursos da sala além do fluxo básico: microfone, duas transmissões ao mesmo tempo, trancar a sala,
// modo cinema/tela cheia, layout de celular e reconexão automática quando o SFU cai.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, numberIn, receivedTones, sleep, sourcePageHtml, startStack, videoFacts, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
const noSound = headless && 'o Chrome sem janela não renderiza áudio';

let stack;
let hostBrowser;
let guestBrowser;
let micBrowser;
let host;
let guest;
let inviteUrl;

async function enter(browser, name, viewport = { width: 1440, height: 900 }, extra = {}) {
  const context = await browser.newContext({ viewport, ...extra });
  const page = await context.newPage();
  await page.goto(inviteUrl);
  await page.getByTestId('gate-name').fill(name);
  await page.getByTestId('gate-join').click();
  return page;
}

/** Espera até alguma faixa de áudio recebida ter o tom esperado (ou qualquer som, se `hz` for null). */
async function waitForTone(page, hz, what) {
  let tones = [];
  await waitFor(
    async () => {
      tones = await receivedTones(page, { settleMs: 700 });
      return tones.some((tone) => tone.db > -75 && (hz === null || Math.abs(tone.hz - hz) < 15));
    },
    what,
    20_000,
  ).catch((error) => {
    throw new Error(`${error.message}. Recebido: ${JSON.stringify(tones)}`);
  });
}

before(async () => {
  stack = await startStack();
  hostBrowser = await launchChrome({ captureTitle: 'sr-fonte-do-dono', headless });
  guestBrowser = await launchChrome({ captureTitle: 'sr-fonte-do-convidado', headless });
  // Navegador à parte para o microfone: o aparelho sintético do Chrome não deve interferir nas capturas de aba.
  micBrowser = await launchChrome({ fakeMic: true, headless });

  const context = await hostBrowser.newContext({ viewport: { width: 1600, height: 900 } });
  await (await context.newPage()).setContent(sourcePageHtml('sr-fonte-do-dono', 880));
  host = await context.newPage();
  await host.goto(BASE_URL);
  await host.getByTestId('home-user-name').fill('Murillo');
  await host.getByTestId('home-room-name').fill('Sala de testes');
  await host.getByTestId('home-create').click();
  await host.getByTestId('room').waitFor();
  inviteUrl = await host.getByTestId('room-link').inputValue();

  const guestContext = await guestBrowser.newContext({ viewport: { width: 1440, height: 900 } });
  await (await guestContext.newPage()).setContent(sourcePageHtml('sr-fonte-do-convidado', 1320));
  guest = await guestContext.newPage();
  await guest.goto(inviteUrl);
  await guest.getByTestId('gate-name').fill('Ana');
  await guest.getByTestId('gate-join').click();
  await guest.getByTestId('room').waitFor();
});

after(async () => {
  await hostBrowser?.close();
  await guestBrowser?.close();
  await micBrowser?.close();
  await stack?.stop();
});

test('microfone: o que uma convidada fala chega ao dono', { skip: noSound }, async () => {
  const talker = await enter(micBrowser, 'Bia');
  await talker.getByTestId('room').waitFor();
  const row = host.getByTestId('participant').filter({ hasText: 'Bia' });
  await row.waitFor();
  assert.equal(await row.getByTestId('mic-off').count(), 1);

  await talker.getByTestId('dock-mic').click();
  await waitFor(async () => (await row.getByTestId('mic-off').count()) === 0, 'o dono ver o microfone da Bia ligado');
  // O microfone sintético do Chrome emite bipes; qualquer som medido prova que o caminho inteiro funciona.
  await waitForTone(host, null, 'o áudio do microfone chegar ao dono');

  await talker.getByTestId('dock-mic').click();
  await waitFor(async () => (await row.getByTestId('mic-off').count()) === 1, 'o dono ver o microfone da Bia desligado');
  await talker.context().close();
  await waitFor(async () => (await host.getByTestId('participant').count()) === 2, 'a Bia sair da lista');
});

test('duas pessoas compartilham ao mesmo tempo e cada um escolhe o que assistir', async () => {
  await host.getByTestId('dock-share').click();
  await guest.getByTestId('stage-owner').waitFor();
  await guest.getByTestId('dock-share').click();

  // Com duas transmissões, o player ganha abas para alternar.
  const hostTabs = host.getByRole('tab');
  await waitFor(async () => (await hostTabs.count()) === 2, 'o dono ver as duas transmissões');
  assert.deepEqual((await hostTabs.allTextContents()).sort(), ['Ana', 'Minha tela']);

  await hostTabs.filter({ hasText: 'Ana' }).click();
  assert.match(await host.getByTestId('stage-owner').textContent(), /Tela de Ana/);
  await waitFor(async () => (await videoFacts(host)).frames > 20, 'o dono receber o vídeo da Ana');
  assert.equal(await host.getByTestId('stats-card').getAttribute('data-role'), 'assistindo');
  await waitFor(async () => numberIn(await host.getByTestId('stat-fps').textContent().catch(() => '')) > 0, 'o dono medir o FPS recebido da Ana');

  assert.match(await guest.getByTestId('stage-owner').textContent(), /Tela de Murillo/);
  await waitFor(async () => (await videoFacts(guest)).frames > 20, 'a Ana continuar recebendo o vídeo do dono');
});

test('só toca o áudio da transmissão em destaque', { skip: noSound }, async () => {
  await waitForTone(host, 1320, 'o dono ouvir o tom da tela da Ana (1320 Hz)');
  await waitForTone(guest, 880, 'a Ana ouvir o tom da tela do dono (880 Hz)');
  const hostTones = await receivedTones(host);
  assert.ok(!hostTones.some((tone) => tone.db > -75 && Math.abs(tone.hz - 880) < 15), 'o dono não ouve a própria transmissão de volta');
});

test('modo cinema esconde as laterais; tela cheia funciona', async () => {
  await host.getByTestId('stage-cinema').click();
  assert.equal(await host.getByTestId('participants').count(), 0);
  assert.equal(await host.getByTestId('quality-card').count(), 0);
  await waitFor(async () => (await videoFacts(host)).frames > 0, 'o vídeo continuar no modo cinema');
  await host.getByTestId('stage-cinema').click();
  assert.equal(await host.getByTestId('participants').count(), 1);

  // Com várias janelas de teste abertas, só a que está na frente pode pedir tela cheia.
  await host.bringToFront();
  await host.getByTestId('stage-fullscreen').click();
  await waitFor(() => host.evaluate(() => document.fullscreenElement?.dataset.testid === 'stage'), 'o player entrar em tela cheia');
  await host.evaluate(() => document.exitFullscreen());
  await waitFor(() => host.evaluate(() => document.fullscreenElement === null), 'sair da tela cheia');
});

test('sala trancada: ninguém novo entra, até o dono destrancar', async () => {
  await host.getByRole('switch', { name: 'Trancar a sala' }).click();
  await waitFor(async () => (await host.getByRole('switch', { name: 'Trancar a sala' }).getAttribute('aria-checked')) === 'true', 'a sala aparecer trancada');

  const late = await enter(guestBrowser, 'Atrasado');
  await late.getByTestId('gate-error').waitFor();
  assert.match(await late.getByTestId('gate-error').textContent(), /trancou a sala/);

  await host.getByRole('switch', { name: 'Trancar a sala' }).click();
  await waitFor(async () => (await host.getByRole('switch', { name: 'Trancar a sala' }).getAttribute('aria-checked')) === 'false', 'a sala aparecer destrancada');
  await late.getByTestId('gate-join').click();
  await late.getByTestId('room').waitFor();
  await late.context().close();
  await waitFor(async () => (await host.getByTestId('participant').count()) === 2, 'o atrasado sair da lista');
});

test('celular: layout próprio e vídeo chegando', async () => {
  const phone = await enter(guestBrowser, 'Rafa', { width: 390, height: 844 }, { deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.getByTestId('room').waitFor();
  await phone.getByTestId('mobile-mic').waitFor();
  assert.equal(await phone.getByTestId('dock-share').count(), 0, 'a barra de computador não aparece no celular');
  assert.equal(await phone.getByTestId('stage-cinema').count(), 0);
  await waitFor(async () => (await videoFacts(phone)).frames > 20, 'o celular receber vídeo');
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `sem rolagem horizontal no celular (sobra de ${overflow}px)`);
  await phone.context().close();
});

test('o SFU cai e volta: todos reconectam sozinhos e a transmissão continua', async (t) => {
  if (!stack.ownsLivekit) return t.skip('o LiveKit já estava rodando fora do teste; não vou reiniciá-lo');
  await guest.getByRole('tab').filter({ hasText: 'Murillo' }).click();
  await waitFor(async () => (await videoFacts(guest)).frames > 5, 'a Ana estar assistindo ao dono antes da queda');

  const restarting = stack.restartLivekit(3000);
  await waitFor(async () => (await host.getByTestId('connection').getAttribute('data-phase')) === 'reconnecting', 'o dono perceber a queda', 20_000);
  await restarting;

  await waitFor(async () => (await host.getByTestId('connection').getAttribute('data-phase')) === 'connected', 'o dono reconectar', 60_000);
  await waitFor(async () => (await guest.getByTestId('connection').getAttribute('data-phase')) === 'connected', 'a Ana reconectar', 60_000);

  // Ninguém clicou em nada: a captura do dono seguiu viva e foi republicada.
  await waitFor(async () => (await host.getByTestId('participant').count()) === 2, 'os dois de volta na lista', 30_000);
  await waitFor(async () => (await guest.getByRole('tab').filter({ hasText: 'Murillo' }).count()) === 1, 'a transmissão do dono reaparecer para a Ana', 30_000);
  await guest.getByRole('tab').filter({ hasText: 'Murillo' }).click();
  const before = (await videoFacts(guest)).frames;
  await waitFor(async () => (await videoFacts(guest)).frames > before + 20, 'o vídeo do dono voltar a chegar', 30_000);
  await waitFor(async () => numberIn(await host.getByTestId('headcount').textContent()) === 1, 'o dono voltar a ter 1 espectador');
  await sleep(500);
});
