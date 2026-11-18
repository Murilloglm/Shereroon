import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, startStack, waitFor } from './harness.mjs';
let stack, browser, owner, guest;
const channel = (page, name) => page.getByTestId('channel').filter({ hasText: new RegExp(`^${name}$`) });
async function signup(page, name) {
  await page.getByTestId('auth-tab-criar').click(); await page.getByTestId('auth-username').fill(name);
  await page.getByTestId('auth-display-name').fill(name); await page.getByTestId('auth-password').fill('senha-local-teste-1');
  await page.getByTestId('auth-submit').click();
}
before(async () => {
  stack = await startStack({ DATABASE_URL: '' }); browser = await launchChrome({ headless: true, fakeMic: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  owner = await context.newPage(); owner.setDefaultTimeout(15000); await owner.goto(BASE_URL); await signup(owner, 'voiceowner');
  await owner.getByTestId('rail-create').click(); await owner.getByTestId('group-name').fill('Latência'); await owner.getByTestId('group-create').click();
  await owner.getByTestId('chat').waitFor(); await owner.getByTestId('group-menu').click(); await owner.getByTestId('group-invite').click();
  await waitFor(async () => /#\/convite\//.test(await owner.getByTestId('group-invite-link').inputValue()), 'convite');
  const invite = await owner.getByTestId('group-invite-link').inputValue();
  await owner.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).first().click();
  const guestContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); guest = await guestContext.newPage(); guest.setDefaultTimeout(15000);
  await guest.goto(invite); await signup(guest, 'voiceguest'); await guest.getByTestId('join-accept').click(); await guest.getByTestId('chat').waitFor();
  await channel(owner, 'Sala de voz').click(); await owner.getByTestId('connection').waitFor();
});
after(async () => { await browser?.close(); await stack?.stop(); });
test('mede API, token, conexão e presença; duas contas e cliques repetidos', async () => {
  const results = [];
  for (let i=0;i<3;i++) {
    let requests = 0;
    const track = request => { if (request.method() === 'POST' && /\/voice$/.test(request.url())) requests++; };
    guest.on('request', track);
    const pending = guest.waitForResponse(response => response.request().method() === 'POST' && /\/voice$/.test(response.url()));
    const start = performance.now();
    await channel(guest, 'Sala de voz').click();
    const response = await pending; await response.finished();
    const grant = await response.json(); const tokenMs = performance.now() - start;
    await waitFor(async () => await guest.getByTestId('connection').getAttribute('data-phase') === 'connected', 'LiveKit conectado');
    const roomMs = performance.now() - start;
    await waitFor(async () => await guest.getByTestId('channel-voice-people').getByTestId('voice-member').count() === 2, 'dois participantes');
    const participantsMs = performance.now() - start;
    const timing = response.request().timing();
    results.push({ apiMs: timing.responseEnd - timing.requestStart, tokenMs, roomMs, participantsMs, server: grant.timings ?? null, requests });
    if (process.env.PERF_LABEL !== 'before') assert.equal(requests, 1, 'single flight ao clicar repetidamente');
    guest.off('request', track);
    await guest.getByTestId('dock-leave').click();
    await waitFor(async () => await owner.getByTestId('channel-voice-people').getByTestId('voice-member').count() === 1, 'saída sincronizada');
  }
  mkdirSync('e2e/.artifacts', { recursive: true });
  writeFileSync(`e2e/.artifacts/voice-latency-${process.env.PERF_LABEL ?? 'after'}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
});

test('cliques repetidos durante conexão lenta pedem um único token', { skip: process.env.PERF_LABEL === 'before' }, async () => {
  let requests = 0;
  await guest.route('**/voice', async route => { requests++; await new Promise(resolve => setTimeout(resolve, 200)); await route.continue(); });
  await channel(guest, 'Sala de voz').click(); await channel(guest, 'Sala de voz').click(); await channel(guest, 'Sala de voz').click();
  await waitFor(async () => await guest.getByTestId('connection').getAttribute('data-phase') === 'connected', 'conexão após cliques');
  assert.equal(requests, 1);
  await guest.unroute('**/voice');
});
