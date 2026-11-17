// Aplicativo de Windows, de ponta a ponta: o Electron de verdade abre a interface de dentro do aplicativo,
// captura uma janela escolhida no seletor próprio, transmite o som do computador pelo componente de áudio
// embutido (sem instalar nem autorizar nada) e responde aos comandos da bandeja.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { _electron as electron } from 'playwright-core';
import { BASE_URL, launchChrome, root, sleep, sourcePageHtml, startStack, startToneApp, toneLevels, useLocalDesktopConfig, videoFacts, waitFor } from './harness.mjs';

const windows = process.platform === 'win32';
const APP_EXE = process.env.SHAREROOM_APP_EXE || null;
const DEV_EXE = resolve(root, 'desktop/node_modules/electron/dist/electron.exe');
const skip =
  (!windows && 'o aplicativo é para Windows') ||
  (process.env.E2E_HEADLESS === '1' && 'precisa de janelas de verdade') ||
  (!APP_EXE && !existsSync(DEV_EXE) && 'faltam as dependências do aplicativo: rode "npm install" e "npm start" uma vez na pasta desktop');
const SITE = 'https://exemplo.github.io/shareroom';
const TONE_HZ = 1500;
const WINDOW_TITLE = 'sr-janela-desktop';

let stack;
let app;
let page;
let sourceBrowser;
let guestBrowser;
let guest;
let tone;
let userData;
let restoreConfig;

const main = (fn, arg) => app.evaluate(fn, arg);
const hook = (name, arg) => main(({}, [name, arg]) => globalThis.__shareroom[name](arg), [name, arg]);
const trayItem = async (label) => (await hook('tray')).find((item) => item.label === label);

before(async () => {
  if (skip) return;
  stack = await startStack();
  if (!APP_EXE) restoreConfig = useLocalDesktopConfig();
  userData = mkdtempSync(join(tmpdir(), 'shareroom-app-'));
  tone = await startToneApp('tom-desktop', TONE_HZ);
  // Uma janela comum de outro programa, com imagem em movimento, para ser a fonte da captura.
  sourceBrowser = await launchChrome({ headless: false, args: ['--window-size=900,600', '--window-position=40,40'] });
  await (await sourceBrowser.newPage()).setContent(sourcePageHtml(WINDOW_TITLE, 0));
  guestBrowser = await launchChrome({ headless: false });

  // Terminais abertos por extensões do VS Code definem ELECTRON_RUN_AS_NODE, que faz o Electron rodar como Node puro.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...cleanEnv } = process.env;
  app = await electron.launch({
    // Com SHAREROOM_APP_EXE o mesmo teste roda contra o aplicativo já empacotado.
    executablePath: APP_EXE ?? DEV_EXE,
    args: APP_EXE ? [] : [resolve(root, 'desktop')],
    env: {
      ...cleanEnv,
      SHAREROOM_E2E: '1',
      SHAREROOM_USER_DATA: userData,
      SHAREROOM_API_URL: BASE_URL,
      SHAREROOM_SITE_URL: `${SITE}/`,
    },
  });
  page = await app.firstWindow();
});

after(async () => {
  await app?.close().catch(() => undefined);
  restoreConfig?.();
  await guestBrowser?.close();
  await sourceBrowser?.close();
  await tone?.stop();
  await stack?.stop();
  if (userData) rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

test('a interface roda de dentro do aplicativo, isolada do sistema', { skip }, async () => {
  await page.getByTestId('home-user-name').waitFor();
  assert.match(page.url(), /^app:\/\/shareroom\//);
  const facts = await page.evaluate(() => ({
    node: typeof globalThis.require !== 'undefined' || typeof globalThis.process !== 'undefined',
    bridge: Object.keys(window.shareroomDesktop).sort(),
    config: window.shareroomDesktop.config,
    secure: window.isSecureContext,
  }));
  assert.equal(facts.node, false, 'a página não tem acesso ao Node');
  assert.deepEqual(facts.bridge, ['autostart', 'chooseSource', 'config', 'links', 'listSources', 'onCommand', 'setState', 'update', 'window']);
  assert.equal(facts.config.apiUrl, BASE_URL);
  assert.equal(facts.config.siteUrl, SITE);
  assert.ok(facts.config.helperPort > 1023, `componente de áudio numa porta local: ${facts.config.helperPort}`);
  assert.equal(facts.secure, true);
  assert.equal(await hook('helperRunning'), true, 'o componente de áudio subiu junto com o aplicativo');
});

test('janela sem a moldura do Windows: o cabeçalho próprio arrasta; os botões minimizam, maximizam na área útil e restauram', { skip }, async () => {
  const bar = page.getByTestId('titlebar');
  await bar.waitFor();
  const region = (testId) => page.getByTestId(testId).evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region'));
  assert.equal(await region('titlebar'), 'drag', 'a faixa arrasta a janela');
  for (const button of ['window-minimize', 'window-maximize', 'window-close']) assert.equal(await region(button), 'no-drag', `${button} é clicável`);
  const frame = await main(() => {
    const win = globalThis.__shareroom.window();
    const [outer, inner] = [win.getBounds(), win.getContentBounds()];
    return { frameless: outer.width === inner.width && outer.height === inner.height, resizable: win.isResizable(), movable: win.isMovable(), title: win.getTitle() };
  });
  assert.deepEqual(frame, { frameless: true, resizable: true, movable: true, title: 'Cosmic Night' });
  // O conteúdo começa logo abaixo do cabeçalho, sem ficar escondido atrás dele.
  assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('root')).paddingTop)), 32);

  await page.getByTestId('window-maximize').click();
  await waitFor(() => main(() => globalThis.__shareroom.window().isMaximized()), 'maximizar');
  await waitFor(async () => (await page.getByTestId('window-maximize').getAttribute('aria-label')) === 'Restaurar', 'o botão virar "Restaurar"');
  const fit = await main(({ screen }) => {
    const win = globalThis.__shareroom.window();
    return { bounds: win.getBounds(), area: screen.getDisplayMatching(win.getBounds()).workArea };
  });
  // Maximizada, ocupa a área útil da tela em que está, sem cobrir a barra de tarefas (o Windows pode deixar
  // alguns pixels da moldura invisível para fora da área).
  assert.ok(fit.bounds.y + fit.bounds.height <= fit.area.y + fit.area.height + 8, `não cobre a barra de tarefas: ${JSON.stringify(fit)}`);
  assert.ok(fit.bounds.width >= fit.area.width - 2 && fit.bounds.height >= fit.area.height - 2, `ocupa a área útil: ${JSON.stringify(fit)}`);

  await page.getByTestId('window-maximize').click();
  await waitFor(() => main(() => !globalThis.__shareroom.window().isMaximized()), 'restaurar');

  await page.getByTestId('window-minimize').click();
  await waitFor(() => main(() => globalThis.__shareroom.window().isMinimized()), 'minimizar');
  await main(() => globalThis.__shareroom.window().restore());
  await waitFor(() => main(() => !globalThis.__shareroom.window().isMinimized()), 'voltar da barra de tarefas');

  // Redimensionar continua livre (respeitando o tamanho mínimo).
  const size = await main(() => {
    const win = globalThis.__shareroom.window();
    win.setSize(1100, 760);
    return win.getSize();
  });
  assert.deepEqual(size, [1100, 760]);
  await main(() => globalThis.__shareroom.window().setSize(1520, 940));
});

test('criar sala: o convite aponta para o site público, que abre em qualquer navegador', { skip }, async () => {
  await page.getByTestId('home-user-name').fill('Murillo');
  await page.getByTestId('home-create').click();
  await page.getByTestId('room').waitFor();
  const invite = await page.getByTestId('room-link').inputValue();
  assert.ok(invite.startsWith(`${SITE}/#/sala/`), invite);

  guest = await (await guestBrowser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await guest.goto(`${BASE_URL}/#/sala/${invite.split('/#/sala/')[1]}`);
  await guest.getByTestId('gate-name').fill('Lucas');
  await guest.getByTestId('gate-join').click();
  await guest.getByTestId('room').waitFor();
  assert.equal((await trayItem('Sair da sala')).enabled, true, 'a bandeja sabe que há uma sala aberta');
});

test('sem escolha no seletor, nenhuma captura é liberada', { skip }, async () => {
  const outcome = await page.evaluate(() => navigator.mediaDevices.getDisplayMedia({ video: true }).then(
    (stream) => (stream.getTracks().forEach((track) => track.stop()), 'capturou'),
    (error) => error.name,
  ));
  assert.notEqual(outcome, 'capturou');
  // Um identificador que não veio da lista do seletor também é recusado.
  assert.equal(await page.evaluate(() => window.shareroomDesktop.chooseSource('screen:0:0')), false);
});

test('seletor próprio: lista janelas e telas reais com miniatura; cancelar não captura nada', { skip }, async () => {
  await page.getByTestId('dock-share').click();
  const picker = page.getByTestId('source-picker');
  await picker.waitFor();
  const wanted = picker.getByTestId('picker-source').filter({ hasText: WINDOW_TITLE });
  await wanted.waitFor({ timeout: 15_000 });
  assert.ok((await wanted.locator('img').first().getAttribute('src')).startsWith('data:image/png'), 'miniatura de verdade');
  assert.equal(await picker.getByTestId('picker-source').filter({ hasText: /^Cosmic Night$/ }).count(), 0, 'a própria janela do aplicativo fica de fora');
  assert.equal(await page.getByTestId('picker-confirm').isDisabled(), true, 'nada vem escolhido');

  await page.getByTestId('picker-tab-screen').click();
  assert.ok((await picker.getByTestId('picker-source').count()) >= 1, 'pelo menos um monitor');

  await page.getByTestId('picker-cancel').click();
  await sleep(600);
  assert.equal(await page.getByTestId('dock-stop').count(), 0, 'cancelar não inicia transmissão ("Parar" só aparece transmitindo)');
  assert.equal(await guest.getByTestId('stage-owner').count(), 0);
});

test('compartilhar a janela escolhida com o som do computador: vídeo e áudio chegam ao convidado', { skip }, async () => {
  await page.getByTestId('dock-share').click();
  const picker = page.getByTestId('source-picker');
  await picker.getByTestId('picker-source').filter({ hasText: WINDOW_TITLE }).click();
  const sound = picker.getByRole('switch', { name: 'Transmitir o som do computador' });
  assert.equal(await sound.getAttribute('aria-checked'), 'false', 'o som vem desmarcado na primeira vez');
  await sound.click();
  await page.getByTestId('picker-confirm').click();

  await guest.getByTestId('stage-owner').waitFor({ timeout: 20_000 });
  await waitFor(async () => (await videoFacts(guest)).frames > 30, 'os quadros chegarem ao convidado');
  const first = await videoFacts(guest);
  await sleep(3000);
  const second = await videoFacts(guest);
  const fps = Math.round((second.frames - first.frames) / 3);
  assert.ok(fps >= 20, `vídeo fluindo: ${fps} quadros por segundo`);
  assert.ok(second.width >= 600, `imagem da janela, não uma miniatura: ${second.width}x${second.height}`);
  console.log(`      janela capturada pelo aplicativo: ${second.width}x${second.height}, ~${fps} quadros/s recebidos pelo convidado`);

  let level;
  await waitFor(async () => {
    level = (await toneLevels(guest, [TONE_HZ])).levels[TONE_HZ];
    return level > -70;
  }, 'o som de outro programa do PC chegar ao convidado', 25_000).catch((error) => {
    throw new Error(`${error.message}. Nível medido: ${level} dB`);
  });
});

test('bandeja: mostra o estado da sala e para a transmissão; a tela não dorme enquanto transmite', { skip }, async () => {
  assert.equal((await trayItem('Parar de transmitir a tela')).enabled, true);
  assert.equal(await hook('sleepBlocked'), true);
  assert.ok(await trayItem('Ligar o microfone'), 'microfone desligado aparece como "Ligar"');

  await hook('clickTray', 'Parar de transmitir a tela');
  await waitFor(async () => (await page.getByTestId('dock-stop').count()) === 0, 'a transmissão parar pelo comando da bandeja');
  await waitFor(async () => (await guest.getByTestId('stage-owner').count()) === 0, 'o convidado deixar de ver a tela');
  assert.equal((await trayItem('Parar de transmitir a tela')).enabled, false);
  assert.equal(await hook('sleepBlocked'), false);
});

test('fechar a janela dentro de uma sala só esconde: o aplicativo segue na bandeja', { skip }, async () => {
  const state = await main(async () => {
    const win = globalThis.__shareroom.window();
    win.close();
    await new Promise((done) => setTimeout(done, 400));
    return { alive: !win.isDestroyed(), visible: win.isVisible() };
  });
  assert.deepEqual(state, { alive: true, visible: false });
  assert.equal(await guest.getByTestId('participant').count(), 2, 'você continua na sala');

  await hook('clickTray', 'Abrir o Cosmic Night');
  await waitFor(() => main(() => globalThis.__shareroom.window().isVisible()), 'a janela voltar pela bandeja');
});

test('configurações mostram a versão e o estado real da atualização', { skip }, async () => {
  await page.getByTestId('dock-settings').click();
  const update = page.getByTestId('app-update');
  await update.waitFor();
  await waitFor(async () => (await update.getAttribute('data-state')) === 'indisponivel', 'o estado da atualização aparecer');
  const version = JSON.parse(readFileSync(resolve(root, 'desktop/package.json'), 'utf8')).version;
  assert.equal(await page.getByTestId('update-current').textContent(), version);
  assert.match(await page.getByTestId('update-reason').textContent(), APP_EXE ? /sem canal de atualização|não tem a chave/ : /só existe no aplicativo instalado/);
  await page.getByRole('dialog', { name: 'Configurações' }).getByRole('button', { name: 'Fechar' }).click();
});

test('sair da sala pela bandeja', { skip }, async () => {
  await hook('clickTray', 'Sair da sala');
  await page.getByTestId('gate-return').waitFor();
  assert.match(await page.locator('body').textContent(), /Você saiu da sala/);
  await waitFor(async () => (await trayItem('Sair da sala')).enabled === false, 'a bandeja saber que a sala fechou');
});

test('a janela não navega para fora; links externos vão para o navegador padrão', { skip }, async () => {
  await page.evaluate(() => {
    window.open('https://example.com/pagina');
    window.open('file:///C:/Windows/win.ini');
  });
  await sleep(300);
  const result = await main(({ BrowserWindow }) => ({ opened: globalThis.__shareroom.opened, windows: BrowserWindow.getAllWindows().length }));
  assert.deepEqual(result, { opened: ['https://example.com/pagina'], windows: 1 });

  // A própria janela tentando ir para outro endereço: fica onde está, com a interface funcionando.
  await page.evaluate(() => {
    setTimeout(() => {
      window.location.href = 'https://example.com/';
    }, 0);
  });
  await sleep(1200);
  const after = await main(async () => {
    const contents = globalThis.__shareroom.window().webContents;
    return {
      url: contents.getURL(),
      working: await contents.executeJavaScript('Boolean(document.querySelector("[data-testid=gate-return]"))'),
    };
  });
  assert.match(after.url, /^app:\/\/shareroom\//);
  assert.equal(after.working, true);
});

test('iniciar com o Windows: vem desligado, liga pelas configurações e a escolha fica guardada', { skip }, async () => {
  const state = await page.evaluate(() => window.shareroomDesktop.autostart.get());
  assert.deepEqual({ enabled: state.enabled, minimized: state.minimized }, { enabled: false, minimized: false }, 'nunca liga sozinho');
  const after = await page.evaluate(() => window.shareroomDesktop.autostart.set({ enabled: true, minimized: true }));
  assert.equal(after.enabled, true);
  assert.equal(after.minimized, true);
  const saved = JSON.parse(readFileSync(resolve(userData, 'inicializacao.json'), 'utf8'));
  assert.deepEqual(saved, { enabled: true, minimized: true });
  await page.evaluate(() => window.shareroomDesktop.autostart.set({ enabled: false, minimized: false }));
});

test('link cosmicnight://convite abre a tela do convite no aplicativo; o que não é convite é ignorado', { skip }, async () => {
  const before = await page.evaluate(() => window.location.hash);
  await hook('openLink', ['CosmicNight.exe', 'cosmicnight://convite/javascript:alert(1)']);
  await hook('openLink', ['CosmicNight.exe', 'cosmicnight://outra-coisa/AbCdEf123']);
  await sleep(500);
  assert.equal(await page.evaluate(() => window.location.hash), before, 'links que não são convite não mudam nada');

  // Como chega da segunda instância (o Windows abrindo o link com o aplicativo já aberto).
  await hook('openLink', ['CosmicNight.exe', '--algum-parametro', 'cosmicnight://convite/AbCdEf123']);
  await waitFor(async () => (await page.evaluate(() => window.location.hash)) === '#/convite/AbCdEf123', 'a tela do convite abrir');
  const result = await main(({ BrowserWindow }) => ({ windows: BrowserWindow.getAllWindows().length, url: globalThis.__shareroom.window().webContents.getURL() }));
  assert.equal(result.windows, 1, 'nenhuma janela nova');
  assert.match(result.url, /^app:\/\/shareroom\//, 'continua dentro do aplicativo');
});

test('fora de uma sala, fechar a janela encerra o aplicativo e o componente de áudio', { skip }, async () => {
  const helperPid = await hook('helperPid');
  assert.ok(helperPid > 0);
  let closed = false;
  app.once('close', () => {
    closed = true;
  });
  await main(() => globalThis.__shareroom.window().close()).catch(() => undefined);
  await waitFor(() => closed, 'o aplicativo encerrar', 10_000);
  app = null;
  // O componente de áudio encerra junto (ele observa a entrada padrão que o aplicativo mantinha aberta).
  await waitFor(() => {
    try {
      process.kill(helperPid, 0);
      return false;
    } catch {
      return true;
    }
  }, 'o componente de áudio encerrar junto com o aplicativo', 8000);
});
