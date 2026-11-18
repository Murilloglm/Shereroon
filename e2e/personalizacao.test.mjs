// Personalização: Cosmic Points, Loja e Decorações e inventário. Comprar com confirmação, equipar com cor,
// a decoração em volta do avatar (animada na prévia, parada nas listas e com animações reduzidas) e o histórico.
// O saldo inicial vem da rota de pontos de desenvolvimento, que só existe com COSMIC_DEV_POINTS=1 fora de produção.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, startStack, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
let stack;
let browser;
let page;

const api = (method, path, body) =>
  page.evaluate(
    async ([method, path, body]) => {
      const response = await fetch(path, { method, headers: { authorization: `Bearer ${localStorage.getItem('shareroom:conta')}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return response.json();
    },
    [method, path, body],
  );
const balance = async () => Number(await page.getByTestId('points-balance').getAttribute('data-value'));

before(async () => {
  stack = await startStack({ COSMIC_DEV_POINTS: '1' });
  browser = await launchChrome({ headless });
  page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(BASE_URL);
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill('estelar');
  await page.getByTestId('auth-display-name').fill('Estelar');
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('account-settings-open').waitFor();
});

after(async () => {
  await browser?.close();
  await stack?.stop();
});

test('sem saldo, a loja mostra quanto falta e não deixa adquirir', async () => {
  await page.getByTestId('account-settings-open').click();
  await page.getByTestId('settings-nav-loja').click();
  const buy = page.getByTestId('shop-buy-anel-aurora');
  await buy.waitFor();
  assert.equal(await buy.isDisabled(), true);
  assert.match(await buy.textContent(), /Faltam 150/);
  assert.equal(await page.getByTestId('shop-item').count(), 14);
});

test('com saldo: adquirir pede confirmação, desconta o preço e vira "Já é seu"', async () => {
  await api('POST', '/api/dev/points', { amount: 1000 });
  await page.getByTestId('settings-nav-pontos').click();
  await waitFor(async () => (await balance()) === 1000, 'o saldo aparecer');
  await page.getByTestId('settings-nav-loja').click();
  await page.getByTestId('variant-anel-aurora-rosa').click();
  await page.getByTestId('shop-buy-anel-aurora').click();
  await page.getByTestId('dialog-confirm').click();
  const item = page.getByTestId('shop-item').and(page.locator('[data-item="anel-aurora"]'));
  await waitFor(async () => /Já é seu/.test(await item.textContent()), 'o item ficar como adquirido');
  await page.getByTestId('settings-nav-pontos').click();
  await waitFor(async () => (await balance()) === 850, 'o saldo cair exatamente o preço');
  assert.match(await page.getByTestId('points-history').textContent(), /Compra: Anel Aurora/);
});

test('equipar com outra cor: aparece na prévia (animada) e em volta do avatar do painel (parada)', async () => {
  await page.getByTestId('settings-nav-inventario').click();
  await page.getByTestId('equip-anel-aurora').click();
  const preview = page.getByTestId('inventory-preview').locator('[data-decoration="anel-aurora"]');
  await preview.waitFor();
  await page.getByTestId('variant-anel-aurora-rosa').first().click();
  await waitFor(async () => (await preview.getAttribute('data-variant')) === 'rosa', 'a cor trocar');
  assert.match(await preview.getAttribute('class'), /cn-deco-live/, 'animada na prévia');
  await page.getByTestId('settings-close').click();
  const panel = page.getByTestId('user-panel').locator('[data-decoration="anel-aurora"]');
  await panel.waitFor();
  assert.doesNotMatch((await panel.getAttribute('class')) ?? '', /cn-deco-live/, 'parada no painel (lista)');
});

test('com animações reduzidas, a decoração fica parada até na prévia', async () => {
  await page.getByTestId('account-settings-open').click();
  await page.getByTestId('settings-nav-acessibilidade').click();
  await page.getByTestId('motion-reduzir').click();
  await page.getByTestId('settings-nav-inventario').click();
  const preview = page.getByTestId('inventory-preview').locator('[data-decoration="anel-aurora"]');
  await preview.waitFor();
  assert.doesNotMatch((await preview.getAttribute('class')) ?? '', /cn-deco-live/);
  await page.getByTestId('settings-nav-acessibilidade').click();
  await page.getByTestId('motion-sistema').click();
  await page.getByTestId('settings-nav-inventario').click();
  await page.getByTestId('unequip-anel-aurora').click();
  await waitFor(async () => (await page.getByTestId('inventory-preview').locator('[data-decoration]').count()) === 0, 'tirar a decoração');
});
