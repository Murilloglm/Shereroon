// Aplicativo de Windows: imagens que vêm do backend (foto de perfil, banner, emojis do grupo) aparecem de
// verdade dentro do aplicativo. A política de segurança da página precisa liberar a origem do backend; sem isso
// o Electron bloqueia a imagem e mostra o ícone de imagem quebrada (o elemento existe, mas não carrega).
// Roda com uma pasta de dados temporária, então funciona com o Cosmic Night instalado aberto.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { _electron as electron } from 'playwright-core';
import { BASE_URL, root, startStack, useLocalDesktopConfig, waitFor } from './harness.mjs';
import { bmpFile, imageShows, pngFile } from './images.mjs';

const APP_EXE = process.env.SHAREROOM_APP_EXE || null;
const DEV_EXE = resolve(root, 'desktop/node_modules/electron/dist/electron.exe');
const skip =
  (process.platform !== 'win32' && 'o aplicativo é para Windows') ||
  (process.env.E2E_HEADLESS === '1' && 'precisa de janelas de verdade') ||
  (!APP_EXE && !existsSync(DEV_EXE) && 'faltam as dependências do aplicativo: rode "npm install" na pasta desktop');

let stack;
let app;
let page;
let userData;
let restoreConfig;
const blocked = [];

before(async () => {
  if (skip) return;
  stack = await startStack();
  if (!APP_EXE) restoreConfig = useLocalDesktopConfig();
  userData = mkdtempSync(join(tmpdir(), 'cosmic-imagens-'));
  const { ELECTRON_RUN_AS_NODE: _ignored, ...cleanEnv } = process.env;
  app = await electron.launch({
    executablePath: APP_EXE ?? DEV_EXE,
    args: APP_EXE ? [] : [resolve(root, 'desktop')],
    env: { ...cleanEnv, SHAREROOM_E2E: '1', SHAREROOM_USER_DATA: userData, SHAREROOM_API_URL: BASE_URL, SHAREROOM_SITE_URL: 'https://exemplo.github.io/shareroom/' },
  });
  page = await app.firstWindow();
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) blocked.push(message.text());
  });
});

after(async () => {
  await app?.close().catch(() => undefined);
  restoreConfig?.();
  await stack?.stop();
  if (userData) rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

test('foto de perfil enviada aparece dentro do aplicativo, inclusive de um formato que precisa ser convertido', { skip }, async () => {
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill('fotografa');
  await page.getByTestId('auth-display-name').fill('Fotógrafa');
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('rail-create').click();
  await page.getByTestId('group-name').fill('Galeria');
  await page.getByTestId('group-create').click();
  await page.getByTestId('chat').waitFor();

  await page.getByTestId('account-menu').click();
  const editor = page.getByTestId('profile-editor');
  await editor.waitFor();
  for (const file of [pngFile('desktop-avatar.png', 128, 128), bmpFile('desktop-avatar.bmp', 96, 80)]) {
    const photo = editor.getByTestId('profile-preview').locator('[data-avatar="foto"] img').first();
    const before = (await photo.count()) > 0 ? await photo.getAttribute('src') : null;
    await editor.getByTestId('profile-avatar-file').setInputFiles(file);
    await page.getByTestId('profile-upload-preview').waitFor();
    await page.getByTestId('profile-upload-confirm').click();
    await page.getByTestId('profile-upload-preview').waitFor({ state: 'detached' });
    await waitFor(async () => (await photo.count()) > 0 && (await photo.getAttribute('src')) !== before, 'a foto nova entrar no perfil');
    assert.match(await photo.getAttribute('src'), new RegExp(`^${BASE_URL}/api/media/`), 'a foto vem do backend, não de um blob local');
    await waitFor(() => imageShows(photo), `a foto (${file.split(/[\\/]/).pop()}) carregar de verdade`);
  }
  assert.deepEqual(blocked, [], 'a política de segurança não bloqueou nenhuma imagem');
  await page.getByTestId('settings-close').click();
});

test('detecção de jogos: o programa aberto é reconhecido e a lista de programas traz os ícones dos executáveis', { skip }, async () => {
  // O "jogo" é o próprio aplicativo (com certeza está aberto): vinculado pelo nome do executável.
  const exe = await app.evaluate(() => process.execPath.split(/[\\/]/).pop());
  await page.evaluate(
    async ([api, exe]) => {
      const response = await fetch(`${api}/api/me/games`, { method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('shareroom:conta')}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Jogo de teste', exe }) });
      if (!response.ok) throw new Error(await response.text());
    },
    [BASE_URL, exe],
  );
  await page.getByTestId('account-settings-open').click();
  await page.getByTestId('settings-nav-jogos').click();
  await page.getByRole('switch', { name: 'Detectar o jogo aberto neste computador' }).click();
  await waitFor(async () => /jogando Jogo de teste/.test((await page.getByTestId('games-detected').textContent()) ?? ''), 'o aplicativo reconhecer o programa aberto');

  await page.getByTestId('game-programs').click();
  const list = page.getByTestId('game-program-list');
  await waitFor(async () => (await list.locator('button').count()) > 0, 'a lista de programas abertos aparecer', 20_000);
  assert.ok((await list.locator('img').count()) > 0, 'com o ícone tirado do executável');
  await page.getByRole('switch', { name: 'Detectar o jogo aberto neste computador' }).click();
  await page.getByTestId('settings-close').click();
});

test('a política continua fechada para outras origens de imagem', { skip }, async () => {
  const result = await page.evaluate(
    () =>
      new Promise((resolveImage) => {
        const image = new Image();
        image.onload = () => resolveImage('carregou');
        image.onerror = () => resolveImage('bloqueada');
        image.src = 'https://example.com/qualquer.png';
      }),
  );
  assert.equal(result, 'bloqueada');
});
