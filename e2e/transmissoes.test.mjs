// Escolha de transmissões e prévia por hover, com duas telas de verdade e uma terceira pessoa assistindo:
// assistir várias ao mesmo tempo, mosaico e foco, parar de assistir (a tela deixa de ser recebida) e a
// prévia em miniatura ao passar o mouse sobre quem transmite (sem som e sem ficar conectada depois).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, sourcePageHtml, startStack, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
let stack;
let hostBrowser;
let guestBrowser;
let viewerBrowser;
let host;
let guest;
let viewer;

/** Conta os bytes de vídeo recebidos por faixa (todas as conexões WebRTC da página). */
const RECORD_PCS = () => {
  const Original = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = function (...args) {
    const pc = new Original(...args);
    window.__pcs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = Original.prototype;
};


/** Quantas telas estão de fato chegando: faixas de vídeo recebidas cujos bytes aumentaram em 1,5 s. */
async function activeVideos(page) {
  const sample = () =>
    page.evaluate(async () => {
      const out = {};
      for (const pc of window.__pcs) {
        (await pc.getStats()).forEach((stat) => {
          if (stat.type === 'inbound-rtp' && stat.kind === 'video') out[stat.id] = stat.bytesReceived ?? 0;
        });
      }
      return out;
    });
  const first = await sample();
  await page.waitForTimeout(1500);
  const second = await sample();
  return Object.keys(second).filter((id) => second[id] > (first[id] ?? 0)).length;
}


async function enter(browser, name, sourceTitle, toneHz) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await context.addInitScript(RECORD_PCS);
  if (sourceTitle) await (await context.newPage()).setContent(sourcePageHtml(sourceTitle, toneHz));
  return context.newPage();
}

before(async () => {
  stack = await startStack();
  hostBrowser = await launchChrome({ captureTitle: 'sr-tela-ana', headless });
  guestBrowser = await launchChrome({ captureTitle: 'sr-tela-beto', headless });
  viewerBrowser = await launchChrome({ headless });

  host = await enter(hostBrowser, 'Ana', 'sr-tela-ana', 880);
  await host.goto(`${BASE_URL}/#/salas`);
  await host.getByTestId('home-user-name').fill('Ana');
  await host.getByTestId('home-room-name').fill('Transmissões');
  await host.getByTestId('home-create').click();
  await host.getByTestId('room').waitFor();
  const invite = await host.getByTestId('room-link').inputValue();

  guest = await enter(guestBrowser, 'Beto', 'sr-tela-beto', 1320);
  viewer = await enter(viewerBrowser, 'Caio');
  for (const [page, name] of [[guest, 'Beto'], [viewer, 'Caio']]) {
    await page.goto(invite);
    await page.getByTestId('gate-name').fill(name);
    await page.getByTestId('gate-join').click();
    await page.getByTestId('room').waitFor();
  }
});

after(async () => {
  await hostBrowser?.close();
  await guestBrowser?.close();
  await viewerBrowser?.close();
  await stack?.stop();
});

test('com duas telas no ar, quem assiste recebe só a primeira até escolher a outra', async () => {
  await host.getByTestId('dock-share').click();
  await viewer.getByTestId('stage-owner').waitFor();
  assert.match(await viewer.getByTestId('stage-owner').textContent(), /Tela de Ana — Aba do navegador/);
  await guest.getByTestId('dock-share').click();

  // A tela do Beto aparece na lista, mas não é assinada sozinha.
  await viewer.getByTestId('stream-picker').click();
  const rows = viewer.getByTestId('stream-row');
  await waitFor(async () => (await rows.count()) === 2, 'as duas transmissões aparecerem na lista');
  const beto = rows.filter({ hasText: 'Beto' });
  assert.equal(await beto.getByTestId('stream-watch').count(), 1, 'o Beto aparece com o botão "Assistir"');
  assert.equal(await viewer.getByTestId('stage-tile').count(), 0);

  await beto.getByTestId('stream-watch').click();
  await waitFor(async () => (await viewer.getByTestId('stage-owner').textContent()).includes('Beto'), 'o Beto ir para o destaque');
  // A outra continua sendo assistida, em miniatura.
  await viewer.getByTestId('stage-tile').filter({ hasText: 'Ana' }).waitFor();
});

test('mosaico mostra as duas do mesmo tamanho; foco volta a ter uma grande', async () => {
  await viewer.getByTestId('stage-layout').click();
  await viewer.getByTestId('stage-mosaic').waitFor();
  assert.equal(await viewer.getByTestId('stage').getAttribute('data-layout'), 'mosaico');
  await waitFor(
    async () =>
      viewer.evaluate(() =>
        [...document.querySelectorAll('[data-testid="stage-video"],[data-testid="stage-tile-video"]')].every((video) => video.videoWidth > 0),
      ),
    'os dois vídeos estarem chegando',
  );
  await viewer.getByTestId('stage-layout').click();
  assert.equal(await viewer.getByTestId('stage').getAttribute('data-layout'), 'foco');
});

test('parar de assistir tira a tela da página e ela deixa de ser recebida', async () => {
  assert.equal(await activeVideos(viewer), 2, 'as duas telas chegam enquanto as duas são assistidas');
  await viewer.getByTestId('stage-tile').filter({ hasText: 'Ana' }).hover();
  await viewer.getByTestId('stage-tile-stop').click();
  await waitFor(async () => (await viewer.getByTestId('stage-tile').count()) === 0, 'a miniatura da Ana sumir');
  await viewer.waitForTimeout(1500);
  assert.equal(await activeVideos(viewer), 1, 'só a tela que continua sendo assistida chega');

  // Não volta sozinha: a Ana fica com "Assistir" na lista.
  await viewer.getByTestId('stream-picker').click();
  await viewer.getByTestId('stream-row').filter({ hasText: 'Ana' }).getByTestId('stream-watch').waitFor();
  await viewer.keyboard.press('Escape');
});

test('prévia ao passar o mouse: vídeo ao vivo, sem som, e desconecta depois de fechar', async () => {
  assert.equal(await activeVideos(viewer), 1);
  const row = viewer.getByTestId('participant').filter({ hasText: 'Ana' });
  await row.locator('[data-preview="true"]').hover();
  const preview = viewer.getByTestId('stream-preview');
  await preview.waitFor();
  assert.match(await preview.textContent(), /Ana/);
  await waitFor(
    async () => viewer.evaluate(() => document.querySelector('[data-testid="stream-preview-video"]')?.videoWidth > 0),
    'o vídeo da prévia chegar',
  );
  await waitFor(async () => /\d+p/.test(await viewer.getByTestId('stream-preview-real').textContent()), 'a prévia mostrar a resolução medida');
  assert.equal(await viewer.evaluate(() => document.querySelector('[data-testid="stream-preview-video"]').muted), true, 'a prévia é muda');
  assert.equal(await activeVideos(viewer), 2, 'durante a prévia a tela da Ana chega');
  // Som da tela da Ana não é assinado na prévia: só o do Beto (que está sendo assistido) toca.
  const screenAudio = await viewer.evaluate(() => [...document.querySelectorAll('audio')].length);
  assert.ok(screenAudio <= 1, `a prévia não assinou o som da tela (${screenAudio} faixas de som)`);

  // Tirar o mouse fecha; a assinatura é solta pouco depois e o vídeo da Ana para de chegar.
  await viewer.mouse.move(5, 5);
  await waitFor(async () => (await preview.count()) === 0, 'a prévia fechar');
  await viewer.waitForTimeout(3000);
  assert.equal(await activeVideos(viewer), 1, 'depois de fechar a prévia a tela da Ana para de chegar');

  // Clicar na prévia abre a transmissão completa.
  await row.locator('[data-preview="true"]').hover();
  await viewer.getByTestId('stream-preview-open').click();
  await waitFor(async () => (await viewer.getByTestId('stage-owner').textContent()).includes('Ana'), 'a Ana ir para o destaque');
});
