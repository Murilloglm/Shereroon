// Presentear um pacote pela loja: escolher o amigo mostra só as peças que ele ainda não tem e o preço com desconto;
// depois de confirmar, quem envia paga uma vez e o amigo recebe as peças e vê o presente, com a mensagem.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, startStack, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
let stack;
let browser;
let ana;
let beto;

const api = (page, method, path, body) =>
  page.evaluate(
    async ([method, path, body]) => {
      const response = await fetch(path, { method, headers: { authorization: `Bearer ${localStorage.getItem('shareroom:conta')}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return response.json();
    },
    [method, path, body],
  );

async function signup(username, displayName) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(BASE_URL);
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-display-name').fill(displayName);
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('account-settings-open').waitFor();
  return page;
}

before(async () => {
  stack = await startStack({ COSMIC_DEV_POINTS: '1' });
  browser = await launchChrome({ headless });
  ana = await signup('ana', 'Ana');
  beto = await signup('beto', 'Beto');
  const betoId = (await api(beto, 'GET', '/api/auth/me')).user.id;
  const anaId = (await api(ana, 'GET', '/api/auth/me')).user.id;
  await api(ana, 'POST', '/api/friends', { userId: betoId });
  await api(beto, 'POST', `/api/friends/${anaId}/accept`);
  await api(ana, 'POST', '/api/dev/points', { amount: 5000 });
  // O Beto já tem o enfeite do pacote: ele fica de fora do presente.
  await api(beto, 'POST', '/api/dev/points', { amount: 350 });
  await api(beto, 'POST', '/api/shop/buy', { itemId: 'gato-trovao-enfeite' });
});

after(async () => {
  await browser?.close();
  await stack?.stop();
});

test('presentear o pacote: a cotação deixa de fora o que o amigo já tem, e ele recebe as outras 4 peças', async () => {
  await ana.getByTestId('account-settings-open').click();
  await ana.getByTestId('settings-nav-loja').click();
  await ana.getByTestId('shop-gift-pack-gato-trovao').click();
  const dialog = ana.getByTestId('pack-gift-dialog');
  await dialog.waitFor();
  await dialog.getByTestId('pack-gift-recipient').selectOption({ label: 'Beto (@beto)' });
  const quote = dialog.getByTestId('pack-gift-quote');
  await quote.waitFor();
  // 4 peças épicas que faltam (600 + 300 + 350 + 300 = 1.550) com 25% de desconto: 1.165 (arredondado de 5 em 5).
  assert.equal(await quote.getAttribute('data-price'), '1165');
  assert.match(await quote.textContent(), /Gato Elétrico.*Faísca de Gato.*Cochilo Elétrico.*Nome Faísca/s);
  assert.match(await quote.textContent(), /Ele já tem: Gato Rabugento/);
  await dialog.getByLabel('Mensagem do presente').fill('Pra combinar com o seu enfeite!');
  await dialog.getByTestId('pack-gift-review').click();
  await ana.getByTestId('dialog-confirm').click();
  await waitFor(async () => (await ana.getByTestId('pack-gift-dialog').count()) === 0, 'a janela fechar depois de enviar');
  const points = await api(ana, 'GET', '/api/me/points');
  assert.equal(points.points, 5000 - 1165, 'quem envia paga uma vez o preço do pacote');
  assert.equal(points.history[0].detail, 'Presente: pacote Gato Trovão');

  const inventory = await api(beto, 'GET', '/api/me/inventory');
  assert.deepEqual(inventory.items.map((item) => item.id).sort(), ['gato-trovao-deco', 'gato-trovao-enfeite', 'gato-trovao-fundo', 'gato-trovao-moldura', 'gato-trovao-nome']);
  await beto.getByTestId('account-settings-open').click();
  await beto.getByTestId('settings-nav-presentes').click();
  const title = beto.getByTestId('gift-title').first();
  await waitFor(async () => (await title.textContent()) === 'Pacote Gato Trovão', 'o Beto ver o presente do pacote');
  const card = beto.locator('article', { has: title });
  assert.match(await card.textContent(), /Gato Elétrico · Faísca de Gato · Cochilo Elétrico · Nome Faísca/);
  assert.match(await card.textContent(), /Pra combinar com o seu enfeite!/);
  // Com o pacote agora completo, presentear de novo avisa que ele já tem tudo.
  await ana.getByTestId('shop-gift-pack-gato-trovao').click();
  await dialog.getByTestId('pack-gift-recipient').selectOption({ label: 'Beto (@beto)' });
  await waitFor(async () => /já tem todas as peças/.test((await dialog.getByTestId('pack-gift-quote').textContent().catch(() => '')) ?? ''), 'avisar que o amigo já tem o pacote');
  assert.equal(await dialog.getByTestId('pack-gift-review').isDisabled(), true);
});
