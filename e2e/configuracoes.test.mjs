// Configurações em tela própria: ocupa a janela, categorias numa barra lateral, pesquisa, cada categoria com
// suas opções de verdade (privacidade salva no servidor, acessibilidade aplicada e lembrada) e Esc para voltar.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, startStack, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
let stack;
let browser;
let page;

const screen = () => page.getByTestId('settings-screen');
const navIds = async () => (await page.locator('[data-testid^="settings-nav-"]').evaluateAll((items) => items.map((item) => item.dataset.testid.replace('settings-nav-', ''))));

before(async () => {
  stack = await startStack();
  browser = await launchChrome({ headless });
  page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(BASE_URL);
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill('config');
  await page.getByTestId('auth-display-name').fill('Config');
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('account-settings-open').waitFor();
});

after(async () => {
  await browser?.close();
  await stack?.stop();
});

test('abre em tela própria, com as categorias na barra lateral e a conta em destaque', async () => {
  await page.getByTestId('account-settings-open').click();
  await screen().waitFor();
  assert.equal(await screen().getAttribute('data-section'), 'conta');
  assert.match(await page.getByTestId('account-settings').textContent(), /@config/);
  // No site não há opções do aplicativo de Windows.
  assert.deepEqual(await navIds(), ['conta', 'perfil', 'privacidade', 'amigos', 'aparencia', 'notificacoes', 'acessibilidade', 'voz', 'jogos', 'inventario', 'loja', 'pontos']);
  // Ocupa a janela inteira, não uma janelinha sobre o chat.
  const box = await screen().boundingBox();
  assert.ok(box.width >= 1390 && box.height >= 890, `tamanho: ${JSON.stringify(box)}`);
});

test('pesquisa encontra pela palavra, mesmo sem acento', async () => {
  await page.getByTestId('settings-search').fill('animacoes');
  assert.deepEqual(await navIds(), ['acessibilidade']);
  await page.getByTestId('settings-search').fill('senha');
  assert.deepEqual(await navIds(), ['conta']);
  await page.getByTestId('settings-search').fill('xyz123');
  assert.deepEqual(await navIds(), []);
  assert.match(await screen().textContent(), /Nada encontrado/);
  await page.getByTestId('settings-search').fill('');
});

test('privacidade: a escolha é salva no servidor', async () => {
  await page.getByTestId('settings-nav-privacidade').click();
  await page.getByTestId('dm-privacy').selectOption('amigos');
  await waitFor(async () => {
    const profile = await page.evaluate(async () => {
      const token = localStorage.getItem('shareroom:conta');
      const me = await (await fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })).json();
      return (await (await fetch(`/api/users/${me.user.id}`, { headers: { authorization: `Bearer ${token}` } })).json()).profile;
    });
    return profile.dmPrivacy === 'amigos';
  }, 'a privacidade ser salva');
});

test('acessibilidade: reduzir animações vale na hora e continua depois de recarregar', async () => {
  await page.getByTestId('settings-nav-acessibilidade').click();
  await page.getByTestId('motion-reduzir').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'reduzida');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="settings-close"]')).transitionDuration), '1e-05s');
  await page.reload();
  await page.getByTestId('account-settings-open').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'reduzida');
  await page.getByTestId('account-settings-open').click();
  await page.getByTestId('settings-nav-acessibilidade').click();
  await page.getByTestId('motion-sistema').click();
});

test('temas: Claro e Escuro mudam na hora em telas e diálogos, ficam guardados, e o Cosmic Night volta', async () => {
  const colors = () =>
    page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      body: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
      panel: getComputedStyle(document.querySelector('[data-testid="settings-screen"]')).backgroundColor,
    }));
  await page.getByTestId('settings-nav-aparencia').click();
  assert.equal(await page.getByTestId('theme-cosmic').getAttribute('aria-checked'), 'true');
  const cosmic = await colors();
  assert.deepEqual(cosmic, { theme: 'cosmic', body: 'rgb(6, 7, 18)', text: 'rgb(239, 240, 251)', panel: 'rgb(3, 4, 11)' });

  await page.getByTestId('theme-claro').click();
  assert.deepEqual(await colors(), { theme: 'claro', body: 'rgb(243, 244, 249)', text: 'rgb(23, 26, 43)', panel: 'rgb(231, 233, 241)' });
  // Os diálogos também mudam (sem cores fixas).
  await page.getByTestId('account-logout').click();
  const dialog = page.locator('.cn-dialog');
  await dialog.waitFor();
  assert.equal(await dialog.evaluate((element) => getComputedStyle(element).color), 'rgb(23, 26, 43)');
  await page.getByTestId('dialog-cancel').click();
  await waitFor(async () => (await page.getByTestId('dialog').count()) === 0, 'o diálogo fechar');

  // Continua depois de recarregar, já na primeira pintura.
  await page.reload();
  await page.getByTestId('account-settings-open').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'claro');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(243, 244, 249)');

  await page.getByTestId('account-settings-open').click();
  await page.getByTestId('settings-nav-aparencia').click();
  await page.getByTestId('theme-escuro').click();
  assert.equal((await colors()).body, 'rgb(14, 15, 18)');
  await page.getByTestId('theme-cosmic').click();
  assert.deepEqual(await colors(), cosmic);
});

test('voz e vídeo fora de uma chamada explica onde ajustar; Esc volta para o aplicativo', async () => {
  await page.getByTestId('settings-nav-voz').click();
  assert.match(await page.getByTestId('settings-panel-voz').textContent(), /durante uma chamada/);
  await page.keyboard.press('Escape');
  await waitFor(async () => (await screen().count()) === 0, 'a tela fechar');
  await page.getByTestId('account-menu').click();
  assert.equal(await screen().getAttribute('data-section'), 'perfil');
  await page.getByTestId('profile-editor').waitFor();
  await page.getByTestId('settings-close').click();
  assert.equal(await screen().count(), 0);
});
