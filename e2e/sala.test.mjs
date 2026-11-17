// Fluxo completo de uma sala, com dois navegadores reais passando pelo SFU:
// criar sala com senha → convidar → compartilhar → assistir (vídeo e áudio) → mudar a
// qualidade ao vivo → expulsar. A fonte capturada é uma aba animada de verdade.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, numberIn, receivedTones, sleep, sourcePageHtml, startStack, videoFacts, waitFor } from './harness.mjs';

const SOURCE_TITLE = 'sr-fonte-de-teste';
// Com janela, o Chrome usa a placa de vídeo e renderiza áudio de verdade. Sem janela (E2E_HEADLESS=1) o teste
// de áudio é pulado, porque o Chrome sem janela não produz som.
const headless = process.env.E2E_HEADLESS === '1';
const PASSWORD = 'pão de queijo 42';

let stack;
let hostBrowser;
let guestBrowser;
let host;
let guest;
let inviteUrl;

before(async () => {
  stack = await startStack();
  hostBrowser = await launchChrome({ captureTitle: SOURCE_TITLE, headless });
  guestBrowser = await launchChrome({ fakeMic: true, headless });
});

after(async () => {
  await hostBrowser?.close();
  await guestBrowser?.close();
  await stack?.stop();
});

test('o dono cria uma sala com senha e entra direto', async () => {
  const context = await hostBrowser.newContext({ viewport: { width: 1600, height: 900 } });
  const source = await context.newPage();
  await source.setContent(sourcePageHtml(SOURCE_TITLE));

  host = await context.newPage();
  await host.goto(BASE_URL);
  await host.getByTestId('home-user-name').fill('Murillo');
  await host.getByTestId('home-room-name').fill('Jogatina com a galera');
  await host.getByTestId('home-password').fill(PASSWORD);
  await host.getByTestId('home-create').click();

  await host.getByTestId('room').waitFor();
  assert.equal(await host.getByTestId('room-name').textContent(), 'Jogatina com a galera');
  assert.match(host.url(), /#\/sala\/[A-Za-z0-9_-]{30,}$/);
  inviteUrl = await host.getByTestId('room-link').inputValue();
  assert.equal(inviteUrl, host.url());

  const people = host.getByTestId('participant');
  await assert.doesNotReject(people.first().waitFor());
  assert.equal(await people.count(), 1);
  assert.match(await people.first().textContent(), /Você.*Anfitrião/);
});

test('o convidado precisa da senha certa para entrar', async () => {
  const context = await guestBrowser.newContext({ viewport: { width: 1280, height: 800 } });
  guest = await context.newPage();
  await guest.goto(inviteUrl);

  assert.equal(await guest.getByTestId('gate-room-name').textContent(), 'Jogatina com a galera');
  await guest.getByTestId('gate-name').fill('Ana');
  await guest.getByTestId('gate-password').fill('senha errada');
  await guest.getByTestId('gate-join').click();
  await guest.getByTestId('gate-error').waitFor();
  assert.match(await guest.getByTestId('gate-error').textContent(), /Senha incorreta/);

  await guest.getByTestId('gate-password').fill(PASSWORD);
  await guest.getByTestId('gate-join').click();
  await guest.getByTestId('room').waitFor();

  await waitFor(async () => (await host.getByTestId('participant').count()) === 2, 'o dono ver 2 participantes');
  const names = await host.getByTestId('participant-name').allTextContents();
  assert.deepEqual(names.sort(), ['Ana', 'Você']);
  assert.equal(await guest.getByTestId('kick').count(), 0, 'convidado não pode ver o botão de expulsar');

  // Sem ninguém transmitindo, o palco mostra os cartões de quem está na chamada, sem mensagem vazia, sem
  // estatísticas, sem painel de qualidade aberto e sem "Parar transmissão".
  await waitFor(async () => (await host.getByTestId('call-card').count()) === 2, 'os dois cartões no palco');
  assert.equal(await host.getByTestId('stage').getAttribute('data-view'), 'pessoas');
  assert.doesNotMatch(await host.getByTestId('stage').textContent(), /Ninguém está compartilhando/);
  assert.equal(await host.getByTestId('stats-card').count(), 0);
  assert.equal(await host.getByTestId('quality-card').count(), 0);
  assert.equal(await host.getByTestId('dock-stop').count(), 0);
  assert.deepEqual((await host.getByTestId('call-card-name').allTextContents()).sort(), ['Ana', 'Murillo (você)']);
});

test('compartilhar a tela: o vídeo chega de verdade ao convidado', async () => {
  // A qualidade fica num painel aberto pelo botão da barra, e dá para escolher antes de transmitir.
  await host.getByTestId('dock-quality').click();
  await host.getByTestId('quality-mode-manual').click();
  await host.getByTestId('quality-res-720').click();
  await host.getByTestId('quality-fps-60').click();
  await host.keyboard.press('Escape');
  await host.getByTestId('dock-share').click();

  await host.getByTestId('stage-owner').waitFor();
  assert.match(await host.getByTestId('stage-owner').textContent(), /Você está compartilhando a tela/);
  await host.getByTestId('live-pill').waitFor();
  assert.match(await host.getByTestId('headcount').textContent(), /^1 assistindo$/);

  await guest.getByTestId('stage-owner').waitFor();
  assert.match(await guest.getByTestId('stage-owner').textContent(), /Tela de Murillo/);

  // Quadros decodificados aumentando = vídeo real fluindo, não uma imagem parada.
  await waitFor(async () => (await videoFacts(guest)).frames > 30, 'o convidado decodificar quadros');
  const first = await videoFacts(guest);
  await sleep(1500);
  const second = await videoFacts(guest);
  assert.ok(second.frames - first.frames > 30, `quadros novos em 1,5 s: ${second.frames - first.frames}`);
  assert.ok(second.width > 0 && second.height > 0 && second.height <= 720, `tamanho recebido: ${second.width}×${second.height}`);

  // Com vídeo, aparecem "Parar transmissão" (só para quem transmite) e as estatísticas, num painel sobre o vídeo.
  assert.equal(await host.getByTestId('dock-stop').count(), 1);
  assert.equal(await guest.getByTestId('dock-stop').count(), 0);
  assert.equal(await guest.getByTestId('stats-card').count(), 1);
  // Voltar para os participantes sem deixar de assistir, e voltar para a transmissão.
  await guest.getByTestId('stage-people').click();
  await waitFor(async () => (await guest.getByTestId('call-card').count()) === 2, 'o convidado ver os cartões');
  assert.equal(await guest.getByTestId('call-card-live').count(), 1, 'quem transmite aparece "Ao vivo" no cartão');
  await guest.getByTestId('stage-back').click();
  await guest.getByTestId('stage-owner').waitFor();
  await waitFor(async () => (await videoFacts(guest)).frames > 30, 'o vídeo voltar ao palco');
});

test('a resolução pedida se mantém: o WebRTC não derruba a imagem por conta própria', { skip: headless && 'sem placa de vídeo no modo sem janela' }, async () => {
  // Regressão: com "preservar FPS" o Chrome derrubava 720p para ~130p nos primeiros segundos e não voltava.
  await sleep(8000);
  const facts = await videoFacts(guest);
  assert.ok(facts.height >= 600 && facts.height <= 720, `depois de 8 s o convidado recebe ${facts.width}×${facts.height}`);
  const sent = numberIn(await host.getByTestId('stage-real').textContent());
  assert.equal(sent, facts.height, 'a altura enviada é a mesma que chega');
  const fps = numberIn(await host.getByTestId('stat-fps').textContent());
  assert.ok(fps >= 50 && fps <= 62, `FPS enviado para um pedido de 60: ${fps}`);
  assert.equal(await host.locator('[data-testid^="diagnosis-"]').count() - await host.getByTestId('diagnosis-fonte_menor').count(), 0, 'nenhum aviso de qualidade abaixo do pedido');
});

test('as estatísticas mostram valores medidos nos dois lados', async () => {
  await waitFor(async () => numberIn(await host.getByTestId('stat-fps').textContent()) > 0, 'FPS medido no dono');
  await waitFor(async () => numberIn(await guest.getByTestId('stat-fps').textContent()) > 0, 'FPS medido no convidado');
  await waitFor(async () => numberIn(await host.getByTestId('stat-bitrate').textContent()) > 0, 'bitrate medido no dono');
  await waitFor(async () => numberIn(await guest.getByTestId('stat-bitrate').textContent()) > 0, 'bitrate medido no convidado');

  assert.equal(await host.getByTestId('stats-card').getAttribute('data-role'), 'transmitindo');
  assert.equal(await guest.getByTestId('stats-card').getAttribute('data-role'), 'assistindo');

  const hostFps = numberIn(await host.getByTestId('stat-fps').textContent());
  const guestFps = numberIn(await guest.getByTestId('stat-fps').textContent());
  assert.ok(hostFps > 5 && hostFps <= 62, `FPS enviado: ${hostFps}`);
  assert.ok(guestFps > 5 && guestFps <= 62, `FPS recebido: ${guestFps}`);

  // O selo sobre o vídeo mostra a altura REAL do quadro recebido.
  const badge = await guest.getByTestId('stage-real').textContent();
  const facts = await videoFacts(guest);
  assert.equal(numberIn(badge), facts.height, `selo "${badge}" × vídeo ${facts.height}`);
});

test('o áudio da aba compartilhada chega ao convidado (tom de 880 Hz)', { skip: headless && 'o Chrome sem janela não renderiza áudio' }, async () => {
  let tones = [];
  await waitFor(async () => {
    tones = await receivedTones(guest);
    return tones.some((tone) => Math.abs(tone.hz - 880) < 12 && tone.db > -70);
  }, 'o tom de 880 Hz chegar ao convidado', 20_000).catch((error) => {
    throw new Error(`${error.message}. Recebido: ${JSON.stringify(tones)}`);
  });
});

test('mudar a qualidade com a transmissão no ar, sem reiniciar', async () => {
  const before = await videoFacts(guest);
  const sidBefore = await guest.evaluate(() => document.querySelector('[data-testid="stage-video"]').srcObject?.getVideoTracks()[0]?.id);

  await host.getByTestId('dock-quality').click();
  await host.getByTestId('quality-res-480').click();
  await host.getByTestId('quality-fps-30').click();
  await host.keyboard.press('Escape');

  await waitFor(async () => {
    const { height } = await videoFacts(guest);
    return height <= 480 && height >= (headless ? 100 : 400);
  }, 'o convidado receber ~480p', 20_000);
  await waitFor(async () => {
    const fps = numberIn(await guest.getByTestId('stat-fps').textContent());
    return fps !== null && fps > 5 && fps <= 32;
  }, 'o convidado receber ~30 FPS', 20_000);

  const after = await videoFacts(guest);
  const sidAfter = await guest.evaluate(() => document.querySelector('[data-testid="stage-video"]').srcObject?.getVideoTracks()[0]?.id);
  assert.equal(sidAfter, sidBefore, 'a faixa de vídeo do convidado continua a mesma (não houve republicação)');
  assert.ok(after.frames > before.frames, 'os quadros continuaram chegando durante a troca');
  assert.ok(after.height < before.height, `altura recebida: ${before.height} → ${after.height}`);
  assert.equal(numberIn(await guest.getByTestId('stage-real').textContent()), after.height, 'o selo do convidado mostra a altura real');
  await waitFor(async () => numberIn(await host.getByTestId('stage-real').textContent()) === after.height, 'o selo do dono mostrar a mesma altura real');
});

test('parar e voltar a compartilhar é imediato', async () => {
  await host.getByTestId('dock-stop').click();
  await waitFor(async () => (await guest.getByTestId('stage-owner').count()) === 0, 'a transmissão sumir para o convidado');
  assert.equal(await host.getByTestId('live-pill').count(), 0);

  const started = Date.now();
  await host.getByTestId('dock-share').click();
  await guest.getByTestId('stage-owner').waitFor();
  const framesAtStart = (await videoFacts(guest)).frames;
  await waitFor(async () => (await videoFacts(guest)).frames > framesAtStart + 10, 'vídeo de volta no convidado');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 8000, `voltou em ${elapsed} ms`);
});

test('o dono expulsa o convidado, que não consegue voltar', async () => {
  await host.getByTestId('participant').filter({ hasText: 'Ana' }).hover();
  await host.getByTestId('kick').click();
  await host.getByTestId('dialog-confirm').click();

  await guest.getByText('Você foi removido da sala').waitFor();
  assert.equal(await guest.getByTestId('gate-return').count(), 0);
  await waitFor(async () => (await host.getByTestId('participant').count()) === 1, 'o dono voltar a ver só ele');

  // Recarregar e tentar entrar de novo com a mesma sessão: o backend recusa.
  await guest.reload();
  await guest.getByTestId('gate-name').fill('Ana');
  await guest.getByTestId('gate-join').click();
  await guest.getByTestId('gate-error').waitFor();
  assert.match(await guest.getByTestId('gate-error').textContent(), /removido desta sala/);
});
