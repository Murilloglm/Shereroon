import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Accounts } from '../server/src/community/auth.ts';
import { bootstrapAdmin, totp } from '../server/src/community/global-admin.ts';
import { connectPglite } from '../server/src/db/db.ts';
import { migrate } from '../server/src/db/schema.ts';
import { BASE_URL, launchChrome, startStack, waitFor, root } from './harness.mjs';

let stack, browser, adminPage, userPage, recipientPage, folder, sender, recipient, groupId;
const password = 'senha-exclusiva-de-teste-e2e';
const api = async (method, path, token, body) => {
  const result = await fetch(`${BASE_URL}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await result.json(); assert.equal(result.status, 200, JSON.stringify(json)); return json;
};
const login = async (page, username) => {
  await page.goto(BASE_URL);
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('account-settings-open').waitFor();
  await page.getByTestId('account-settings-open').click();
};
before(async () => {
  folder = mkdtempSync(resolve(tmpdir(), 'cosmic-platform-'));
  const dataDir = resolve(folder, 'pglite');
  const db = await connectPglite(dataDir); await migrate(db);
  const accounts = new Accounts(db, { scryptCost: 10 });
  const admin = await accounts.register({ username: 'Mg', displayName: 'Mg', password });
  sender = await accounts.register({ username: 'estelar', displayName: 'Estelar', password });
  recipient = await accounts.register({ username: 'aurora', displayName: 'Aurora', password });
  await bootstrapAdmin(db, admin.user.id, password); await db.close();
  stack = await startStack({ DATABASE_URL: '', PGLITE_DIR: dataDir });
  await api('POST', '/api/friends', sender.token, { userId: recipient.user.id });
  await api('POST', `/api/friends/${sender.user.id}/accept`, recipient.token);
  groupId = (await api('POST', '/api/groups', recipient.token, { name: 'Privado para auditoria' })).group.id;
  browser = await launchChrome({ headless: process.env.E2E_HEADLESS !== '0' });
  adminPage = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  userPage = await (await browser.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
  recipientPage = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  await login(adminPage, 'Mg');
});
after(async () => {
  await browser?.close(); await stack?.stop();
  // O diretório foi criado pelo teste, com prefixo conhecido e fora dos dados reais do projeto.
  if (folder && resolve(folder).startsWith(resolve(tmpdir(), 'cosmic-platform-'))) rmSync(folder, { recursive: true, force: true });
});

test('administrador configura MFA pela interface e vê as dez seções reais', async () => {
  await adminPage.getByTestId('settings-nav-admin').click();
  await adminPage.getByLabel('Senha atual', { exact: true }).fill(password);
  await adminPage.getByRole('button', { name: 'Configurar autenticador', exact: true }).click();
  const secret = await adminPage.locator('code').textContent();
  await adminPage.getByLabel('Código de 6 dígitos', { exact: true }).fill(totp(secret));
  await adminPage.getByRole('button', { name: 'Verificar acesso', exact: true }).click();
  await adminPage.getByRole('button', { name: 'Já guardei os códigos', exact: true }).click();
  assert.equal(await adminPage.getByRole('navigation', { name: 'Seções da Administração Cosmic' }).getByRole('button').count(), 10);
  await adminPage.getByTestId('settings-nav-loja').click();
  await waitFor(async () => /∞ Cosmic Points/.test(await adminPage.getByTestId('shop-balance').textContent()), 'saldo infinito por permissão');
  await adminPage.getByTestId('settings-nav-admin').click();
  await adminPage.getByRole('button', { name: 'Códigos promocionais', exact: true }).click();
});
test('cria promoção e concede pontos com revisão e confirmação', async () => {
  await adminPage.getByLabel('Código personalizado', { exact: true }).fill('UpdateE2E3.1');
  await adminPage.getByLabel('Quantidade de pontos', { exact: true }).fill('500');
  await adminPage.getByLabel('Motivo da operação', { exact: true }).fill('Promoção de teste da interface');
  await adminPage.getByRole('button', { name: 'Revisar operação', exact: true }).click();
  await adminPage.getByTestId('dialog-confirm').click();
  await adminPage.getByRole('cell', { name: 'UpdateE2E3.1', exact: true }).waitFor();
  await adminPage.getByRole('navigation', { name: 'Seções da Administração Cosmic' }).getByRole('button', { name: 'Cosmic Points', exact: true }).click();
  await adminPage.getByLabel('ID interno da conta', { exact: true }).fill(sender.user.id);
  await adminPage.getByLabel('Quantidade (negativa para remover)', { exact: true }).fill('800');
  await adminPage.getByLabel('Motivo da operação', { exact: true }).fill('Crédito autorizado para teste de presentes');
  await adminPage.getByRole('button', { name: 'Revisar operação', exact: true }).click();
  await adminPage.getByTestId('dialog-confirm').click();
  await adminPage.getByRole('cell', { name: 'Crédito autorizado para teste de presentes', exact: true }).waitFor();
  mkdirSync(resolve(root, 'e2e/.artifacts'), { recursive: true });
  await adminPage.screenshot({ path: resolve(root, 'e2e/.artifacts/platform-admin.png') });
});
test('conta comum resgata o código e presenteia um amigo pela loja', async () => {
  await login(userPage, 'estelar');
  assert.equal(await userPage.getByTestId('settings-nav-admin').count(), 0);
  await userPage.getByTestId('settings-nav-loja').click();
  await userPage.getByLabel('Código promocional', { exact: true }).fill('UpdateE2E3.1');
  await userPage.getByRole('button', { name: 'Resgatar', exact: true }).click();
  await userPage.getByRole('status').filter({ hasText: '500 Cosmic Points adicionados' }).waitFor();
  const item = userPage.getByTestId('shop-item').and(userPage.locator('[data-item="anel-aurora"]'));
  await item.getByRole('button', { name: 'Presentear um amigo', exact: true }).click();
  await userPage.getByLabel('Amigo destinatário', { exact: true }).selectOption(recipient.user.id);
  await userPage.getByLabel('Mensagem do presente', { exact: true }).fill('Boa noite, Aurora!');
  await userPage.getByRole('button', { name: 'Revisar presente', exact: true }).click();
  await userPage.getByTestId('dialog-confirm').click();
  await userPage.getByRole('button', { name: 'Revisar presente', exact: true }).waitFor({ state: 'hidden' });
  const token = await userPage.evaluate(() => localStorage.getItem('shareroom:conta'));
  const balance = await api('GET', '/api/me/points', token);
  assert.equal(balance.history.filter((entry) => entry.reason === 'presente').length, 1);
  assert.equal(balance.history.find((entry) => entry.reason === 'presente').delta, -150);
  await waitFor(async () => (await userPage.getByTestId('shop-balance').textContent()).includes(balance.points.toLocaleString('pt-BR')), 'débito do presente');
  await userPage.getByTestId('settings-nav-presentes').click();
  await userPage.getByText('Boa noite, Aurora!', { exact: true }).waitFor();
});
test('destinatário recebe item e notificação persistente', async () => {
  await login(recipientPage, 'aurora');
  await recipientPage.getByTestId('settings-nav-presentes').click();
  await recipientPage.getByText('Boa noite, Aurora!', { exact: true }).waitFor();
  await recipientPage.getByRole('button', { name: 'Marcar como lido', exact: true }).click();
  await recipientPage.getByRole('button', { name: 'Marcar como lido', exact: true }).waitFor({ state: 'hidden' });
  await recipientPage.getByTestId('settings-nav-inventario').click();
  await recipientPage.getByTestId('inventory-item').and(recipientPage.locator('[data-item="anel-aurora"]')).waitFor();
});
test('admin entra em servidor privado sem convite com identificação e logs', async () => {
  await adminPage.getByRole('button', { name: 'Servidores', exact: true }).click();
  const row = adminPage.getByRole('row').filter({ hasText: 'Privado para auditoria' });
  await row.getByRole('button', { name: 'Entrar como Admin', exact: true }).click();
  await adminPage.getByTestId('dialog-input').fill('Verificação oficial de acesso administrativo');
  await adminPage.getByTestId('dialog-confirm').click();
  await adminPage.getByTestId('dialog-title').filter({ hasText: 'Entrar com acesso global?' }).waitFor();
  await adminPage.getByTestId('dialog-confirm').click();
  await waitFor(async () => (await adminPage.url()).includes(groupId), 'abertura do servidor sem convite');
  await adminPage.getByTestId('member-cosmic-admin').waitFor();
  const token = await adminPage.evaluate(() => localStorage.getItem('shareroom:conta'));
  const logs = await api('GET', '/api/admin/audit', token);
  assert(logs.rows.some((entry) => entry.action === 'servidor.entrada_global' && entry.target_id === groupId));
  await adminPage.screenshot({ path: resolve(root, 'e2e/.artifacts/platform-server.png') });
});
test('uma sessão sem MFA não recebe mensagens do servidor pela sessão verificada de outro aparelho', async () => {
  const fresh = await api('POST', '/api/auth/login', undefined, { username: 'Mg', password });
  const denied = await fetch(`${BASE_URL}/api/groups/${groupId}`, { headers: { authorization: `Bearer ${fresh.token}` } });
  assert.equal(denied.status, 403);
  const socket = new WebSocket(`${BASE_URL.replace('http:', 'ws:')}/api/gateway`);
  const events = [];
  try {
    await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('Gateway não autenticou a sessão isolada')), 5000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({ t: 'auth', token: fresh.token })));
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Erro ao abrir gateway')); });
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)); events.push(message);
        if (message.t === 'ready') { clearTimeout(timer); accept(); }
      });
    });
    const view = await api('GET', `/api/groups/${groupId}`, recipient.token);
    const channel = view.channels.find((item) => item.kind === 'texto');
    const sent = await api('POST', `/api/channels/${channel.id}/messages`, recipient.token, { content: 'Evento autorizado somente na sessão com MFA' });
    await adminPage.getByText('Evento autorizado somente na sessão com MFA', { exact: true }).waitFor();
    assert.equal(events.some((event) => event.message?.id === sent.message.id), false);
  } finally { socket.close(); await api('POST', '/api/auth/logout', fresh.token); }
});
