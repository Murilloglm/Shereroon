// Pacotes cosméticos e o "enfeite no nome do servidor": prévia antes de comprar (pacote inteiro ou uma peça com o que
// já se usa), compra do pacote com desconto, "usar pacote completo", e o enfeite ao lado do nick na lista de membros e
// no chat (parado), no cartão de perfil (animado) e escondido pela opção de acessibilidade.
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
const card = () => page.getByTestId('shop-pack').and(page.locator('[data-pack="gato-trovao"]'));
const closeSettings = async () => {
  if ((await page.getByTestId('settings-screen').count()) > 0) await page.getByTestId('settings-close').click();
};

before(async () => {
  stack = await startStack({ COSMIC_DEV_POINTS: '1' });
  browser = await launchChrome({ headless });
  page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(BASE_URL);
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill('felina');
  await page.getByTestId('auth-display-name').fill('Felina');
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('account-settings-open').waitFor();
  await api('POST', '/api/dev/points', { amount: 5000 });
});

after(async () => {
  await browser?.close();
  await stack?.stop();
});

test('a loja mostra os 11 pacotes com prévia do pacote completo; o olho mostra só uma peça com o que já se usa', async () => {
  await page.getByTestId('account-settings-open').click();
  await page.getByTestId('settings-nav-loja').click();
  await card().waitFor();
  assert.equal(await page.getByTestId('shop-pack').count(), 11);
  assert.equal(await card().getByTestId('pack-piece').count(), 5);
  const preview = card().getByTestId('pack-preview');
  await preview.locator('[data-decoration="gato-trovao-deco"]').waitFor();
  for (const selector of ['[data-decoration="gato-trovao-deco"]', '[data-adornment="gato-trovao-enfeite"]', '[data-profile-frame="gato-trovao-moldura"]']) {
    assert.equal(await preview.locator(selector).count(), 1, `a prévia mostra ${selector}`);
  }
  // Uma peça só: sem nada equipado, a prévia fica só com o enfeite.
  await card().getByTestId('pack-focus-gato-trovao-enfeite').click();
  await waitFor(async () => (await preview.locator('[data-decoration]').count()) === 0, 'a prévia mostrar só a peça escolhida');
  assert.equal(await preview.locator('[data-adornment="gato-trovao-enfeite"]').count(), 1);
  assert.match(await card().getByTestId('pack-preview-mode').textContent(), /Enfeite no nome do servidor com o que você já usa/);
  // Itens avulsos continuam nos blocos de sempre; as peças de pacote ficam só nos cartões.
  assert.equal(await page.getByTestId('shop-item').count(), 14);
});

test('adquirir o pacote: um débito só, com desconto, e as 5 peças no inventário', async () => {
  const pack = (await api('GET', '/api/shop')).packs.find((entry) => entry.id === 'gato-trovao');
  assert.equal(pack.price, 1425, '25% de desconto sobre 1.900');
  await page.getByTestId('settings-nav-pontos').click();
  await waitFor(async () => (await balance()) === 5000, 'o saldo aparecer');
  await page.getByTestId('settings-nav-loja').click();
  await card().getByTestId('shop-buy-pack-gato-trovao').click();
  await page.getByTestId('dialog-confirm').click();
  await waitFor(async () => /Pacote completo/.test((await card().textContent()) ?? ''), 'o pacote ficar completo');
  await page.getByTestId('settings-nav-pontos').click();
  await waitFor(async () => (await balance()) === 5000 - 1425, 'o saldo cair exatamente o preço do pacote');
  assert.match(await page.getByTestId('points-history').textContent(), /Pacote: Kayden/);
});

test('"usar pacote completo" equipa tudo; a prévia do inventário mostra o enfeite ao lado do nome', async () => {
  await page.getByTestId('settings-nav-inventario').click();
  await page.getByTestId('equip-pack-gato-trovao').click();
  await page.getByTestId('inventory-name').locator('[data-adornment="gato-trovao-enfeite"]').waitFor();
  assert.match(await page.getByTestId('inventory-pack').textContent(), /5 de 5 peças.*Em uso/s);
  assert.equal(await page.getByTestId('inventory-preview').locator('[data-decoration="gato-trovao-deco"]').count(), 1);
});

test('o enfeite aparece ao lado do nick na lista de membros e no chat (parado) e no cartão de perfil (animado)', async () => {
  await closeSettings();
  const { group } = await api('POST', '/api/groups', { name: 'Gatil' });
  // O grupo foi criado pela API: recarrega para o aplicativo buscar a lista de grupos de novo.
  await page.goto(`${BASE_URL}/#/grupos/${group.id}`);
  await page.reload();
  const member = page.getByTestId('member').and(page.locator('[data-user="felina"]'));
  const listed = member.locator('[data-adornment="gato-trovao-enfeite"]');
  await listed.waitFor();
  assert.equal(await listed.getAttribute('data-live'), 'false', 'na lista fica parado');
  // Logo depois do nick, na mesma linha.
  const [nameBox, adornBox] = await Promise.all([member.getByTestId('member-name').boundingBox(), listed.boundingBox()]);
  assert.ok(adornBox.x >= nameBox.x + nameBox.width - 1 && Math.abs(adornBox.y + adornBox.height / 2 - (nameBox.y + nameBox.height / 2)) < 6, 'ao lado do nick, alinhado');

  const input = page.getByTestId('chat-input');
  await input.fill('miau');
  await page.keyboard.press('Enter');
  const author = page.getByTestId('chat-author').first();
  await author.locator('[data-adornment="gato-trovao-enfeite"]').waitFor();
  assert.equal(await author.locator('[data-adornment]').getAttribute('data-live'), 'false', 'no chat fica parado');
  assert.equal(await author.textContent(), 'Felina', 'o enfeite não entra no texto do nome');

  await member.locator('[data-user-trigger]').click();
  const profile = page.getByTestId('profile-card');
  await profile.locator('[data-adornment="gato-trovao-enfeite"][data-live="false"]').waitFor();
  assert.equal(await profile.locator('[data-profile-frame="gato-trovao-moldura"]').count(), 1, 'a moldura do pacote contorna o cartão');
  assert.match(await profile.getByTestId('profile-banner').getAttribute('style'), /madu-kaiden/);
  await page.keyboard.press('Escape');
});

test('acessibilidade: "ocultos" esconde os enfeites; "sempre parados" nunca anima', async () => {
  await page.getByTestId('account-settings-open').click();
  await page.getByTestId('settings-nav-acessibilidade').click();
  await page.getByTestId('adornments-ocultos').click();
  await closeSettings();
  const member = page.getByTestId('member').and(page.locator('[data-user="felina"]'));
  await waitFor(async () => (await member.locator('[data-adornment]').count()) === 0, 'o enfeite sumir da lista');
  assert.equal(await page.getByTestId('chat-author').first().locator('[data-adornment]').count(), 0, 'e do chat');

  await page.getByTestId('account-settings-open').click();
  await page.getByTestId('settings-nav-acessibilidade').click();
  await page.getByTestId('adornments-parados').click();
  await closeSettings();
  await member.locator('[data-user-trigger]').click();
  const shown = page.getByTestId('profile-card').locator('[data-adornment="gato-trovao-enfeite"]');
  await shown.waitFor();
  assert.equal(await shown.getAttribute('data-live'), 'false', 'nem no perfil anima');
  await page.keyboard.press('Escape');

  await page.getByTestId('account-settings-open').click();
  await page.getByTestId('settings-nav-acessibilidade').click();
  await page.getByTestId('adornments-animados').click();
  await closeSettings();
});
