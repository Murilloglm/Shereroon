import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { pngFile } from './images.mjs';

let stack, browser, ana, beto, caio, folder, a, b, c, g1, g2;
const password = 'senha-de-teste-cosmeticos';
const output = resolve(root, 'e2e/.artifacts/cosmetic-collections');
const evidence = { screenshots: [], geometry: [], loadedImages: {}, checks: [] };
const requests = { direct: 0, browser: 0, limited: [] };
const observeRequests = (page) => page.on('response', (response) => {
  if (!response.url().includes('/api/')) return;
  requests.browser++;
  if (response.status() === 429) requests.limited.push(new URL(response.url()).pathname);
});
const api = async (who, method, path, body) => {
  requests.direct++;
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
  for (const page of [ana, beto, caio]) observeRequests(page);
  for (const page of [ana, beto]) await page.addInitScript(() => localStorage.setItem('shareroom:microfone', JSON.stringify({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, gain: 1 })));
  await login(ana, a); await login(caio, c);
  await beto.addInitScript((token) => localStorage.setItem('shareroom:conta', token), b.token);
  for (const page of [ana,beto,caio]) { await page.goto(`${BASE_URL}/#/grupos/${g1}`); await page.getByTestId('chat').waitFor(); }
}, { timeout: 60_000 });

after(async () => {
  evidence.requests = requests;
  writeFileSync(resolve(output, 'validation.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser?.close(); await stack?.stop();
  if (folder && resolve(folder).startsWith(resolve(tmpdir(), 'cosmic-collections-'))) rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

test('Coleções: capas, prévia com nick próprio e compra real de pacote e item avulso', async () => {
  await settings(ana, 'loja'); await ana.getByTestId('shop-collections').click();
  assert.equal(await ana.getByTestId('collection-card').count(), COLLECTIONS.length);
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

test('todos os efeitos de coleção no administrador, com o cargo preservado', async () => {
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
  evidence.checks.push(`Todos os ${COLLECTIONS.length} efeitos na conta de administrador`);
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
  // Separate the bulk shop/profile phase from asset and voice checks. Production
  // rate limits stay enabled; all accounts and purchases remain in the same DB.
  await stack.stop();
  stack = await startStack({ COSMIC_DEV_POINTS: '1', DATABASE_URL: '', PGLITE_DIR: resolve(folder, 'db') });
  for (const page of [ana,beto]) { await page.reload(); await page.getByTestId('chat').waitFor(); }
  for (const width of [1440, 1100, 900, 390]) {
    await ana.setViewportSize({ width, height: 1000 });
    const narrow = width < 1024;
    if (narrow) {
      const button = ana.getByRole('button', { name: 'Membros', exact: true });
      await ana.getByTestId('back-to-channels').waitFor({state: 'attached'});
      if (!await button.isVisible()) await ana.getByTestId('channel').and(ana.locator('[data-name="geral"]')).click();
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
  let transientFailure = false;
  const failOnce = async route => {
    if (transientFailure || !route.request().url().includes(b.user.id)) return route.continue();
    transientFailure = true;
    await route.fulfill({status:503, contentType:'application/json', body:'{}'});
  };
  await ana.route('**/api/cosmetics?*', failOnce);
  await ana.reload(); await ana.getByTestId('chat').waitFor();
  assert.equal(await row(ana, b.user.username).locator('[data-name-effect] img').evaluate((el) => getComputedStyle(el).animationName), 'none');
  assert(transientFailure, 'a consulta de equipamentos foi repetida após uma falha transitória');
  await ana.unroute('**/api/cosmetics?*', failOnce);
  await settings(ana, 'efeitos-nome'); await ana.getByRole('switch', { name: 'Animar efeitos de nome', exact: true }).click(); await closeSettings(ana);
  await ana.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await row(ana, b.user.username).locator('[data-name-effect] img').evaluate((el) => getComputedStyle(el).animationName), 'none');
  await ana.emulateMedia({ reducedMotion: 'no-preference' });
  evidence.checks.push('Redimensionamento; desligar movimento persistido; prefers-reduced-motion');
});

test('artes e máscara do Kayden carregam no navegador e no protocolo do desktop', { timeout: 60_000 }, async () => {
  // This check can also run alone, without relying on the earlier gift test.
  const current = await api(c, 'GET', '/api/me/inventory');
  if (!current.items.some((item) => item.id === 'madu-kaiden-efeito-nome')) {
    await api(c, 'POST', '/api/dev/points', { amount: 500 });
    await api(c, 'POST', '/api/shop/buy', { itemId: 'madu-kaiden-efeito-nome', expectedPrice: 250 });
  }
  await equip(c, 'efeito-nome', 'madu-kaiden-efeito-nome');
  const assets = [...new Set(COLLECTIONS.flatMap((collection) => [
    ...['cover.webp','avatar-decoration.png','profile-frame.png','profile-banner.webp','username-effect.png','member-name-effect.webp','server-badge.png','nameplate.webp'].map((file) => `assets/cosmetics/${collection.id}/${file}`),
    ...collection.banners.map((banner) => banner.asset), ...collection.references.map((reference) => reference.asset),
  ]))];
  assets.push(...new Set(CATALOG.flatMap(({ presentation: p }) => [p?.avatar?.mask, p?.backdropMask, p?.frameMask, p?.effectMask].filter(Boolean))));
  const loadAssets = async (page) => page.evaluate(async (paths) => Promise.all(paths.map((path) => new Promise((done) => { const image = new Image(); image.onload = () => done({ path, width: image.naturalWidth }); image.onerror = () => done({ path, width: 0 }); image.src = new URL(path, location.href).href; }))), assets);
  const web = await loadAssets(ana); assert(web.every((asset) => asset.width > 0)); evidence.loadedImages.web = web.length;
  const restore = useLocalDesktopConfig();
  const userData = resolve(folder, 'electron');
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  let app;
  try {
    app = await electron.launch({ executablePath: resolve(root, 'desktop/node_modules/electron/dist/electron.exe'), args: [resolve(root, 'desktop')], env: { ...env, SHAREROOM_E2E: '1', SHAREROOM_USER_DATA: userData, SHAREROOM_API_URL: BASE_URL, SHAREROOM_SITE_URL: 'https://exemplo.github.io/shareroom/' } });
    const page = await app.firstWindow();
    observeRequests(page);
    await page.getByTestId('auth-username').fill(c.user.username); await page.getByTestId('auth-password').fill(password); await page.getByTestId('auth-submit').click();
    await page.getByTestId('account-settings-open').waitFor();
    const desktop = await loadAssets(page); assert(desktop.every((asset) => asset.width > 0)); evidence.loadedImages.desktop = desktop.length;
    await settings(page, 'efeitos-nome'); await page.getByTestId('unequip-madu-kaiden-efeito-nome').waitFor();
    await screenshot(page, 'desktop-name-effects');
    await settings(page, 'loja'); await page.getByTestId('shop-collections').click();
    await page.getByTestId('preview-hinata').click();
    const fx = page.getByTestId('collection-preview').locator('[data-fx-surface="avatar"]');
    await fx.scrollIntoViewIfNeeded();
    await fx.locator('[data-motif=lily]').waitFor();
    const sample = async () => {
      await app.evaluate(({app}) => app.getAppMetrics());
      const frames = await page.evaluate(() => new Promise(resolve => {
        const deltas = []; let last;
        function frame(now) {
          if (last) deltas.push(now - last);
          last = now;
          if (deltas.length < 90) requestAnimationFrame(frame);
          else resolve(deltas.sort((a,b) => a-b));
        }
        requestAnimationFrame(frame);
      }));
      const metrics = await app.evaluate(({app}) => app.getAppMetrics().map(p => ({ type: p.type, cpu: p.cpu.percentCPUUsage, workingSetMiB: p.memory.workingSetSize / 1024 })));
      let systemGpu = null;
      try { systemGpu = execFileSync('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used','--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim(); } catch { /* Optional hardware counter. */ }
      return { frameP95Ms: frames[Math.floor(frames.length * .95)], processes: metrics, systemGpu };
    };
    evidence.frameMotion = { animated: await sample() };
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await waitFor(async () => await fx.getAttribute('data-fx-level') === '0', 'redução de movimento');
    assert.equal(await fx.locator('svg').count(), 0);
    evidence.frameMotion.static = await sample();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await fx.locator('[data-motif=lily]').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await waitFor(async () => await fx.getAttribute('data-fx-level') === '0', 'efeitos pausados ao minimizar o desktop');
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.show(); });
    await fx.locator('[data-motif=lily]').waitFor();
    await screenshot(page, 'desktop-hinata-animated');
  } finally { await app?.close(); restore(); }
  evidence.checks.push(`${assets.length} imagens carregadas no navegador e no Electron`);
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
  await equip(b, 'efeito-nome', 'madu-kaiden-efeito-nome');
  await ana.goto(`${BASE_URL}/#/grupos/${g1}`); await ana.getByTestId('chat').waitFor();
  await beto.goto(`${BASE_URL}/#/grupos/${g1}`);
  try { await beto.getByTestId('chat').waitFor({ timeout: 10_000 }); }
  catch (error) {
    writeFileSync(resolve(output, 'voice-navigation-failure.txt'), (await beto.locator('body').innerText()) + '\n' + JSON.stringify(requests, null, 2));
    throw error;
  }
  for (const page of [ana, beto]) {
    await page.getByTestId('channel').filter({ hasText: /^Sala de voz$/ }).click();
    await waitFor(async () => (await page.getByTestId('connection').getAttribute('data-phase')) === 'connected', 'conexão LiveKit real');
  }
  const participant = ana.getByTestId('participants').getByTestId('participant').and(ana.locator(`[data-identity="${b.user.id}"]`));
  const ribbon = participant.locator('[data-name-effect="madu-kaiden-efeito-nome"]');
  const memberAction = participant.getByTestId('voice-person-menu');
  await ribbon.waitFor();
  const remoteCard = ana.getByTestId('call-card').and(ana.locator(`[data-identity="${b.user.id}"]`));
  await remoteCard.waitFor();
  await ana.getByTestId('voice-member').and(ana.locator('[data-user="' + b.user.username + '"]')).locator('[data-name-effect="madu-kaiden-efeito-nome"]').waitFor();
  const neutralShadow = await remoteCard.evaluate(card => getComputedStyle(card).boxShadow);
  await beto.getByTestId('dock-mic').click();
  await remoteCard.getByRole('img', {name: 'Beto Estelar está falando'}).waitFor();
  assert.equal(await remoteCard.evaluate(card => getComputedStyle(card).boxShadow), neutralShadow);
  await beto.getByTestId('dock-mic').click();
  await remoteCard.getByTestId('call-card-mic-off').waitFor();
  assert.equal(await remoteCard.locator('[data-decoration]').count(), 0);
  await equip(b, 'decoracao', 'hinata-decoracao');
  const flower = remoteCard.locator('[data-decoration="hinata-decoracao"]');
  await flower.evaluate(img => img.decode());
  const flowers = remoteCard.locator('[data-theme-id=hinata]');
  await flowers.locator('[data-motif=lily]').waitFor();
  for (const page of [ana, beto]) await page.getByTestId('dock-mic').click();
  try {
    await waitFor(async () => await ana.locator('[data-testid=call-card][data-speaking=true] [data-fx-speaking=true] .cn-fx-aura').count() === 2, 'duas molduras reagem simultaneamente à voz do LiveKit', 20_000);
    await ana.emulateMedia({reducedMotion: 'reduce'});
    await remoteCard.getByRole('img', {name: 'Beto Estelar está falando'}).waitFor();
    assert.equal(await remoteCard.evaluate(card => getComputedStyle(card).boxShadow), neutralShadow);
    await waitFor(() => flower.evaluate(img => getComputedStyle(img).filter === 'brightness(1.18)'), 'brilho estático da arte');
    await ana.emulateMedia({reducedMotion: 'no-preference'});
  } finally { for (const page of [ana, beto]) await page.getByTestId('dock-mic').click(); }
  await waitFor(async () => await ana.locator('[data-testid=call-card] [data-fx-speaking]').count() === 0, 'reação encerra ao silenciar');
  assert.match(await flower.evaluate(img => getComputedStyle(img).maskImage), /hinata-avatar/);
  const remoteName = remoteCard.getByTestId('call-card-name').locator('[data-name-style]');
  await waitFor(() => remoteName.evaluate(el => el.dataset.nameStyle === 'hinata-decoracao' && getComputedStyle(el).backgroundImage.includes('linear-gradient')), 'gradiente floral na call');
  await equip(b,'cor-nome','neon-cor-nome');
  await waitFor(() => remoteName.evaluate(el => getComputedStyle(el).color === 'rgb(84, 234, 255)'), 'troca ao vivo para cor sólida na call');
  assert.equal(await ana.getByTestId('call-card').locator('[data-decoration="neon-decoracao"]').count(), 1);
  await remoteCard.screenshot({path:resolve(output,'hinata-call-wide.png'),animations:'disabled'});
  await ana.setViewportSize({width:1100,height:720});
  await waitFor(() => remoteCard.evaluate(card => {
    const art = card.querySelector('[data-decoration]').getBoundingClientRect();
    const name = card.querySelector('[data-testid="call-card-name"]').getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const avatar = card.querySelector('[data-avatar]').getBoundingClientRect();
    const centered = Math.abs(avatar.x + avatar.width/2 - box.x - box.width/2) < 1
      && Math.abs(avatar.y + avatar.height/2 - box.y - box.height/2) < 1;
    return centered && art.y >= box.y && art.bottom <= name.top && art.x >= box.x && art.right <= box.right;
  }), 'decoração cabe no cartão e acima do nome');
  await remoteCard.screenshot({path:resolve(output,'hinata-call.png'),animations:'disabled'});
  await ana.setViewportSize({width:1440,height:1000});
  await equip(b,'decoracao',null); await equip(b,'cor-nome',null);
  const basicFrame = CATALOG.find(item => item.id === 'moldura-neon');
  await api(b, 'POST', '/api/shop/buy', {itemId: basicFrame.id, expectedPrice: basicFrame.price});
  await api(b, 'PUT', '/api/me/equipped', {slot:'moldura', itemId:basicFrame.id, variant:basicFrame.variants[0].id});
  await remoteCard.locator('[data-frame="moldura-neon"]').waitFor();
  await beto.getByTestId('dock-mic').click();
  await remoteCard.getByRole('img', {name:'Beto Estelar está falando'}).waitFor();
  assert.equal(await remoteCard.evaluate(card => getComputedStyle(card).boxShadow), neutralShadow);
  await beto.getByTestId('dock-mic').click();
  await equip(b,'moldura',null);
  const ribbonBox = await ribbon.boundingBox();
  const buttonBox = await memberAction.boundingBox();
  const participantBox = await participant.boundingBox();
  assert(ribbonBox && buttonBox && participantBox && ribbonBox.height <= participantBox.height, 'a faixa não aumenta a linha nem desloca o controle de voz');
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

test('artes grandes, galeria, pesquisa e filtros funcionam em computador e celular', { timeout: 60_000 }, async () => {
  await beto.setViewportSize({ width: 1440, height: 1000 });
  await settings(beto, 'loja'); await beto.getByTestId('shop-collections').click();
  await screenshot(beto, 'refreshed-collections-shop');
  for (const collection of COLLECTIONS.filter((entry) => entry.frameAspect)) {
    await beto.getByTestId(`preview-${collection.id}`).click();
    const modal = beto.getByRole('dialog', { name: collection.name, exact: true });
    const preview = modal.getByTestId('collection-preview');
    await waitFor(() => preview.locator('img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), 'artes grandes carregadas');
    const frame = preview.locator('[data-profile-frame]');
    const geometry = await frame.boundingBox();
    assert(Math.abs(geometry.width / geometry.height - collection.frameAspect) < .01, 'proporção da moldura original');
    await preview.screenshot({ path: resolve(output, `refreshed-preview-${collection.id}.png`), animations: 'disabled' });
    evidence.screenshots.push(`refreshed-preview-${collection.id}.png`);
    await modal.getByRole('tab', { name: 'Artes originais', exact: true }).click();
    assert.equal(await modal.locator('.cn-original-thumbnails button').count(), collection.references.length);
    await modal.locator('.cn-original-thumbnails button').first().click();
    await waitFor(() => modal.locator('.cn-original-artwork > img').evaluate((image) => image.complete && image.naturalWidth > 0), 'folha original carregada');
    if (collection.id === 'clove') await screenshot(beto, 'refreshed-original-clove');
    await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
  }
  await beto.getByRole('button', { name: 'Anime', exact: true }).click();
  await beto.locator('[data-collection="hinata"]').waitFor();
  await beto.getByRole('button', { name: 'Valorant', exact: true }).click();
  assert.equal(await beto.getByTestId('collection-card').count(), 6);
  await beto.getByRole('button', { name: 'Todas', exact: true }).click();
  await beto.getByRole('textbox', { name: 'Buscar coleção', exact: true }).fill('furia');
  assert.equal(await beto.getByTestId('collection-card').count(), 2);
  await beto.getByRole('textbox', { name: 'Buscar coleção', exact: true }).fill('nao-existe');
  assert.match(await beto.locator('.cn-collection-empty').textContent(), /Nenhuma coleção/);
  await beto.getByRole('textbox', { name: 'Buscar coleção', exact: true }).fill('');
  await beto.setViewportSize({ width: 390, height: 844 });
  await screenshot(beto, 'refreshed-mobile-shop');
  await beto.getByTestId('preview-clove').click();
  const mobile = beto.getByRole('dialog', { name: 'Clove', exact: true });
  assert.equal(await mobile.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  await screenshot(beto, 'refreshed-mobile-preview');
  await mobile.getByRole('button', { name: 'Fechar', exact: true }).click();
  await closeSettings(beto); await beto.setViewportSize({ width: 1440, height: 1000 });
  evidence.checks.push('Seis painéis na proporção original; galeria; filtro e busca sem acentos; loja e prévia a 390px');
});

test('perfil compacto mantém nome, avatar, banner e datas alinhados em diferentes temas e larguras', async () => {
  await settings(ana, 'aparencia');
  await ana.getByTestId('theme-claro').click();
  await settings(ana, 'acessibilidade');
  await ana.getByTestId('motion-reduzir').click();
  await closeSettings(ana);
  await row(ana, b.user.username).click();
  const profile = ana.getByTestId('profile-card');
  const name = profile.getByTestId('profile-name').locator('span');
  await name.waitFor();
  assert.equal(await profile.locator('[data-decoration]').count(), 0);
  assert.equal(await name.textContent(), 'Beto Estelar');
  assert.equal(await name.evaluate((node) => getComputedStyle(node).backgroundImage), 'none');
  assert.equal(await profile.getByTestId('profile-avatar').locator('[data-avatar-status="online"]').count(), 1);
  assert(!(await profile.textContent()).includes(`@${b.user.username}`));
  assert.match(await profile.textContent(), /Conta desde.*No grupo desde/s);
  const banner = await profile.getByTestId('profile-banner').boundingBox();
  const avatar = await profile.getByTestId('profile-avatar').boundingBox();
  assert(avatar.y < banner.y + banner.height && avatar.y + avatar.height > banner.y + banner.height);
  assert(Math.abs(avatar.x + avatar.width / 2 - (banner.x + banner.width / 2)) < 1);

  await equip(b, 'decoracao', 'neon-decoracao');
  await waitFor(() => name.evaluate((node) => getComputedStyle(node).color === 'rgb(84, 234, 255)'), 'nome herda a cor sólida do avatar');
  await equip(b, 'cor-nome', 'barou-cor-nome');
  await waitFor(() => name.evaluate((node) => getComputedStyle(node).backgroundClip === 'text'), 'gradiente do nome tem prioridade');
  await ana.setViewportSize({ width: 390, height: 540 });
  assert.equal(await ana.locator('html').getAttribute('data-motion'), 'reduzida');
  assert.equal(await ana.locator('html').getAttribute('data-theme'), 'claro');
  await waitFor(() => profile.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.x >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight && node.scrollWidth <= node.clientWidth + 1;
  }), 'perfil cabe na janela sem rolagem horizontal');
  await profile.screenshot({ path: resolve(output, 'profile-narrow-light.png'), animations: 'disabled' });
  await ana.keyboard.press('Escape');
  await ana.setViewportSize({ width: 1440, height: 1000 });
  await settings(ana, 'aparencia');
  await ana.getByTestId('theme-cosmic').click();
  await settings(ana, 'acessibilidade');
  await ana.getByTestId('motion-sistema').click();
  await closeSettings(ana);
  evidence.checks.push('Avatar sem decoração, status, cor sólida da decoração, gradiente equipado, tema claro e perfil a 390px sem rolagem lateral');
});

test('cada coleção anima as duas superfícies e respeita a intensidade selecionada', { timeout: 120_000 }, async () => {
  for (const value of ['baixo','alto','desativado','medio']) {
    await settings(beto, 'acessibilidade'); await beto.getByTestId('frame-intensity-' + value).click();
    assert.equal(await beto.locator('html').getAttribute('data-frame-intensity'), value);
    await settings(beto, 'loja'); await beto.getByTestId('shop-collections').click();
    for (const collection of value === 'medio' ? COLLECTIONS : COLLECTIONS.slice(0,1)) {
      await beto.getByTestId('preview-' + collection.id).click();
      const detail = beto.getByTestId('collection-preview');
      for (const surface of ['avatar','frame']) {
        const fx = detail.locator('[data-fx-surface="' + surface + '"][data-theme-id="' + collection.id + '"]');
        await fx.locator('..').scrollIntoViewIfNeeded();
        if (value === 'desativado') {
          assert.equal(await fx.getAttribute('data-fx-level'), '0');
          assert.equal(await fx.locator('svg').count(), 0);
        } else {
          await fx.locator('.cn-fx-motif').first().waitFor();
          const count = await fx.locator('.cn-fx-motif').count();
          assert(count >= 1 && count <= ({ baixo: 2, medio: 4, alto: 5 })[value]);
        }
      }
      await beto.getByRole('dialog', {name: collection.name, exact:true}).getByRole('button', {name:'Fechar',exact:true}).click();
    }
  }
  await closeSettings(beto);
});

test('Kayden mantém a foto visível, sincroniza as cinco peças e persiste após recarregar', { timeout: 60_000 }, async () => {
  await settings(beto, 'perfil');
  await beto.getByTestId('profile-avatar-file').setInputFiles(pngFile('avatar-cosmeticos.png', 256, 256, [40, 161, 139, 255]));
  await beto.getByTestId('profile-upload-preview').waitFor();
  await beto.getByTestId('profile-upload-confirm').click();
  await beto.getByTestId('profile-upload-preview').waitFor({ state: 'detached' });
  await beto.getByTestId('profile-preview').locator('[data-avatar="foto"] img').evaluate((img) => img.decode());
  await settings(beto, 'loja'); await beto.getByTestId('shop-collections').click();
  await beto.getByTestId('preview-madu-kaiden').click();
  await waitFor(async () => (await beto.getByTestId('collection-preview').getByTestId('profile-banner').getAttribute('style')).includes('madu-kaiden'), 'arte definitiva na prévia');
  await beto.getByTestId('equip-collection').click();
  await beto.getByTestId('unequip-madu-kaiden-fundo').waitFor();
  await waitFor(async () => !(await beto.getByTestId('equip-collection').isDisabled()), 'cinco peças equipadas');
  const saved = await api(b, 'GET', '/api/me/inventory');
  assert.equal(Object.values(saved.equipped).filter((entry) => entry.item.startsWith('madu-kaiden-')).length, 5);
  assert.equal(saved.equipped.fundo.variant, 'original');
  await beto.getByRole('dialog', { name: 'Kayden', exact: true }).getByRole('button', { name: 'Fechar', exact: true }).click();
  await closeSettings(beto);
  await row(ana, b.user.username).locator('[data-name-effect="madu-kaiden-efeito-nome"]').waitFor();
  await row(ana, b.user.username).click();
  const profile = ana.getByTestId('profile-card');
  try { await profile.locator('[data-profile-frame="madu-kaiden-moldura"]').waitFor({timeout:10_000}); }
  catch (error) { await screenshot(ana, 'definitive-profile-failure'); writeFileSync(resolve(output,'definitive-profile-failure.txt'),await ana.locator('body').innerText()); throw error; }
  assert.equal(await profile.locator('img[src*="username-effect"]').count(), 0, 'amostra do nome não é exibida');
  const banner = profile.getByTestId('profile-banner');
  await waitFor(async () => (await banner.getAttribute('style')).includes('madu-kaiden'), 'fundo definitivo no perfil da outra conta');
  const bannerBox = await banner.boundingBox();
  const frameBox = await profile.locator('[data-profile-frame="madu-kaiden-moldura"]').boundingBox();
  assert(frameBox.y >= bannerBox.y + bannerBox.height, 'moldura do nome não deve cobrir o banner');
  const portrait = profile.locator('[data-decorated="madu-kaiden-decoracao"]');
  const overlay = portrait.locator('[data-decoration="madu-kaiden-decoracao"]');
  await portrait.locator('[data-avatar="foto"] img').evaluate((img) => img.decode());
  await overlay.evaluate(async (element) => {
    await element.decode();
    const maskUrl = getComputedStyle(element).maskImage.match(/^url\("([^"]+)"\)/)?.[1];
    if (!maskUrl) throw new Error('A decoração do Kayden está sem máscara.');
    const mask = new Image();
    mask.src = maskUrl;
    await mask.decode();
  });
  const bounds = await portrait.boundingBox();
  assert(bounds);
  const center = { x: Math.round(bounds.x + bounds.width / 4), y: Math.round(bounds.y + bounds.height / 4), width: Math.floor(bounds.width / 2), height: Math.floor(bounds.height / 2) };
  const centerWithDecoration = await ana.screenshot({ clip: center, animations: 'disabled' });
  const decorated = await portrait.screenshot({ animations: 'disabled' });
  await overlay.evaluate((element) => { element.style.visibility = 'hidden'; });
  try {
    assert.deepEqual(await ana.screenshot({ clip: center, animations: 'disabled' }), centerWithDecoration, 'a borda deve deixar a foto do usuário visível no centro');
    assert.notDeepEqual(await portrait.screenshot({ animations: 'disabled' }), decorated, 'a decoração deve continuar visível nas bordas');
  } finally {
    await overlay.evaluate((element) => { element.style.removeProperty('visibility'); });
  }
  await profile.screenshot({ path: resolve(output, 'kayden-avatar-adjusted.png'), animations: 'disabled' });
  await ana.keyboard.press('Escape');
  await beto.reload(); await beto.getByTestId('chat').waitFor();
  await settings(beto, 'loja'); await beto.getByTestId('shop-collections').click(); await beto.getByTestId('preview-madu-kaiden').click();
  await beto.getByTestId('unequip-madu-kaiden-fundo').waitFor();
  await beto.getByRole('dialog', { name: 'Kayden', exact: true }).getByRole('button', { name: 'Fechar', exact: true }).click();
  await closeSettings(beto);
  evidence.checks.push('Cinco peças do Kayden pela interface; foto enviada intacta sob a máscara; outra conta e equipamento persistente');
});
