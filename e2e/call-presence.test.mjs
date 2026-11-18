import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, sourcePageHtml, startStack, waitFor } from './harness.mjs';

let stack;
const browsers = [], pages = [];
const names = ['atlas', 'boreal', 'cometa', 'draco'];
const channel = (page, name = 'Sala de voz') => page.getByTestId('channel').filter({ hasText: new RegExp(`^${name}$`) });
const rows = (page, name = 'Sala de voz') => page.getByTestId('channel-item').filter({ has: channel(page, name) }).getByTestId('voice-member');
async function count(page, n, name) {
  await waitFor(async () => await rows(page, name).count() === n, `${n} participantes em ${name ?? 'Sala de voz'}`, 30_000);
  const ids = await rows(page, name).evaluateAll(elements => elements.map(e => e.dataset.user));
  assert.equal(new Set(ids).size, n, 'sem duplicatas');
}
before(async () => {
  stack = await startStack({ DATABASE_URL: '' });
  let invite;
  for (const [index, name] of names.entries()) {
    const browser = await launchChrome({ headless: true, fakeMic: true, ...(index === 0 ? { captureTitle: 'cosmic-presence-screen' } : {}) });
    browsers.push(browser);
    const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
    await context.addInitScript(() => localStorage.setItem('shareroom:microfone', JSON.stringify({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, gain: 1 })));
    await context.addInitScript(() => {
      window.__callTones = [];
      const createOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (...args) {
        const oscillator = createOscillator.apply(this, args);
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (...startArgs) => {
          if ([520, 780].includes(oscillator.frequency.value)) window.__callTones.push(oscillator.frequency.value);
          return start(...startArgs);
        };
        return oscillator;
      };
    });
    if (index === 0) await (await context.newPage()).setContent(sourcePageHtml('cosmic-presence-screen', 0));
    const page = await context.newPage(); page.setDefaultTimeout(15_000); pages.push(page);
    await page.goto(index === 0 ? BASE_URL : invite);
    await page.getByTestId('auth-tab-criar').click();
    await page.getByTestId('auth-username').fill(name);
    await page.getByTestId('auth-display-name').fill(name);
    await page.getByTestId('auth-password').fill('senha-apenas-teste-1');
    await page.getByTestId('auth-submit').click();
    if (index === 0) {
      await page.getByTestId('rail-create').click();
      await page.getByTestId('group-name').fill('Teste de presença');
      await page.getByTestId('group-create').click();
      await page.getByTestId('chat').waitFor();
      await page.getByTestId('group-menu').click();
      await page.getByTestId('group-invite').click();
      await waitFor(async () => /#\/convite\//.test(await page.getByTestId('group-invite-link').inputValue()), 'convite');
      invite = await page.getByTestId('group-invite-link').inputValue();
      await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).first().click();
    } else await page.getByTestId('join-accept').click();
    await page.getByTestId('chat').waitFor();
  }
}, 90_000);
after(async () => { for (const browser of browsers) await browser.close(); await stack?.stop(); });

test('uma conta, duas contas e quatro contas; observadores recebem a presença', async () => {
  for (let i = 0; i < 4; i++) {
    await channel(pages[i]).click();
    await pages[i].getByTestId('connection').waitFor();
    await count(pages[0], i + 1);
    await count(pages[3], i + 1);
  }
  assert.deepEqual(await pages[0].evaluate(() => window.__callTones), [520, 780, 520, 780, 520, 780, 520, 780], 'um som por entrada, sem tocar para a lista inicial');
});

test('perfil, menu contextual, microfone e ensurdecimento remotos', async () => {
  const row = rows(pages[0]).filter({ has: pages[0].locator('[data-user-trigger]') }).filter({ hasText: 'boreal' });
  await row.locator('[data-user-trigger]').click();
  await pages[0].getByTestId('profile-card').waitFor();
  await pages[0].keyboard.press('Escape');
  await row.locator('[data-user-trigger]').click({ button: 'right' });
  await pages[0].getByTestId('user-menu').waitFor();
  await pages[0].keyboard.press('Escape');
  assert.equal(await rows(pages[1]).first().getAttribute('draggable'), 'false');
  await pages[1].getByTestId('dock-deafen').click();
  await row.getByLabel('Ensurdecido').waitFor();
  await pages[1].getByTestId('dock-deafen').click();
  await row.getByLabel('Ensurdecido').waitFor({ state: 'detached' });
  await pages[1].getByTestId('dock-mic').click();
  await row.getByLabel('Microfone ligado').waitFor();
  await waitFor(async () => await row.getAttribute('data-speaking') === 'true', 'indicador remoto de fala', 15_000);
  await pages[1].getByTestId('dock-mic').click();
  await row.getByLabel('Microfone desligado').waitFor();
  await waitFor(async () => await row.getAttribute('data-speaking') === 'false', 'fim da fala');
});

test('compartilhamento real de tela e prévia no hover', async () => {
  await pages[0].getByTestId('dock-share').click();
  const row = rows(pages[1]).filter({ hasText: 'atlas' });
  await row.getByText('AO VIVO').waitFor();
  await row.locator('[data-user-trigger]').hover();
  await pages[1].getByTestId('stream-preview-video').waitFor();
  await pages[1].mouse.move(900, 800);
});

test('cabeçalho sem sobreposições e chat clicável em várias larguras', async () => {
  mkdirSync('e2e/.artifacts', { recursive: true });
  const page = pages[0];
  for (const width of [1600, 1280, 1024, 800, 390]) {
    await page.setViewportSize({ width, height: 960 });
    const header = page.getByTestId('voice-room').locator('header');
    const controls = [header.getByTestId('connection'), header.getByTestId('headcount'), header.getByTestId('voice-chat-toggle'), header.getByLabel('Sua conta nesta sala')];
    for (let i = 0; i < controls.length; i++) {
      const a = await controls[i].boundingBox(); assert.ok(a && a.width > 0);
      assert.ok(a.x >= 0 && a.x + a.width <= width + 1, `${width}: controle visível`);
      for (const other of controls.slice(i + 1)) {
        const b = await other.boundingBox();
        assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1, `${width}: controles separados`);
      }
    }
    await header.getByTestId('voice-chat-toggle').click();
    await header.getByTestId('voice-chat-toggle').click();
    await page.screenshot({ path: `e2e/.artifacts/call-${width}.png` });
  }
  await page.setViewportSize({ width: 1600, height: 960 });
});

test('saída e entrada simultâneas não deixam fantasmas', async () => {
  await Promise.all([pages[2], pages[3]].map(page => page.getByTestId('dock-leave').click()));
  await count(pages[0], 2);
  await Promise.all([pages[2], pages[3]].map(page => channel(page).click()));
  for (const page of pages) await count(page, 4);
});

test('reconexão real ao SFU mantém as quatro identidades', async () => {
  assert.ok(stack.ownsLivekit, 'teste precisa controlar seu SFU local');
  const tones = await pages[0].evaluate(() => window.__callTones.length);
  await stack.restartLivekit(2500);
  for (const page of pages) {
    await waitFor(async () => await page.getByTestId('connection').getAttribute('data-phase') === 'connected', 'reconexão', 60_000);
    await count(page, 4);
  }
  assert.equal(await pages[0].evaluate(() => window.__callTones.length), tones, 'reconexão não repete sons de entrada');
});


test('parar transmissão e perder conexão removem os estados remotos', async () => {
  await pages[0].screenshot({ path: 'e2e/.artifacts/before-stop.png' });
  await pages[0].getByTestId('dock-stop').click();
  await rows(pages[1]).filter({ hasText: 'atlas' }).getByText('AO VIVO').waitFor({ state: 'detached' });
  await pages[3].context().close();
  for (const page of pages.slice(0, 3)) await count(page, 3);
  await waitFor(async () => (await pages[0].evaluate(() => window.__callTones.slice(-2))).join(',') === '780,520', 'som após confirmação de saída');
  assert.deepEqual(await pages[0].evaluate(() => window.__callTones.slice(-2)), [780, 520], 'som de saída descendente');
});
