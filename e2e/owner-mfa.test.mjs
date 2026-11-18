import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Accounts } from '../server/src/community/auth.ts';
import { bootstrapAdmin, setOwnerMfaExemption } from '../server/src/community/global-admin.ts';
import { connectPglite } from '../server/src/db/db.ts';
import { migrate } from '../server/src/db/schema.ts';
import { BASE_URL, launchChrome, startStack, waitFor } from './harness.mjs';

const password = 'senha-isolada-deste-teste-e2e';
let folder, stack, browser, page, secondaryPage, normalPage, regularToken, groupId;
const api = async (method, path, token, body) => {
  const response = await fetch(BASE_URL + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
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
  folder = mkdtempSync(resolve(tmpdir(), 'cosmic-owner-mfa-'));
  const dataDir = resolve(folder, 'db'), db = await connectPglite(dataDir);
  await migrate(db);
  const accounts = new Accounts(db, { scryptCost: 10 });
  const owner = await accounts.register({ username: 'Mg', displayName: 'Mg', password });
  const secondary = await accounts.register({ username: 'segundo_admin', displayName: 'Mg', password });
  const regular = await accounts.register({ username: 'membro', displayName: 'Mg', password });
  regularToken = regular.token;
  await bootstrapAdmin(db, owner.user.id, password);
  await db.query('INSERT INTO global_permissions (user_id) VALUES ($1)', [secondary.user.id]);
  await setOwnerMfaExemption(db, owner.user.id, password, true, 'Exceção do proprietário para teste isolado');
  await db.close();
  stack = await startStack({ DATABASE_URL: '', PGLITE_DIR: dataDir });
  const created = await api('POST', '/api/groups', regularToken, { name: 'Servidor privado' });
  assert.equal(created.status, 200); groupId = created.data.group.id;
  browser = await launchChrome({ headless: process.env.E2E_HEADLESS !== '0' });
  page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  secondaryPage = await (await browser.newContext()).newPage();
  normalPage = await (await browser.newContext()).newPage();
});
after(async () => {
  await browser?.close(); await stack?.stop();
  if (folder && resolve(folder).startsWith(resolve(tmpdir(), 'cosmic-owner-mfa-'))) rmSync(folder, { recursive: true, force: true });
});
test('Mg abre o painel sem segundo fator e novas sessões preservam a exceção', async () => {
  await login(page, 'Mg');
  await page.getByTestId('settings-nav-admin').click();
  await page.getByText(/Acesso do proprietário: esta conta está dispensada/).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Seções da Administração Cosmic' }).getByRole('button').count(), 10);
  assert.equal(await page.getByRole('button', { name: 'Configurar autenticador', exact: true }).count(), 0);
  const next = await api('POST', '/api/auth/login', null, { username: 'Mg', password });
  assert.equal(next.status, 200); assert.equal(next.data.user.mfaExempt, true);
  assert.equal((await api('GET', '/api/admin/overview', next.data.token)).status, 200);
  await api('POST', '/api/auth/logout', next.data.token);
});
test('outro Cosmic Admin e um membro com nome Mg não recebem a dispensa', async () => {
  await login(secondaryPage, 'segundo_admin');
  await secondaryPage.getByTestId('settings-nav-admin').click();
  await secondaryPage.getByRole('button', { name: 'Configurar autenticador', exact: true }).waitFor();
  const token = await secondaryPage.evaluate(() => localStorage.getItem('shareroom:conta'));
  assert.equal((await api('GET', '/api/admin/overview', token)).status, 403);
  await login(normalPage, 'membro');
  assert.equal(await normalPage.getByTestId('settings-nav-admin').count(), 0);
  assert.equal((await api('GET', '/api/admin/overview', regularToken)).status, 403);
});
test('a conta dispensada entra em servidor sem convite e registra a ação', async () => {
  await page.getByRole('button', { name: 'Servidores', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'Servidor privado' }).getByRole('button', { name: 'Entrar como Admin', exact: true }).click();
  await page.getByTestId('dialog-input').fill('Administração pelo proprietário sem segundo fator');
  await page.getByTestId('dialog-confirm').click();
  await page.getByTestId('dialog-title').filter({ hasText: 'Entrar com acesso global?' }).waitFor();
  await page.getByTestId('dialog-confirm').click();
  await waitFor(async () => page.url().includes(groupId), 'entrada do proprietário');
  await page.getByTestId('member-cosmic-admin').waitFor();
  const token = await page.evaluate(() => localStorage.getItem('shareroom:conta'));
  const audit = await api('GET', '/api/admin/audit', token);
  assert(audit.data.rows.some((row) => row.action === 'servidor.entrada_global' && row.target_id === groupId));
});
