import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, startStack, waitFor } from './harness.mjs';
let stack, browser, a, b, dm;
const measurements = [];
async function signup(page, name) {
  await page.goto(BASE_URL); await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill(name); await page.getByTestId('auth-display-name').fill(name);
  await page.getByTestId('auth-password').fill('senha-apenas-teste-1'); await page.getByTestId('auth-submit').click();
  await page.getByTestId('account-settings-open').waitFor();
}
before(async () => {
  stack = await startStack({ DATABASE_URL: '' }); browser = await launchChrome({ headless: true });
  a = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  b = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  for (const [page, name] of [[a,'deliveryfirst'],[b,'deliverysecond']]) { page.setDefaultTimeout(15000); await signup(page, name); }
  await a.getByTestId('rail-create').click(); await a.getByTestId('group-name').fill('Delivery'); await a.getByTestId('group-create').click();
  await a.getByTestId('chat').waitFor(); await a.getByTestId('group-menu').click(); await a.getByTestId('group-invite').click();
  await waitFor(async () => /#\/convite\//.test(await a.getByTestId('group-invite-link').inputValue()), 'invite');
  const invite = await a.getByTestId('group-invite-link').inputValue();
  await a.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).first().click();
  await b.goto(invite); await b.getByTestId('join-accept').click(); await b.getByTestId('chat').waitFor();
});
after(async () => { mkdirSync('e2e/.artifacts', { recursive: true }); writeFileSync('e2e/.artifacts/message-latency.json', JSON.stringify(measurements, null, 2)); await browser?.close(); await stack?.stop(); });

for (const kind of ['group','dm']) {
  const row = (page, content) => page.getByTestId(kind === 'group' ? 'chat-message' : 'dm-message').filter({ hasText: content });
  const input = page => page.getByTestId(kind === 'group' ? 'chat-input' : 'dm-input');
  const path = kind === 'group' ? '**/api/channels/*/messages' : '**/api/dms/*/messages';
  async function send(page, content) { await input(page).fill(content); await input(page).press('Enter'); }
  test(`${kind}: duas contas, simultâneo e rajada sem duplicatas`, async () => {
    if (kind === 'dm') {
      const other = await b.evaluate(async () => (await (await fetch('/api/auth/me', { headers: { authorization: `Bearer ${localStorage.getItem('shareroom:conta')}` } })).json()).user.id);
      dm = await a.evaluate(async other => (await (await fetch('/api/dms', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('shareroom:conta')}` }, body: JSON.stringify({ userId: other }) })).json()).id, other);
      for (const page of [a,b]) { await page.goto(`${BASE_URL}/#/mensagens/${dm}`); await input(page).waitFor(); }
    }
    await Promise.all([send(a,`${kind} simultaneous A`),send(b,`${kind} simultaneous B`)]);
    for (let i=0;i<5;i++) await send(a,`${kind} rapid ${i}`);
    for (const page of [a,b]) for (const content of [`${kind} simultaneous A`,`${kind} simultaneous B`,...Array.from({length:5},(_,i)=>`${kind} rapid ${i}`)]) {
      await waitFor(async () => await row(page, content).count() === 1 && await row(page, content).getAttribute('data-delivery') === 'sent', 'confirmação e deduplicação');
    }
  });
  test(`${kind}: atualização otimista antes do HTTP e confirmação única`, async () => {
    let requests=0;
    await a.route(path, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      requests++; await new Promise(resolve=>setTimeout(resolve,700)); await route.continue();
    });
    const content=`${kind} delayed-confirm`; const start=performance.now(); await send(a,content);
    await waitFor(async()=>await row(a,content).getAttribute('data-delivery')==='sending','estado enviando');
    const optimisticMs=performance.now()-start; assert.ok(optimisticMs<700,`otimista em ${optimisticMs}ms`);
    await waitFor(async()=>await row(a,content).getAttribute('data-delivery')==='sent','confirmação');
    await row(b,content).waitFor(); measurements.push({kind,optimisticMs,confirmedMs:performance.now()-start,controlledDelayMs:700});
    assert.equal(requests,1); await a.unroute(path);
  });
  test(`${kind}: rede perdida após commit, reconexão e retry idempotente`, async () => {
    await a.route(path, async route => {
      if (route.request().method()!=='POST') return route.continue();
      await route.fetch(); await route.abort('failed');
    });
    const content=`${kind} lost-ack`; await send(a,content);
    await waitFor(async()=>await row(b,content).count()===1,'servidor entregou');
    // The gateway acknowledgement can confirm even if HTTP was lost.
    await waitFor(async()=>await row(a,content).getAttribute('data-delivery')==='sent','gateway confirma HTTP perdido');
    assert.equal(await row(a,content).count(),1); await a.unroute(path);
    await a.route(path, route=>route.request().method()==='POST'?route.abort('failed'):route.continue());
    await a.context().setOffline(true);
    const failed=`${kind} retry-after-offline`; await send(a,failed);
    await waitFor(async()=>await row(a,failed).getAttribute('data-delivery')==='failed','falha visível');
    await a.context().setOffline(false); await a.unroute(path);
    await row(a,failed).getByTestId(kind==='group'?'message-retry':'dm-retry').click();
    await waitFor(async()=>await row(a,failed).getAttribute('data-delivery')==='sent','retry confirmado');
    await waitFor(async()=>await row(b,failed).count()===1,'destinatário recebeu uma vez');
  });
}
