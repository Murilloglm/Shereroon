// Atividades e jogos: jogos vinculados em Configurações → Jogos e atividades, a aba "Atividades" dos amigos
// (jogando o quê, há quanto tempo, atualizando sozinha), o jogo no cartão de perfil e a privacidade.
// No site não há detecção (é do aplicativo de Windows): a atividade é informada pela API, como o aplicativo faz.
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

async function signUp(username) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(BASE_URL);
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-display-name').fill(username[0].toUpperCase() + username.slice(1));
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('account-settings-open').waitFor();
  return page;
}

before(async () => {
  stack = await startStack();
  browser = await launchChrome({ headless });
  ana = await signUp('ana');
  beto = await signUp('beto');
  const anaId = (await api(ana, 'GET', '/api/auth/me')).user.id;
  const betoId = (await api(beto, 'GET', '/api/auth/me')).user.id;
  await api(ana, 'POST', '/api/friends', { userId: betoId });
  await api(beto, 'POST', `/api/friends/${anaId}/accept`);
});

after(async () => {
  await browser?.close();
  await stack?.stop();
});

test('vincular um jogo à mão em Configurações → Jogos e atividades', async () => {
  await ana.getByTestId('account-settings-open').click();
  await ana.getByTestId('settings-nav-jogos').click();
  // No site, a detecção explica que é do aplicativo de Windows.
  assert.match(await ana.getByTestId('settings-panel-jogos').textContent(), /detecção automática existe no aplicativo para Windows/);
  await ana.getByTestId('game-name').fill('Minecraft');
  await ana.getByTestId('game-add').click();
  await waitFor(async () => (await ana.getByTestId('game-row').count()) === 1, 'o jogo aparecer na lista');
  assert.equal(await ana.getByTestId('game-row').getAttribute('data-game'), 'Minecraft');
  assert.equal(await ana.getByTestId('activity-privacy').inputValue(), 'amigos');
  await ana.getByTestId('settings-close').click();
});

test('a aba Atividades mostra o amigo jogando e atualiza sozinha quando o jogo muda', async () => {
  await beto.getByTestId('rail-dms').click();
  await beto.getByTestId('friends-tab-atividades').click();
  const row = beto.getByTestId('activity-row').and(beto.locator('[data-user="ana"]'));
  await row.waitFor();
  assert.equal(await row.getAttribute('data-playing'), '');

  await api(ana, 'PUT', '/api/me/activity', { name: 'Minecraft' });
  await waitFor(async () => (await row.getAttribute('data-playing')) === 'Minecraft', 'a atividade aparecer sem recarregar');
  assert.match(await row.getByTestId('activity-playing').textContent(), /Jogando\s*Minecraft\s*·\s*agora há pouco/);

  await api(ana, 'PUT', '/api/me/activity', { name: 'VALORANT', exe: 'VALORANT-Win64-Shipping.exe' });
  await waitFor(async () => (await row.getAttribute('data-playing')) === 'VALORANT', 'trocar de jogo atualizar a lista');
  assert.match(await row.getByTestId('activity-recent').textContent(), /Minecraft/);
});

test('o cartão de perfil mostra o jogo atual e os jogos do perfil', async () => {
  await beto.getByTestId('activity-row').and(beto.locator('[data-user="ana"]')).locator('span.cursor-pointer').first().click();
  const card = beto.getByTestId('profile-card');
  await card.waitFor();
  await card.getByTestId('profile-activity').waitFor();
  assert.equal(await card.getByTestId('profile-playing').textContent(), 'VALORANT');
  assert.match(await card.getByTestId('profile-games').textContent(), /Minecraft/);
  await beto.keyboard.press('Escape');
});

test('privacidade "Ninguém": o amigo deixa de ver o que a conta joga', async () => {
  await ana.getByTestId('account-settings-open').click();
  await ana.getByTestId('settings-nav-jogos').click();
  await ana.getByTestId('activity-privacy').selectOption('ninguem');
  const row = beto.getByTestId('activity-row').and(beto.locator('[data-user="ana"]'));
  await waitFor(async () => (await row.getAttribute('data-playing')) === '', 'a atividade sumir para o amigo');
  assert.equal(await row.getByTestId('activity-recent').count(), 0);
  await ana.getByTestId('activity-privacy').selectOption('amigos');
  await ana.getByTestId('settings-close').click();
});
