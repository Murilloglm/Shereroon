import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { Accounts } from '../server/src/community/auth.ts';
import { connectPglite } from '../server/src/db/db.ts';
import { migrate } from '../server/src/db/schema.ts';
import { CATALOG, COLLECTIONS } from '../shared/cosmetics.ts';
import { P } from '../shared/permissions.ts';
import { BASE_URL, launchChrome, root, startStack, useLocalDesktopConfig, waitFor } from './harness.mjs';

let stack, browser, ana, beto, caio, folder, a, b, c, g1, g2;
const password = 'senha-de-teste-cosmeticos';
const output = resolve(root, 'e2e/.artifacts/cosmetic-collections');
const evidence = { screenshots: [], geometry: [], loadedImages: {}, checks: [] };
const api = async (who, method, path, body) => {
  const res = await fetch(`${BASE_URL}${path}`, { method, headers: { authorization: `Bearer ${who.token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json(); assert.equal(res.status, 200, `${method} ${path}: ${JSON.stringify(json)}`); return json;
};
const row = (page, username) => page.getByTestId('member').and(page.locator(`[data-user="${username}"]`));
const settings = async (page, tab) => { if (!await page.getByTestId('settings-screen').count()) await page.getByTestId('account-settings-open').click(); await page.getByTestId(`settings-nav-${tab}`).click(); };
const closeSettings = (page) => page.getByTestId('settings-close').click();
const screenshot = async (page, name) => { await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true, animations: 'disabled' }); evidence.screenshots.push(`${name}.png`); };
const login = async (page, user) => {
  await page.goto(BASE_URL);
  await page.getByTestId('auth-username').fill(user.user.username);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();
  await page.getByTestId('account-settings-open').waitFor();
};
const buyCollection = async (who, id) => {
  const q = await api(who, 'GET', `/api/shop/collections/${id}/quote`);
  await api(who, 'POST', `/api/shop/collections/${id}/buy`, { expectedPrice: q.price, expectedItemIds: q.itemIds });
};
const equip = (who, slot, itemId) => api(who, 'PUT', '/api/me/equipped', { slot, itemId, variant: 'original' });

before(async () => {
  mkdirSync(output, { recursive: true });
  folder = mkdtempSync(resolve(tmpdir(), 'cosmic-collections-'));
  const db = await connectPglite(resolve(folder, 'db')); await migrate(db);
  const accounts = new Accounts(db, { scryptCost: 10 });
  a = await accounts.register({ username: 'colecaoana', displayName: 'Ana Cósmica', password });
  b = await accounts.register({ username: 'colecaobeto', displayName: 'Beto Estelar', password });
  c = await accounts.register({ username: 'colecaocaio', displayName: 'Caio Lunar', password });
  await db.query('INSERT INTO global_permissions(user_id) VALUES ($1)', [b.user.id]);
  // Sessão administrativa já verificada, como nos fixtures de integração do backend.
  await db.query("UPDATE sessions SET admin_verified_until=now()+interval '10 minutes' WHERE user_id=$1", [b.user.id]);
  await db.close();
  stack = await startStack({ COSMIC_DEV_POINTS: '1', DATABASE_URL: '', PGLITE_DIR: resolve(folder, 'db') });
  await api(a, 'POST', '/api/dev/points', { amount: 10_000 });
  g1 = (await api(a, 'POST', '/api/groups', { name: 'Observatório Cósmico' })).group.id;
  g2 = (await api(b, 'POST', '/api/groups', { name: 'Segundo Universo' })).group.id;
  for (const [owner, group, people] of [[a,g1,[b,c]],[b,g2,[a]]]) {
    const { invite } = await api(owner, 'POST', `/api/groups/${group}/invites`, {});
    for (const who of people) await api(who, 'POST', `/api/invites/${invite.code}/accept`);
  }
  await api(a, 'POST', '/api/friends', { userId: c.user.id });
  await api(c, 'POST', `/api/friends/${a.user.id}/accept`);
  for (const collection of COLLECTIONS) await buyCollection(b, collection.id);
  browser = await launchChrome({ headless: true, fakeMic: true });
  ana = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  beto = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  caio = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await login(ana, a); await login(caio, c);
  await beto.addInitScript((token) => localStorage.setItem('shareroom:conta', token), b.token);
  for (const page of [ana,beto,caio]) { await page.goto(`${BASE_URL}/#/grupos/${g1}`); await page.getByTestId('chat').waitFor(); }
}, { timeout: 60_000 });

after(async () => {
  writeFileSync(resolve(output, 'validation.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser?.close(); await stack?.stop();
  if (folder && resolve(folder).startsWith(resolve(tmpdir(), 'cosmic-collections-'))) rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

test('Coleções: 11 capas, prévia com nick próprio e compra real de pacote e item avulso', async () => {
  await settings(ana, 'loja'); await ana.getByTestId('shop-collections').click();
  assert.equal(await ana.getByTestId('collection-card').count(), 11);
  await screenshot(ana, 'shop-collections');
  await ana.getByTestId('buy-collection-night-fury').click();
  await ana.getByTestId('dialog-confirm').click();
  await waitFor(async () => (await ana.locator('[data-collection="night-fury"]').textContent()).includes('5/5 adquiridos'), 'coleção adquirida');
  await ana.getByTestId('preview-night-fury').click();
  const modal = ana.getByRole('dialog', { name: 'Fúria da Noite', exact: true });
  assert.equal(await modal.getByTestId('collection-item').count(), 5);
  assert.match(await modal.getByTestId('member-effect-preview').first().textContent(), /Ana Cósmica/);
  await screenshot(ana, 'night-fury-preview');
  await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  await ana.getByTestId('preview-neon').click();
  await ana.getByTestId('shop-buy-neon-decoracao').click(); await ana.getByTestId('dialog-confirm').click();
  await ana.getByTestId('equip-neon-decoracao').waitFor();
  await ana.getByRole('dialog', { name: 'Neon', exact: true }).getByRole('button', { name: 'Fechar', exact: true }).click();
  await closeSettings(ana);
  evidence.checks.push('Compra de coleção e item avulso pela interface');
});

test('cinco coleções misturadas, prévia de perfil, efeito na outra conta e desequipar em tempo real', async () => {
  for (const id of ['omen-moldura','rimuru-fundo','clove-cor-nome','anel-aurora']) {
    await api(a, 'POST', '/api/shop/buy', { itemId: id, expectedPrice: CATALOG.find((item) => item.id === id).price });
  }
  await settings(ana, 'inventario');
  for (const id of ['neon-decoracao','omen-moldura','rimuru-fundo','clove-cor-nome','night-fury-efeito-nome']) await ana.getByTestId(`equip-${id}`).click();
  const effect = row(beto, a.user.username).locator('[data-name-effect="night-fury-efeito-nome"]');
  await effect.waitFor();
  const memberBox = await row(beto, a.user.username).boundingBox();
  const effectBox = await effect.boundingBox();
  assert.equal(memberBox.height, effectBox.height);
  await closeSettings(ana);
  await row(beto, a.user.username).click();
  const profile = beto.getByTestId('profile-card');
  await profile.locator('[data-profile-frame="omen-moldura"]').waitFor();
  await waitFor(async () => (await profile.getByTestId('profile-banner').getAttribute('style')).includes('rimuru'), 'banner original de Rimuru');
  await screenshot(beto, 'mixed-profile');
  await beto.keyboard.press('Escape');
  await settings(ana, 'efeitos-nome');
  await ana.getByTestId('unequip-night-fury-efeito-nome').click();
  await effect.waitFor({ state: 'detached' });
  assert.equal((await row(beto, a.user.username).boundingBox()).height, memberBox.height);
  await ana.getByTestId('equip-night-fury-efeito-nome').click(); await effect.waitFor();
  await closeSettings(ana);
  evidence.checks.push('Mistura de coleções; perfil; equipar/desequipar sincronizado; altura preservada');
});

test('11 efeitos originais no administrador, sem substituir por efeito de cargo', async () => {
  assert.equal(await row(ana, b.user.username).getByTestId('member-cosmic-admin').count(), 1);
  for (const collection of COLLECTIONS) {
    await equip(b, 'efeito-nome', `${collection.id}-efeito-nome`);
    const effect = row(ana, b.user.username).locator(`[data-name-effect="${collection.id}-efeito-nome"] img`);
    await effect.waitFor();
    await waitFor(() => effect.evaluate((img) => img.complete && img.naturalWidth > 0), `${collection.name} carregada`);
    await row(ana, b.user.username).screenshot({ path: resolve(output, `member-${collection.id}.png`) });
  }
  await equip(b, 'efeito-nome', 'omen-efeito-nome');
  await row(ana, b.user.username).locator('[data-name-effect="omen-efeito-nome"]').waitFor();
  await screenshot(ana, 'members-admin-owner');
  evidence.checks.push('Todos os 11 efeitos na conta de administrador');
});

test('presentes da coleção e de item individual pela loja, com itens adquiridos no destinatário', async () => {
  await settings(ana, 'loja'); await ana.getByTestId('shop-collections').click();
  const card = ana.locator('[data-collection="madu-kaiden"]');
  await card.getByRole('button', { name: 'Presentear coleção', exact: true }).click();
  await ana.getByLabel('Amigo destinatário', { exact: true }).selectOption(c.user.id);
  await ana.getByLabel('Mensagem do presente', { exact: true }).fill('Seu gato elétrico!');
  await waitFor(async () => !(await ana.getByRole('button', { name: 'Revisar presente', exact: true }).isDisabled()), 'cotação do presente');
  await ana.getByRole('button', { name: 'Revisar presente', exact: true }).click(); await ana.getByTestId('dialog-confirm').click();
  await ana.getByRole('button', { name: 'Revisar presente', exact: true }).waitFor({ state: 'detached' });
  await ana.getByTestId('preview-clove').click();
  await ana.getByTestId('collection-item').and(ana.locator('[data-item="clove-efeito-nome"]')).getByRole('button', { name: 'Presentear item', exact: true }).click();
  await ana.getByLabel('Amigo destinatário', { exact: true }).selectOption(c.user.id);
  await ana.getByRole('button', { name: 'Revisar presente', exact: true }).click(); await ana.getByTestId('dialog-confirm').click();
  await ana.getByRole('button', { name: 'Revisar presente', exact: true }).waitFor({ state: 'detached' });
  await closeSettings(ana);
  await settings(caio, 'efeitos-nome');
  await caio.getByTestId('equip-madu-kaiden-efeito-nome').click();
  await caio.getByTestId('equip-clove-efeito-nome').waitFor();
  await screenshot(caio, 'name-effects-inventory');
  await closeSettings(caio);
  evidence.checks.push('Presente de coleção e item; recebimento e equipamento pelo destinatário');
});

test('apelido, cargo, status, offline e outro servidor preservam o efeito', async () => {
  const role = await api(a, 'POST', `/api/groups/${g1}/roles`, { name: 'Moderadores', permissions: P.MANAGE_MESSAGES.toString(), color: '#7ddcff' });
  await api(a, 'PATCH', `/api/groups/${g1}/members/${c.user.id}`, { roleIds: [role.id] });
  await api(c, 'PATCH', `/api/groups/${g1}/members/${c.user.id}`, { nickname: 'Lunar Mod' });
  await waitFor(async () => (await row(ana, c.user.username).getByTestId('member-name').textContent()) === 'Lunar Mod', 'apelido');
  await row(ana, c.user.username).locator('[data-name-effect="madu-kaiden-efeito-nome"]').waitFor();
  assert.equal(await row(ana, c.user.username).getByTestId('member-top-role').textContent(), 'Moderadores');
  await caio.context().close();
  await waitFor(async () => (await row(ana, c.user.username).getAttribute('data-online')) === 'false', 'usuário offline');
  await row(ana, c.user.username).locator('[data-name-effect="madu-kaiden-efeito-nome"]').waitFor();
  await screenshot(ana, 'offline-effect');
  await ana.goto(`${BASE_URL}/#/grupos/${g2}`); await ana.getByTestId('chat').waitFor();
  await row(ana, b.user.username).locator('[data-name-effect="omen-efeito-nome"]').waitFor();
  await ana.goto(`${BASE_URL}/#/grupos/${g1}`); await ana.getByTestId('chat').waitFor();
  evidence.checks.push('Apelido, cargo, offline e efeitos entre servidores');
});

test('redimensionamento e animações desativadas não alteram limites da linha', async () => {
  for (const width of [1440, 1100, 900, 390]) {
    await ana.setViewportSize({ width, height: 1000 });
    const narrow = width < 1024;
    if (narrow) {
      const button = ana.getByRole('button', { name: 'Membros', exact: true });
      if (!await button.count()) await ana.getByTestId('channel').and(ana.locator('[data-name="geral"]')).click();
      await button.click();
      await ana.getByRole('dialog', { name: 'Membros', exact: true }).evaluate((el) => Promise.allSettled(el.getAnimations().map((animation) => animation.finished)));
    }
    const member = row(ana, b.user.username);
    const dimensions = await member.evaluate((el) => ({ member: el.getBoundingClientRect().toJSON(), effect: el.querySelector('[data-name-effect]').getBoundingClientRect().toJSON(), height: el.offsetHeight, effectHeight: el.querySelector('[data-name-effect]').offsetHeight }));
    const m = dimensions.member, e = dimensions.effect;
    assert.equal(dimensions.height, dimensions.effectHeight); assert(e.width <= m.width + 1);
    evidence.geometry.push({ width, member: m, effect: e });
    if (narrow) await ana.getByRole('dialog', { name: 'Membros', exact: true }).getByRole('button', { name: 'Fechar', exact: true }).click();
  }
  await ana.setViewportSize({ width: 1440, height: 1000 });
  await settings(ana, 'efeitos-nome'); await ana.getByRole('switch', { name: 'Animar efeitos de nome', exact: true }).click();
  const image = ana.getByTestId('member-effect-preview').first().locator('[data-name-effect] img');
  assert.equal(await image.evaluate((el) => getComputedStyle(el).animationName), 'none');
  await ana.reload(); await ana.getByTestId('chat').waitFor();
  assert.equal(await row(ana, b.user.username).locator('[data-name-effect] img').evaluate((el) => getComputedStyle(el).animationName), 'none');
  await settings(ana, 'efeitos-nome'); await ana.getByRole('switch', { name: 'Animar efeitos de nome', exact: true }).click(); await closeSettings(ana);
  await ana.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await row(ana, b.user.username).locator('[data-name-effect] img').evaluate((el) => getComputedStyle(el).animationName), 'none');
  await ana.emulateMedia({ reducedMotion: 'no-preference' });
  evidence.checks.push('Redimensionamento; desligar movimento persistido; prefers-reduced-motion');
});

test('arquivos PNG/WebP carregam no navegador e no protocolo do desktop', { timeout: 60_000 }, async () => {
  const assets = COLLECTIONS.flatMap((collection) => ['cover.webp','avatar-decoration.png','profile-frame.png','profile-banner.webp','username-effect.png','member-name-effect.webp','server-badge.png'].map((file) => `assets/cosmetics/${collection.id}/${file}`));
  const loadAssets = async (page) => page.evaluate(async (paths) => Promise.all(paths.map((path) => new Promise((done) => { const image = new Image(); image.onload = () => done({ path, width: image.naturalWidth }); image.onerror = () => done({ path, width: 0 }); image.src = new URL(path, location.href).href; }))), assets);
  const web = await loadAssets(ana); assert(web.every((asset) => asset.width > 0)); evidence.loadedImages.web = web.length;
  const restore = useLocalDesktopConfig();
  const userData = resolve(folder, 'electron');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  let app;
  try {
    app = await electron.launch({ executablePath: resolve(root, 'desktop/node_modules/electron/dist/electron.exe'), args: [resolve(root, 'desktop')], env: { ...env, SHAREROOM_E2E: '1', SHAREROOM_USER_DATA: userData, SHAREROOM_API_URL: BASE_URL, SHAREROOM_SITE_URL: 'https://exemplo.github.io/shareroom/' } });
    const page = await app.firstWindow();
    await page.getByTestId('auth-username').fill(c.user.username); await page.getByTestId('auth-password').fill(password); await page.getByTestId('auth-submit').click();
    await page.getByTestId('account-settings-open').waitFor();
    const desktop = await loadAssets(page); assert(desktop.every((asset) => asset.width > 0)); evidence.loadedImages.desktop = desktop.length;
    await settings(page, 'efeitos-nome'); await page.getByTestId('unequip-madu-kaiden-efeito-nome').waitFor();
    await screenshot(page, 'desktop-name-effects');
  } finally { await app?.close(); restore(); }
  evidence.checks.push('77 imagens carregadas no navegador e no Electron');
});

test('troca durante resposta atrasada mantém a arte visível e descarta o equipamento antigo', async () => {
  let release, started;
  const held = new Promise((done) => { release = done; });
  const fetching = new Promise((done) => { started = done; });
  let intercepted = false;
  const handler = async (route) => {
    if (!intercepted && route.request().url().includes(b.user.id)) {
      intercepted = true;
      const response = await route.fetch(); started(); await held; await route.fulfill({ response });
    } else await route.continue();
  };
  await ana.route('**/api/cosmetics**', handler);
  try {
    await equip(b, 'efeito-nome', 'jett-efeito-nome'); await fetching;
    await row(ana, b.user.username).locator('[data-name-effect="omen-efeito-nome"]').waitFor();
    await equip(b, 'efeito-nome', 'neon-efeito-nome');
    await row(ana, b.user.username).locator('[data-name-effect="neon-efeito-nome"]').waitFor();
    const stale = ana.waitForResponse((response) => response.url().includes('/api/cosmetics') && response.url().includes(b.user.id));
    release(); await stale;
    await ana.evaluate(() => new Promise(requestAnimationFrame));
    await row(ana, b.user.username).locator('[data-name-effect="neon-efeito-nome"]').waitFor();
  } finally { release(); await ana.unroute('**/api/cosmetics**', handler); }
  evidence.checks.push('Resposta antiga descartada sem apagar o efeito durante atualização');
});

test('lista com 200 linhas: medição de quadros com e sem efeitos', async () => {
  const result = await ana.evaluate(async () => {
    const template = document.querySelector('[data-testid="member"]:has([data-name-effect])');
    const fixture = document.createElement('div');
    Object.assign(fixture.style, { position: 'fixed', inset: '0 0 auto auto', width: '256px', height: '720px', overflow: 'auto', zIndex: '100', background: '#080a16' });
    const measure = async (decorated) => {
      fixture.replaceChildren();
      for (let i = 0; i < 200; i++) { const row = template.cloneNode(true); if (!decorated) row.querySelector('[data-name-effect]')?.remove(); fixture.append(row); }
      const frames = []; let previous;
      await new Promise((done) => { const sample = (now) => { if (previous) frames.push(now-previous); previous = now; fixture.scrollTop += 12; frames.length < 60 ? requestAnimationFrame(sample) : done(); }; requestAnimationFrame(sample); });
      frames.sort((a,b) => a-b);
      return { meanMs: frames.reduce((a,b) => a+b,0)/frames.length, p95Ms: frames[Math.floor(frames.length*.95)] };
    };
    document.body.append(fixture);
    try { return { baseline: await measure(false), decorated: await measure(true), rows: 200 }; }
    finally { fixture.remove(); }
  });
  assert(result.decorated.p95Ms <= Math.max(25, result.baseline.p95Ms * 1.5), JSON.stringify(result));
  evidence.performance = result;
});

test('efeito permanece na lateral durante chamada e os controles de voz continuam acessíveis', async () => {
  await ana.goto(`${BASE_URL}/#/grupos/${g1}`); await ana.getByTestId('chat').waitFor();
  await beto.goto(`${BASE_URL}/#/grupos/${g1}`); await beto.getByTestId('chat').waitFor();
  for (const page of [ana, beto]) {
    await page.getByTestId('channel').filter({ hasText: /^Sala de voz$/ }).click();
    await waitFor(async () => (await page.getByTestId('connection').getAttribute('data-phase')) === 'connected', 'conexão LiveKit real');
  }
  const participant = ana.getByTestId('participants').getByTestId('participant').and(ana.locator(`[data-identity="${b.user.id}"]`));
  await participant.locator('[data-name-effect="neon-efeito-nome"]').waitFor();
  await participant.getByTestId('voice-person-menu').click();
  await participant.getByRole('menu').waitFor();
  assert.match(await participant.getByRole('menu').textContent(), /Volume da voz/);
  await screenshot(ana, 'voice-member-effect');
  await ana.keyboard.press('Escape');
  for (const page of [beto, ana]) await page.getByTestId('dock-leave').click();
  evidence.checks.push('Efeito na lista de voz, duas contas LiveKit e menu de moderação acessível');
});

test('reiniciar o backend e recarregar preserva equipamento e inventário anterior', { timeout: 60_000 }, async () => {
  await ana.setViewportSize({ width: 1440, height: 1000 });
  await stack.stop();
  stack = await startStack({ COSMIC_DEV_POINTS: '1', DATABASE_URL: '', PGLITE_DIR: resolve(folder, 'db') });
  await ana.reload(); await ana.getByTestId('chat').waitFor();
  await row(ana, a.user.username).locator('[data-name-effect="night-fury-efeito-nome"]').waitFor();
  const saved = await api(a, 'GET', '/api/me/inventory');
  assert(saved.items.some((item) => item.id === 'anel-aurora'));
  assert.equal(saved.equipped.decoracao.item, 'neon-decoracao');
  assert.equal(saved.equipped['efeito-nome'].item, 'night-fury-efeito-nome');
  evidence.checks.push('Reinício real com banco em disco; sessão, slots e item antigo preservados');
});
