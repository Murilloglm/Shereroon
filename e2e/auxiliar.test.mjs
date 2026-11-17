// Captura seletiva de áudio por aplicativo, de ponta a ponta e com som de verdade:
// dois programas tocando tons diferentes → app auxiliar (WASAPI) → site → SFU → navegador do convidado.
// "jogo-teste" faz o papel do VALORANT e "voz-teste" o do Discord, no cenário pedido:
// só o jogo → liga a voz no meio → desliga o jogo, tudo sem reiniciar a transmissão.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, sleep, sourcePageHtml, startHelper, startStack, startToneApp, toneLevels, videoFacts, waitFor } from './harness.mjs';

const windows = process.platform === 'win32';
const skip = !windows && 'a captura por aplicativo só existe no Windows';
const PORT = 47899;
const GAME_HZ = 440;
const VOICE_HZ = 1000;
const TAB_HZ = 880;
const ORIGIN = BASE_URL;

let stack;
let helper;
let game;
let voice;
let hostBrowser;
let guestBrowser;
let host;
let guest;

/** Abre uma conexão crua com o auxiliar, como o site faz, e coleta as mensagens. */
function connect(origin) {
  return new Promise((done) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/`, origin ? { headers: { Origin: origin } } : undefined);
    socket.binaryType = 'arraybuffer';
    const session = { socket, messages: [], blocks: 0, closed: null };
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') session.messages.push(JSON.parse(event.data));
      else session.blocks += 1;
    });
    socket.addEventListener('close', (event) => {
      session.closed = event.code;
      done(session);
    });
    socket.addEventListener('open', () => setTimeout(() => done(session), 600));
    socket.addEventListener('error', () => undefined);
  });
}

const last = (session, type) => session.messages.findLast((message) => message.t === type);
const row = (page, exe) => page.getByTestId(`mixer-row-${exe}`);
const present = (levels, hz) => levels[hz] > -70;
const absent = (levels, hz) => levels[hz] < -85;

async function expectTones(page, expected, what) {
  let result;
  await waitFor(
    async () => {
      result = await toneLevels(page, [GAME_HZ, VOICE_HZ, TAB_HZ]);
      return Object.entries(expected).every(([hz, on]) => (on ? present(result.levels, hz) : absent(result.levels, hz)));
    },
    what,
    20_000,
  ).catch((error) => {
    throw new Error(`${error.message}. Medido no convidado (dB): ${JSON.stringify(result)}`);
  });
  return result.levels;
}

before(async () => {
  if (skip) return;
  stack = await startStack();
  helper = await startHelper({ port: PORT });
  game = await startToneApp('jogo-teste', GAME_HZ);
  voice = await startToneApp('voz-teste', VOICE_HZ);
});

after(async () => {
  await hostBrowser?.close();
  await guestBrowser?.close();
  await game?.stop();
  await voice?.stop();
  await helper?.stop();
  await stack?.stop();
});

test('o auxiliar recusa quem não é um site autorizado', { skip }, async () => {
  const noOrigin = await connect(null);
  assert.equal(noOrigin.closed, 4400, 'sem origem de navegador');
  const stranger = await connect('https://site-desconhecido.example');
  assert.equal(stranger.closed, 4403, 'origem que o usuário não autorizou');
  assert.equal(last(stranger, 'welcome'), undefined);
  assert.ok(!stranger.messages.some((message) => message.t === 'apps'), 'nenhuma lista de aplicativos vaza para quem foi recusado');
});

test('site autorizado: recebe a lista de aplicativos e nada é capturado até pedir', { skip }, async () => {
  const session = await connect(ORIGIN);
  assert.equal(session.closed, null);
  const welcome = last(session, 'welcome');
  assert.equal(welcome.sampleRate, 48000);
  assert.ok(welcome.build >= 19041, `build do Windows: ${welcome.build}`);

  await waitFor(() => last(session, 'apps')?.apps.some((app) => app.exe === game.name), 'o jogo de teste aparecer na lista');
  const apps = last(session, 'apps').apps;
  const listed = apps.find((app) => app.exe === game.name);
  assert.equal(listed.pid, game.pid);
  assert.equal(listed.hasSession, true);
  assert.ok(apps.some((app) => app.exe === voice.name));

  await sleep(500);
  assert.equal(session.blocks, 0, 'sem pedido de transmissão, nenhum áudio é enviado');
  assert.deepEqual(last(session, 'sources')?.sources ?? [], [], 'nenhuma fonte capturando');

  // Um identificador que não está na lista é recusado: o site não escolhe processos arbitrários.
  session.socket.send(JSON.stringify({ t: 'source', id: 'p4', enabled: true }));
  await waitFor(() => last(session, 'error'), 'o auxiliar recusar um processo fora da lista');
  assert.equal(last(session, 'error').id, 'p4');
  session.socket.close();
});

test('uma segunda aba assume o mixer e a primeira é avisada; ao desconectar, as capturas param', { skip }, async () => {
  const first = await connect(ORIGIN);
  await waitFor(() => last(first, 'apps'), 'lista de aplicativos');
  first.socket.send(JSON.stringify({ t: 'source', id: `p${game.pid}`, enabled: true }));
  await waitFor(() => last(first, 'sources')?.sources.some((source) => source.state === 'capturing'), 'o jogo começar a ser capturado');

  const second = await connect(ORIGIN);
  await waitFor(() => first.closed !== null, 'a primeira conexão ser encerrada');
  assert.equal(first.closed, 4001);
  await waitFor(() => last(second, 'sources') !== undefined || last(second, 'apps') !== undefined, 'estado da segunda conexão');
  assert.deepEqual(last(second, 'sources')?.sources ?? [], [], 'a captura pedida pela aba anterior não continua na nova');
  second.socket.close();
});

test('o mixer do site conecta ao auxiliar e lista os aplicativos', { skip }, async () => {
  hostBrowser = await launchChrome({ captureTitle: 'sr-fonte-com-som', headless: false });
  guestBrowser = await launchChrome({ headless: false });

  const context = await hostBrowser.newContext({ viewport: { width: 1672, height: 941 } });
  await context.addInitScript((port) => localStorage.setItem('shareroom:auxiliar-porta', String(port)), PORT);
  await (await context.newPage()).setContent(sourcePageHtml('sr-fonte-com-som', TAB_HZ));
  host = await context.newPage();
  await host.goto(BASE_URL);
  await host.getByTestId('home-user-name').fill('Murillo');
  await host.getByTestId('home-create').click();
  await host.getByTestId('room').waitFor();
  const invite = await host.getByTestId('room-link').inputValue();

  guest = await (await guestBrowser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await guest.goto(invite);
  await guest.getByTestId('gate-name').fill('Lucas');
  await guest.getByTestId('gate-join').click();
  await guest.getByTestId('room').waitFor();

  await host.getByRole('button', { name: 'Opções de áudio' }).click();
  await host.getByTestId('open-mixer').click();
  await waitFor(async () => (await host.getByTestId('mixer-panel').getAttribute('data-phase')) === 'conectado', 'o mixer conectar ao auxiliar');
  await row(host, game.name).waitFor();
  await row(host, voice.name).waitFor();
  assert.equal(await row(host, game.name).getAttribute('data-enabled'), 'false', 'nada vem ligado por conta própria');
  assert.equal(await host.getByTestId('mixer-status').getAttribute('data-live'), 'false');
});

test('o navegador da própria sala aparece bloqueado (evita eco)', { skip }, async () => {
  const chrome = row(host, 'chrome.exe');
  await chrome.waitFor();
  const text = await chrome.textContent();
  if (/a desta sala fica de fora/.test(text)) {
    // Há outro Chrome aberto neste PC (o do convidado ou o seu): ele pode ser transmitido, o da sala não.
    assert.equal(await chrome.getByRole('switch').isDisabled(), false);
  } else {
    assert.match(text, /bloqueado para não dar eco/);
    assert.equal(await chrome.getByRole('switch').isDisabled(), true);
  }
});

test('cenário pedido, passo 1: só o jogo é ouvido', { skip }, async () => {
  await row(host, game.name).getByRole('switch').click();
  await host.getByTestId('dock-share').click();
  await guest.getByTestId('stage-owner').waitFor();
  await waitFor(async () => (await host.getByTestId('mixer-status').getAttribute('data-live')) === 'true', 'o selo "Captura seletiva ativa"');

  await expectTones(guest, { [GAME_HZ]: true, [VOICE_HZ]: false, [TAB_HZ]: false }, 'o convidado ouvir só o jogo');
  assert.match(await row(host, game.name).textContent(), /transmitindo/);
});

test('passo 2: liga a voz no meio da transmissão — jogo e voz juntos, sem reiniciar', { skip }, async () => {
  const videoBefore = await videoFacts(guest);
  const audioBefore = await guest.evaluate(() => document.querySelector('audio')?.srcObject?.getAudioTracks()[0]?.id);

  await row(host, voice.name).getByRole('switch').click();
  await expectTones(guest, { [GAME_HZ]: true, [VOICE_HZ]: true, [TAB_HZ]: false }, 'o convidado ouvir jogo + voz');

  const audioAfter = await guest.evaluate(() => document.querySelector('audio')?.srcObject?.getAudioTracks()[0]?.id);
  assert.equal(audioAfter, audioBefore, 'a faixa de áudio do convidado é a mesma (não houve republicação)');
  assert.ok((await videoFacts(guest)).frames > videoBefore.frames, 'o vídeo seguiu sem interrupção');
});

test('passo 3: desliga o jogo — sobra só a voz', { skip }, async () => {
  await row(host, game.name).getByRole('switch').click();
  await expectTones(guest, { [GAME_HZ]: false, [VOICE_HZ]: true, [TAB_HZ]: false }, 'o convidado ouvir só a voz');
});

test('volume de transmissão por aplicativo: 25% chega cerca de 12 dB mais baixo', { skip }, async () => {
  const full = (await expectTones(guest, { [VOICE_HZ]: true }, 'voz em 100%'))[VOICE_HZ];
  await row(host, voice.name).getByRole('slider').fill('25');
  let quiet;
  await waitFor(async () => {
    quiet = (await toneLevels(guest, [VOICE_HZ])).levels[VOICE_HZ];
    return full - quiet > 9 && full - quiet < 15;
  }, 'a voz cair ~12 dB').catch((error) => {
    throw new Error(`${error.message}. 100%: ${full} dB, 25%: ${quiet} dB`);
  });
  await row(host, voice.name).getByRole('slider').fill('100');
});

test('perfis de áudio: salvar, desligar tudo e reaplicar', { skip }, async () => {
  await row(host, game.name).getByRole('switch').click();
  await expectTones(guest, { [GAME_HZ]: true, [VOICE_HZ]: true }, 'jogo + voz antes de salvar');

  host.once('dialog', (dialog) => dialog.accept('Jogar com call'));
  await host.getByTestId('mixer-save-profile').click();
  await waitFor(async () => (await host.getByTestId('mixer-profile').inputValue()) === 'Jogar com call', 'o perfil aparecer selecionado');

  await host.getByRole('button', { name: 'Mais opções do mixer' }).click();
  await host.getByRole('menuitem', { name: 'Desligar todas as fontes' }).click();
  await expectTones(guest, { [GAME_HZ]: false, [VOICE_HZ]: false }, 'silêncio com tudo desligado');

  await host.getByTestId('mixer-profile').selectOption('Jogar com call');
  await expectTones(guest, { [GAME_HZ]: true, [VOICE_HZ]: true }, 'o perfil religar jogo + voz');

  // O perfil fica guardado no navegador para a próxima vez.
  const saved = await host.evaluate(() => JSON.parse(localStorage.getItem('shareroom:perfis-audio')));
  assert.equal(saved[0].name, 'Jogar com call');
  assert.equal(saved[0].entries['jogo-teste.exe'].enabled, true);
});

test('o atraso do áudio é medido, fica baixo e quem assiste segura a imagem o mesmo tanto', { skip }, async () => {
  await sleep(2500);
  const text = await host.getByTestId('mixer-latency').textContent();
  const ms = (label) => Number(text.match(new RegExp(`(\\d+) ms ${label}`))?.[1] ?? NaN);
  const captureMs = ms('na captura do Windows');
  const helperMs = ms('no auxiliar');
  const queueMs = ms('na fila do navegador');
  console.log(`  ${text}`);
  assert.ok(captureMs > 0 && captureMs <= 80, `captura do Windows: ${captureMs} ms (${text})`);
  assert.ok(helperMs > 0 && helperMs <= 55, `auxiliar: ${helperMs} ms (${text})`);
  assert.ok(queueMs > 0 && queueMs <= 60, `fila do navegador: ${queueMs} ms (${text})`);
  assert.ok(!/falha/.test(text), `sem falhas na fila: ${text}`);

  // Quem assiste recebe o atraso medido e segura a imagem para o som não chegar atrasado.
  const total = captureMs + helperMs + queueMs;
  let held = NaN;
  let reported = NaN;
  await waitFor(async () => {
    const card = (await guest.getByTestId('stats-card').textContent().catch(() => '')) ?? '';
    reported = Number(card.match(/Atraso do som na origem\s*(\d+)\s*ms/)?.[1] ?? NaN);
    held = Number(card.match(/Imagem segurada para sincronizar\s*(\d+)\s*ms/)?.[1] ?? NaN);
    return held > 0 && Math.abs(held - reported) <= 20;
  }, 'o convidado segurar a imagem o tanto que o som atrasa', 20_000);
  console.log(`  atraso informado ${reported} ms, imagem segurada ${held} ms (medido na origem: ${total} ms)`);
  assert.ok(Math.abs(reported - total) <= 25, `o convidado recebe o atraso medido (${reported} ms x ${total} ms)`);
});

test('o aplicativo fecha e abre de novo: volta a ser transmitido sozinho', { skip }, async () => {
  await game.stop();
  await expectTones(guest, { [GAME_HZ]: false, [VOICE_HZ]: true }, 'o jogo sumir quando o programa fecha');
  game = await startToneApp('jogo-teste', GAME_HZ);
  await expectTones(guest, { [GAME_HZ]: true, [VOICE_HZ]: true }, 'o jogo voltar sozinho depois de reabrir');
});

test('escolher outro áudio na barra desliga as capturas do mixer', { skip }, async () => {
  await host.getByRole('button', { name: 'Opções de áudio' }).click();
  await host.getByRole('menuitem', { name: 'Não transmitir áudio' }).click();
  await waitFor(async () => (await row(host, voice.name).getAttribute('data-enabled')) === 'false', 'as fontes aparecerem desligadas');
  await waitFor(async () => (await guest.locator('audio').count()) === 0, 'a faixa de áudio sumir para o convidado');
  assert.match(helper.logs(), /conectado: http:\/\/localhost:8790/);
});

test('ao sair da sala o site solta o auxiliar', { skip }, async () => {
  await host.getByLabel('Sua conta nesta sala').click();
  await host.getByTestId('leave').click();
  await waitFor(() => /desconectado\s*$/.test(helper.logs().trimEnd()), 'o auxiliar registrar a desconexão', 10_000);
});
