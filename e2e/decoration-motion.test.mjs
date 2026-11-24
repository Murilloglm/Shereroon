import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { CATALOG, COLLECTIONS } from '../shared/cosmetics.ts';
import { BASE_URL, launchChrome, root, startStack } from './harness.mjs';
import { pngFile } from './images.mjs';

const output = resolve(root, 'e2e/.artifacts/decoration-motion');
const decorations = CATALOG.filter((item) => item.kind === 'decoracao');
let vite, browser, page, address, stack;
const evidence = { count: decorations.length, rendered: [], checks: [] };
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Decorações em movimento</title>
<style>
body{margin:0;background:#080a16;color:#eef0fb;font:14px 'Segoe UI',sans-serif}h1{font-size:24px;margin:24px 32px 4px}p{margin:0 32px 16px;color:#a7afcc}
#gallery{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;padding:16px 32px}article{background:#121629;border:1px solid #293052;border-radius:16px;text-align:center;min-width:0}
article h2{font-size:13px;margin:14px 4px 0}.scene{height:168px;display:flex;align-items:center;justify-content:center;overflow:hidden}.sizes{display:flex;align-items:center;justify-content:space-evenly;height:86px}
body.light{background:#edf0fa;color:#172039}body.light article{background:#fff}
@media(max-width:700px){#gallery{grid-template-columns:repeat(2,minmax(0,1fr));padding:12px;gap:8px}}
</style></head><body><h1>Decorações · Cosmic Night</h1><p>Arte original em movimento · perfil, chamada e listas</p><main id="root"></main>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DecoratedAvatar } from '/src/components/cosmetics/Decoration.tsx';
import { CATALOG, COLLECTIONS } from '/@fs/${root.replaceAll('\\', '/')}/shared/cosmetics.ts';
import { setAppearance } from '/src/lib/appearance.ts';
import '/src/index.css';
window.motionPrefs=setAppearance;
const h=React.createElement;
const avatar=(item,size,animate)=>h(DecoratedAvatar,{userId:'preview',name:'Cosmic Night',size,image:null,animate,preview:{decoracao:{item:item.id,variant:item.variants[0].id}}});
createRoot(document.getElementById('root')).render(h('div',{id:'gallery'},CATALOG.filter(x=>x.kind==='decoracao').map(item=>h('article',{'data-item':item.id,key:item.id},
  h('h2',null,item.name.split(' · ')[0]),h('div',{className:'scene','data-scene':item.id},avatar(item,80)),
  h('div',{className:'sizes'},avatar(item,40),avatar(item,22),avatar(item,40,false))))));
</script></body></html>`;

before(async () => {
  mkdirSync(output, { recursive: true });
  vite = await createServer({ root: resolve(root, 'web'), configFile: resolve(root, 'web/vite.config.ts'),
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
    plugins: [{ name: 'decoration-motion-fixture', configureServer(server) {
      server.middlewares.use('/__decoration-motion', async (_req, res, next) => {
        try {
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(await server.transformIndexHtml('/__decoration-motion', html));
        } catch (error) { next(error); }
      });
    } }] });
  await vite.listen();
  address = `http://127.0.0.1:${vite.httpServer.address().port}/__decoration-motion`;
  browser = await launchChrome();
  page = await browser.newPage({ viewport: { width: 1536, height: 1350 }, reducedMotion: 'no-preference' });
  page.on('pageerror', (error) => { evidence.errors ??= []; evidence.errors.push(error.message); });
  await page.goto(address);
  await page.waitForSelector('[data-artwork-theme="clove"]');
  await page.evaluate(async () => {
    const urls = [...document.querySelectorAll('svg image')].map((image) => image.getAttribute('href'));
    await Promise.all([...new Set(urls)].map((url) => new Promise((done, reject) => {
      const image = new Image(); image.onload = done; image.onerror = () => reject(new Error(url)); image.src = url;
    })));
    await document.fonts.ready;
  });
}, { timeout: 60_000 });

after(async () => {
  writeFileSync(resolve(output, 'validation.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser?.close(); await vite?.close(); await stack?.stop();
});

const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
const seek = async (time) => {
  await page.evaluate((ms) => {
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = ms; }
  }, time);
  await settle();
};

test('todas as decorações produzem quadros diferentes e preservam as artes originais', async () => {
  assert(decorations.every((item) => item.animated));
  assert.equal(await page.locator('[data-scene]').count(), decorations.length);
  const originals = await page.locator('[data-artwork-theme] image[id]').evaluateAll((images) => images.map((image) => image.getAttribute('href')));
  assert(originals.every((url) => url.includes('/assets/cosmetics/') && url.endsWith('/avatar-decoration.png')));
  for (const item of decorations) {
    const scene = page.locator(`[data-scene="${item.id}"]`);
    await seek(300); const first = await scene.screenshot();
    await seek(1150); const second = await scene.screenshot();
    assert(!first.equals(second), `${item.id}: a arte precisa mudar de verdade entre os quadros`);
    evidence.rendered.push(item.id);
  }
  await seek(300);
  await page.screenshot({ path: resolve(output, 'all-decorations.png'), fullPage: true });
  await page.locator('#gallery').evaluate((element) => { element.style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))'; });
  await page.locator('article').evaluateAll((cards) => cards.forEach((card) => {
    if (!['night-fury-decoracao', 'madu-kaiden-decoracao', 'rimuru-decoracao', 'clove-decoracao', 'jett-decoracao'].includes(card.dataset.item)) card.style.display = 'none';
  }));
  await page.locator('#gallery').screenshot({ path: resolve(output, 'requested-effects.png') });
  await page.locator('.scene').evaluateAll((scenes) => scenes.forEach((scene) => { scene.style.height = '300px'; scene.firstElementChild.style.transform = 'scale(1.8)'; }));
  await page.locator('#gallery').screenshot({ path: resolve(output, 'requested-effects-large.png') });
  await page.locator('.scene').evaluateAll((scenes) => scenes.forEach((scene) => { scene.style.height = ''; scene.firstElementChild.style.transform = ''; }));
  await page.locator('article').evaluateAll((cards) => cards.forEach((card) => { card.style.display = ''; }));
  await page.locator('#gallery').evaluate((element) => { element.style.gridTemplateColumns = ''; });
  assert.deepEqual(evidence.errors ?? [], []);
  evidence.checks.push('Quadros renderizados diferentes para todas as decorações; PNGs originais referenciados');
}, { timeout: 60_000 });

test('preferências desligam e restauram movimento na hora, inclusive nas listas', async () => {
  await page.evaluate(() => window.motionPrefs({ motion: 'normal', cosmeticAnimations: false }));
  await settle();
  assert.equal(await page.locator('.cn-deco').evaluateAll((elements) => elements.flatMap((element) => element.getAnimations({ subtree: true })).length), 0);
  await page.evaluate(() => window.motionPrefs({ cosmeticAnimations: true, motion: 'reduzir' }));
  await settle();
  assert.equal(await page.locator('.cn-deco').evaluateAll((elements) => elements.flatMap((element) => element.getAnimations({ subtree: true })).length), 0);
  await page.evaluate(() => window.motionPrefs({ motion: 'normal' })); await settle();
  for (const item of decorations) {
    const small = page.locator(`[data-item="${item.id}"] .sizes [data-decoration]`).first();
    assert(await small.evaluate((element) => element.getAnimations({ subtree: true }).length > 0), item.id);
    const still = page.locator(`[data-item="${item.id}"] .sizes [data-decoration]`).last();
    assert.equal(await still.evaluate((element) => element.getAnimations({ subtree: true }).length), 0);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.motionPrefs({ motion: 'sistema' })); await settle();
  assert.equal(await page.locator('.cn-deco').evaluateAll((elements) => elements.flatMap((element) => element.getAnimations({ subtree: true })).length), 0);
  await page.evaluate(() => window.motionPrefs({ motion: 'normal' })); await settle();
  assert(await page.locator('[data-scene="jett-decoracao"] .cn-art-orbit').evaluate((element) => parseFloat(getComputedStyle(element).animationDuration) > 1));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  evidence.checks.push('Preferências do aplicativo, sistema, restauração imediata e animate=false respeitados em todos os tamanhos');
});

test('o centro da foto permanece visível em todas as decorações', async () => {
  await seek(850);
  for (const item of decorations) {
    const scene = page.locator(`[data-scene="${item.id}"]`);
    const avatar = scene.locator('[data-avatar]');
    const withArt = await avatar.screenshot();
    await scene.locator('[data-decoration]').evaluate((element) => { element.style.visibility = 'hidden'; });
    const withoutArt = await avatar.screenshot();
    await scene.locator('[data-decoration]').evaluate((element) => { element.style.visibility = ''; });
    const changed = await page.evaluate(async ([a, b]) => {
      const decode = async (data) => {
        const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [first, second] = await Promise.all([decode(a), decode(b)]);
      let changed = 0; const cx = first.width / 2, cy = first.height / 2, radius = first.width * .3;
      for (let y = 0; y < first.height; y++) for (let x = 0; x < first.width; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
        const index = (y * first.width + x) * 4;
        if ([0, 1, 2].some((channel) => Math.abs(first.data[index + channel] - second.data[index + channel]) > 2)) changed++;
      }
      return changed;
    }, [withArt.toString('base64'), withoutArt.toString('base64')]);
    assert.equal(changed, 0, `${item.id}: não deve cobrir o centro da foto`);
  }
  evidence.checks.push('Comparação de pixels confirma o centro do avatar livre nas decorações do catálogo');
}, { timeout: 60_000 });

test('decorações fora da área visível pausam e retomam sem bloquear cliques', async () => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => [...document.querySelectorAll('.cn-deco')].some((element) => element.dataset.motionVisible === 'false'));
  const last = page.locator('[data-scene]').last().locator('[data-decoration]');
  await page.waitForFunction(() => document.querySelector('[data-scene="hinata-decoracao"] [data-decoration]').dataset.motionVisible === 'false');
  assert.equal(await last.locator('.cn-art-orbit').evaluate((element) => getComputedStyle(element).animationPlayState), 'paused');
  await last.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('[data-scene="hinata-decoracao"] [data-decoration]').dataset.motionVisible === 'true');
  assert.equal(await last.locator('.cn-art-orbit').evaluate((element) => getComputedStyle(element).animationPlayState), 'running');
  assert(await page.locator('.cn-deco').evaluateAll((elements) => elements.every((element) => getComputedStyle(element).pointerEvents === 'none')));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve(output, 'mobile-decorations.png'), fullPage: true });
  await page.setViewportSize({ width: 1536, height: 1350 }); await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => document.body.classList.add('light')); await seek(750);
  await page.screenshot({ path: resolve(output, 'light-background.png'), fullPage: true });
  evidence.checks.push('Pausa fora da tela, retomada ao rolar, cliques livres e encaixe a 390px');
});

test('trocas reais aparecem para outra conta nas listas, no perfil e na loja', async () => {
  stack = await startStack({ COSMIC_DEV_POINTS: '1', DATABASE_URL: '' });
  const api = async (who, method, path, body) => {
    const response = await fetch(BASE_URL + path, { method, headers: {
      'content-type': 'application/json', ...(who ? { authorization: `Bearer ${who.token}` } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json(); assert.equal(response.status, 200, `${path}: ${JSON.stringify(json)}`); return json;
  };
  const owner = await api(null, 'POST', '/api/auth/register', { username: 'motionowner', displayName: 'Decorações animadas', password: 'test-password-123' });
  const buyer = await api(null, 'POST', '/api/auth/register', { username: 'motionbuyer', displayName: 'Coleções animadas', password: 'test-password-123' });
  const viewer = await api(null, 'POST', '/api/auth/register', { username: 'motionviewer', displayName: 'Observador', password: 'test-password-123' });
  await api(owner, 'POST', '/api/dev/points', { amount: 10_000 });
  await api(buyer, 'POST', '/api/dev/points', { amount: 10_000 });
  const group = (await api(owner, 'POST', '/api/groups', { name: 'Prévia das decorações' })).group.id;
  const { invite } = await api(owner, 'POST', `/api/groups/${group}/invites`, {});
  await api(buyer, 'POST', `/api/invites/${invite.code}/accept`);
  await api(viewer, 'POST', `/api/invites/${invite.code}/accept`);
  const photo = await fetch(`${BASE_URL}/api/me/media/avatar`, { method: 'POST', headers: { authorization: `Bearer ${buyer.token}` },
    body: readFileSync(pngFile('decoration-motion-avatar.png', 96, 96, [50, 150, 250, 255])) });
  assert.equal(photo.status, 200);
  const app = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await app.addInitScript((token) => localStorage.setItem('shareroom:conta', token), viewer.token);
    await app.goto(`${BASE_URL}/#/grupos/${group}`); await app.getByTestId('chat').waitFor();
    let row;
    // Distribui as compras entre duas contas reais, respeitando o limite de 20 compras/minuto.
    for (const [index, item] of decorations.entries()) {
      const who = index % 2 === (decorations.length - 1) % 2 ? buyer : owner;
      row = app.getByTestId('member').and(app.locator(`[data-user="${who.user.username}"]`));
      await api(who, 'POST', '/api/shop/buy', { itemId: item.id, expectedPrice: item.price });
      await api(who, 'PUT', '/api/me/equipped', { slot: 'decoracao', itemId: item.id, variant: item.variants[0].id });
      const art = row.locator(`[data-decoration="${item.id}"]`);
      await art.waitFor();
      assert(await art.evaluate((element) => element.getAnimations({ subtree: true }).length > 0), item.id);
    }
    await row.click();
    const profile = app.getByTestId('profile-card');
    await profile.locator('[data-decoration="hinata-decoracao"]').waitFor();
    assert.equal(await profile.locator('[data-avatar="foto"]').count(), 1);
    await app.evaluate(() => Promise.all(document.getAnimations().filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished.catch(() => undefined))));
    await app.screenshot({ path: resolve(output, 'in-app-profile.png') });
    await app.keyboard.press('Escape');
    await app.getByTestId('account-settings-open').click(); await app.getByTestId('settings-nav-loja').click();
    await app.getByTestId('shop-collections').click();
    assert.equal(await app.getByTestId('collection-card').count(), COLLECTIONS.length);
    await app.getByTestId('preview-clove').click();
    const modal = app.getByRole('dialog', { name: 'Clove', exact: true });
    const art = modal.getByTestId('collection-preview').locator('.cn-profile-avatar [data-decoration="clove-decoracao"]');
    await art.waitFor(); assert(await art.evaluate((element) => element.getAnimations({ subtree: true }).length > 0));
    await app.evaluate(() => Promise.all(document.getAnimations().filter((animation) => Number.isFinite(animation.effect.getTiming().iterations)).map((animation) => animation.finished.catch(() => undefined))));
    await app.screenshot({ path: resolve(output, 'in-app-collection.png') });
    await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
    await app.getByTestId('settings-nav-inventario').click();
    const toggle = app.getByRole('switch', { name: 'Animar decorações e efeitos de nome', exact: true });
    await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await app.getByTestId('settings-close').click();
    assert.equal(await row.locator('[data-decoration]').evaluate((element) => element.getAnimations({ subtree: true }).length), 0);
    await app.reload(); await app.getByTestId('chat').waitFor();
    await row.locator('[data-decoration="hinata-decoracao"]').waitFor();
    assert.equal(await row.locator('[data-decoration]').evaluate((element) => element.getAnimations({ subtree: true }).length), 0);
    evidence.checks.push('Compras e trocas reais sincronizadas com outra conta; foto, perfil, loja e preferência persistida após recarregar');
  } finally { await app.close(); }
}, { timeout: 90_000 });

test('prévia em vídeo registra o movimento contínuo das decorações', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 },
    recordVideo: { dir: output, size: { width: 1280, height: 1000 } }, reducedMotion: 'no-preference' });
  const preview = await context.newPage();
  const video = preview.video();
  try {
    await preview.goto(address); await preview.waitForSelector('[data-artwork-theme="clove"]');
    await preview.addStyleTag({ content: '.scene{height:132px}.sizes{height:52px}h1{margin-top:12px}article h2{font-size:12px}' });
    await preview.waitForTimeout(5000);
  } finally { await context.close(); }
  await video.saveAs(resolve(output, 'decorations-preview.webm'));
  evidence.checks.push('Vídeo do movimento contínuo, sem pausar ou avançar animações manualmente');
}, { timeout: 30_000 });
