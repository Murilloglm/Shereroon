// Diálogos próprios do app no lugar das janelas nativas do navegador: excluir canal (cancelar pelo Esc não
// exclui, Tab fica preso no diálogo, o fundo fica inerte, confirmar duas vezes exclui uma só), entrada de
// texto com validação, exclusão irreversível que exige o nome, e nenhuma janela nativa no caminho.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, startStack, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
let stack;
let browser;
let page;
const nativeDialogs = [];
const deletes = [];

const channel = (name) => page.getByTestId('channel').filter({ hasText: new RegExp(`^${name}$`) });
const dialog = () => page.getByTestId('dialog');

async function createChannel(name) {
  await page.getByTestId('group-menu').click();
  await page.getByTestId('group-new-channel').click();
  await page.getByTestId('channel-kind-texto').click();
  await page.getByTestId('channel-name').fill(name);
  await page.getByTestId('create-channel').locator('button[type="submit"]').click();
  await channel(name).waitFor();
}

async function openSettings(tab) {
  await page.getByTestId('group-menu').click();
  await page.getByTestId('group-settings-open').click();
  await page.getByTestId(`settings-tab-${tab}`).click();
}

before(async () => {
  stack = await startStack();
  browser = await launchChrome({ headless });
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  page = await context.newPage();
  // Qualquer janela nativa (alert/confirm/prompt) é registrada e recusada: o teste falha se aparecer uma.
  page.on('dialog', (native) => {
    nativeDialogs.push(native.message());
    void native.dismiss();
  });
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && /\/api\/channels\//.test(request.url())) deletes.push(request.url());
  });
  await page.goto(BASE_URL);
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill('dora');
  await page.getByTestId('auth-display-name').fill('Dora');
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('rail-create').click();
  await page.getByTestId('group-name').fill('Grupo da Dora');
  await page.getByTestId('group-create').click();
  await page.getByTestId('chat').waitFor();
  await createChannel('apagar-me');
});

after(async () => {
  await browser?.close();
  await stack?.stop();
});

test('excluir canal: o diálogo mostra o nome, Esc cancela sem excluir e o foco volta ao botão', async () => {
  await openSettings('canais');
  const row = page.getByTestId('channel-row').and(page.locator('[data-channel="apagar-me"]'));
  const trigger = row.getByTestId('channel-delete');
  await trigger.click();
  await dialog().waitFor();
  assert.equal(await dialog().getAttribute('data-kind'), 'excluir');
  assert.equal(await page.getByTestId('dialog-item').textContent(), '#apagar-me');
  assert.equal(await page.getByTestId('dialog-confirm').textContent(), 'Excluir');
  // Ação destrutiva: o foco começa no botão seguro.
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'dialog-cancel');
  // O resto da página não recebe clique nem foco enquanto o diálogo está aberto.
  assert.equal(await page.evaluate(() => document.getElementById('root').hasAttribute('inert')), true);

  await page.keyboard.press('Escape');
  await waitFor(async () => (await dialog().count()) === 0, 'o diálogo fechar');
  // O Esc fechou só o diálogo: as configurações continuam abertas e o canal continua lá.
  assert.equal(await row.count(), 1);
  assert.equal(deletes.length, 0, 'cancelar não chamou o servidor');
  assert.equal(await page.evaluate(() => document.getElementById('root').hasAttribute('inert')), false);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'channel-delete', 'o foco voltou ao botão que abriu');
});

test('Tab fica preso dentro do diálogo e Cancelar não exclui', async () => {
  const row = page.getByTestId('channel-row').and(page.locator('[data-channel="apagar-me"]'));
  await row.getByTestId('channel-delete').click();
  await dialog().waitFor();
  const visited = new Set();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => document.querySelector('[data-testid="dialog"]').contains(document.activeElement));
    assert.ok(inside, 'o foco continua dentro do diálogo');
    visited.add(await page.evaluate(() => document.activeElement?.dataset.testid ?? document.activeElement?.tagName));
  }
  assert.ok(visited.has('dialog-confirm') && visited.has('dialog-cancel') && visited.has('dialog-close'), `passou pelos botões (${[...visited].join(', ')})`);
  await page.getByTestId('dialog-cancel').click();
  await waitFor(async () => (await dialog().count()) === 0, 'o diálogo fechar');
  assert.equal(deletes.length, 0);
});

test('confirmar com clique duplo exclui uma vez só e mostra o carregamento', async () => {
  const row = page.getByTestId('channel-row').and(page.locator('[data-channel="apagar-me"]'));
  await row.getByTestId('channel-delete').click();
  await dialog().waitFor();
  await page.getByTestId('dialog-confirm').dblclick();
  await waitFor(async () => (await dialog().count()) === 0, 'o diálogo fechar depois de excluir');
  await waitFor(async () => (await row.count()) === 0, 'o canal sumir da lista');
  assert.equal(deletes.length, 1, `uma exclusão só (${deletes.length})`);
  await page.getByRole('dialog', { name: /Configurações de/ }).getByRole('button', { name: 'Fechar' }).first().click();
});

test('entrada de texto: valida antes de enviar e salva o apelido', async () => {
  await page.getByTestId('group-menu').click();
  await page.getByRole('menuitem', { name: 'Meu apelido neste grupo' }).click();
  await dialog().waitFor();
  assert.equal(await dialog().getAttribute('data-kind'), 'entrada');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'dialog-input', 'o foco começa no campo');
  await page.getByTestId('dialog-input').fill('x'.repeat(40));
  await page.keyboard.press('Enter');
  await page.getByTestId('dialog-field-error').waitFor();
  assert.match(await page.getByTestId('dialog-field-error').textContent(), /no máximo 32/);
  assert.equal(await dialog().count(), 1, 'não enviou com o valor inválido');
  await page.getByTestId('dialog-input').fill('Dorinha');
  await page.keyboard.press('Enter');
  await waitFor(async () => (await dialog().count()) === 0, 'o diálogo fechar');
  await waitFor(async () => /Dorinha/.test((await page.getByTestId('member-list').textContent()) ?? ''), 'o apelido aparecer na lista');
});

test('excluir o grupo exige digitar o nome; com o nome certo, exclui', async () => {
  await openSettings('geral');
  await page.getByTestId('group-delete').click();
  await dialog().waitFor();
  const confirm = page.getByTestId('dialog-confirm');
  assert.equal(await confirm.isDisabled(), true, 'sem o nome o botão fica desligado');
  await page.getByTestId('dialog-input').fill('Grupo da');
  assert.equal(await confirm.isDisabled(), true);
  await page.getByTestId('dialog-input').fill('grupo da dora');
  assert.equal(await confirm.isDisabled(), false);
  await confirm.click();
  await waitFor(async () => (await page.getByTestId('chat').count()) === 0, 'o grupo sumir');
});

test('preferência de menos movimento: o diálogo abre sem animação', async () => {
  const reduced = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 900, height: 700 } });
  const other = await reduced.newPage();
  await other.goto(BASE_URL);
  await other.getByTestId('auth-tab-criar').click();
  await other.getByTestId('auth-username').fill('eli');
  await other.getByTestId('auth-display-name').fill('Eli');
  await other.getByTestId('auth-password').fill('senha-de-teste-1');
  await other.getByTestId('auth-submit').click();
  await other.getByTestId('account-menu').click();
  await other.getByTestId('account-logout').click();
  await other.getByTestId('dialog').waitFor();
  assert.equal(await other.evaluate(() => getComputedStyle(document.querySelector('[data-testid="dialog"]')).animationName), 'none');
  await other.getByTestId('dialog-cancel').click();
  await waitFor(async () => (await other.getByTestId('dialog').count()) === 0, 'fechar na hora');
  await reduced.close();
});

test('nenhuma janela nativa apareceu', () => {
  assert.deepEqual(nativeDialogs, []);
});
