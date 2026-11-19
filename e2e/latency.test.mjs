import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE_URL, launchChrome, root, startStack, waitFor } from './harness.mjs';
import { imageShows, pngFile } from './images.mjs';

const baseline = process.env.COSMIC_BASELINE === '1';
let stack, browser, a, b, alice, bob, groupId, textId, voiceId;
const measurements = { environment: 'Chrome + API Node + PGlite + LiveKit locais; duas contas isoladas', baseline };
const api = async (method, path, token, body) => {
  const start = performance.now();
  const response = await fetch(`${BASE_URL}${path}`, { method, headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  return { ...json, elapsed: performance.now() - start, timing: response.headers.get('server-timing') };
};
before(async () => {
  stack = await startStack({ DATABASE_URL: '' });
  alice = await api('POST', '/api/auth/register', null, { username: 'latency_ana', displayName: 'Ana', password: 'senha-testes-123' });
  bob = await api('POST', '/api/auth/register', null, { username: 'latency_beto', displayName: 'Beto', password: 'senha-testes-123' });
  groupId = (await api('POST', '/api/groups', alice.token, { name: 'Latência e avatares' })).group.id;
  const { invite } = await api('POST', `/api/groups/${groupId}/invites`, alice.token, {});
  await api('POST', `/api/invites/${invite.code}/accept`, bob.token);
  const view = await api('GET', `/api/groups/${groupId}`, alice.token);
  textId = view.channels.find(c => c.kind === 'texto').id;
  voiceId = view.channels.find(c => c.kind === 'voz').id;
  browser = await launchChrome({ headless: true });
  for (const account of [alice, bob]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(token => {
      localStorage.setItem('shareroom:conta', token);
      const Native = window.WebSocket;
      window.__gateways = [];
      window.WebSocket = class extends Native { constructor(...args) { super(...args); if (String(args[0]).includes('/api/gateway')) window.__gateways.push(this); } };
    }, account.token);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/#/grupos/${groupId}/${textId}`);
    // Navegação real do app usa o hash que a barra lateral gera.
    await page.getByTestId('groups').waitFor();
    await page.locator(`[data-testid="rail-group"][data-id="${groupId}"]`).count().then(async count => {
      if (count) await page.locator(`[data-testid="rail-group"][data-id="${groupId}"]`).click();
    });
    if (!await page.getByTestId('chat-input').count()) await page.getByRole('button', { name: 'Latência e avatares', exact: true }).click();
    await page.getByTestId('chat-input').waitFor();
    await waitFor(async () => await page.getByTestId('groups').getAttribute('data-live') === 'true', 'gateway pronto');
    if (!a) a = page; else b = page;
  }
});
after(async () => {
  mkdirSync(resolve(root, 'e2e/.artifacts'), { recursive: true });
  writeFileSync(resolve(root, `e2e/.artifacts/latency-${baseline ? 'before' : 'after'}.json`), JSON.stringify(measurements, null, 2));
  await browser?.close(); await stack?.stop();
});
test('mede envio e chegada em duas contas com API local ativa', async () => {
  measurements.messages = [];
  for (let i = 0; i < 5; i++) {
    const content = `latencia-${i}`;
    await a.getByTestId('chat-input').fill(content);
    const start = performance.now();
    const response = a.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/channels/${textId}/messages`));
    await a.getByTestId('chat-input').press('Enter');
    await a.getByTestId('chat-message').filter({ hasText: content }).waitFor();
    const visible = performance.now() - start;
    const result = await response;
    const ack = performance.now() - start;
    await b.getByTestId('chat-message').filter({ hasText: content }).waitFor();
    measurements.messages.push({ visible, ack, recipient: performance.now() - start, serverTiming: result.headers()['server-timing'] });
  }
});
test('mede resposta visual com 800 ms de atraso controlado na API', async () => {
  await a.route(`**/api/channels/${textId}/messages`, async route => {
    if (route.request().method() === 'POST') await new Promise(resolve => setTimeout(resolve, 800));
    await route.continue();
  });
  await a.getByTestId('chat-input').fill('api-com-atraso');
  const start = performance.now();
  await a.getByTestId('chat-input').press('Enter');
  await a.getByTestId('chat-message').filter({ hasText: 'api-com-atraso' }).waitFor();
  measurements.delayedApiVisible = performance.now() - start;
  if (!baseline) {
    assert.ok(measurements.delayedApiVisible < 500);
    await a.getByTestId('message-delivery').filter({ hasText: 'Enviando' }).waitFor();
    await a.getByTestId('message-delivery').filter({ hasText: 'Enviada' }).first().waitFor();
  }
  await waitFor(async () => await b.getByTestId('chat-message').filter({ hasText: 'api-com-atraso' }).count() === 1, 'entrega única');
  await a.unroute(`**/api/channels/${textId}/messages`);
});
test('mede entrada real no LiveKit e participantes existentes', async () => {
  const samples = [];
  for (const page of [a, b]) {
    const start = performance.now();
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/channels/${voiceId}/voice`));
    await page.locator(`[data-testid="channel"][data-name="Sala de voz"]`).click();
    const result = await response;
    const apiTime = performance.now() - start;
    await page.getByTestId('voice-room').waitFor();
    await page.locator('[data-testid="connection"][data-phase="connected"]').waitFor();
    const room = performance.now() - start;
    await waitFor(async () => await page.getByTestId('call-card').count() === (page === a ? 1 : 2), 'participantes reais do LiveKit');
    samples.push({ api: apiTime, room, participants: performance.now() - start, serverTiming: result.headers()['server-timing'], serverStages: (await result.json()).timings, stages: await page.evaluate(() => window.cosmicLatency?.snapshot().filter(s => s.operation === 'voice')) });
  }
  measurements.voice = samples;
});

test('fotos atualizam em duas contas: cabeçalho, barra, chamada, mensagens, membros, perfis e amigos', { skip: baseline }, async () => {
  const png = pngFile('latency-avatar.png', 96, 96);
  await a.getByTestId('account-menu').click();
  await a.getByTestId('profile-avatar-file').setInputFiles(png);
  await a.getByTestId('profile-upload-confirm').click();
  await waitFor(() => imageShows(a.getByTestId('profile-preview').locator('[data-avatar="foto"] img').first()), 'prévia carregada');
  await a.getByRole('dialog', { name: 'Configurações' }).getByRole('button', { name: 'Fechar' }).first().click();
  const photo = a.getByTestId('account-menu').locator('img');
  await waitFor(() => imageShows(photo), 'foto na barra inferior');
  const url = await photo.getAttribute('src');
  await waitFor(() => imageShows(a.getByTestId('call-header').locator('img')), 'foto no cabeçalho');
  const remote = b.locator(`[data-testid="call-card"][data-identity="${alice.user.id}"] img`);
  await waitFor(() => imageShows(remote), 'outra conta recebe foto durante a chamada');
  assert.equal(await remote.getAttribute('src'), url);
  if (await a.getByTestId('voice-chat-toggle').getAttribute('aria-pressed') !== 'true') await a.getByTestId('voice-chat-toggle').click();
  const row = a.getByTestId('voice-chat').getByTestId('chat-input');
  await row.fill('foto-na-mensagem'); await row.press('Enter');
  await waitFor(() => imageShows(a.getByTestId('chat-message').filter({ hasText: 'foto-na-mensagem' }).locator('img').first()), 'foto na mensagem');
  await a.getByTestId('voice-chat-toggle').click();
  await api('POST', '/api/friends', alice.token, { userId: bob.user.id });
  await api('POST', `/api/friends/${alice.user.id}/accept`, bob.token);
  // Membro e cartão de perfil do outro usuário, fora da chamada.
  await b.locator(`[data-testid="channel"][data-name="geral"]`).click();
  const member = b.locator('[data-testid="member"][data-user="latency_ana"]');
  await waitFor(() => imageShows(member.locator('img').first()), 'foto nos membros');
  await member.locator('[data-user-trigger]').click();
  await waitFor(() => imageShows(b.getByTestId('profile-card').locator('[data-avatar="foto"] img')), 'foto no perfil');
  await b.keyboard.press('Escape');
  const media = await fetch(new URL(url, BASE_URL), { headers: { origin: 'app://shareroom' } });
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('access-control-allow-origin'), 'app://shareroom');
  assert.match(media.headers.get('cache-control'), /immutable/);
  measurements.avatar = { httpStatus: media.status, desktopCors: true };
  await b.evaluate(() => { location.hash = '#/mensagens'; });
  await waitFor(() => imageShows(b.locator('[data-testid="friend-row"][data-user="latency_ana"] img')), 'foto nos amigos');
  await b.evaluate(([group, channel]) => { location.hash = `#/grupos/${group}/${channel}`; }, [groupId, textId]);
  await b.getByTestId('chat-input').waitFor();
});

test('cabeçalho responsivo mantém os controles separados e clicáveis', { skip: baseline }, async () => {
  measurements.widths = [];
  for (const width of [1600, 1280, 1024, 800, 480]) {
    await a.setViewportSize({ width, height: 950 });
    const header = a.getByTestId('call-header');
    const controls = [header.getByTestId('connection'), header.getByTestId('headcount'), header.getByTestId('voice-chat-toggle'), header.getByRole('button', { name: 'Sua conta nesta sala' })];
    const boxes = await Promise.all(controls.map(c => c.boundingBox()));
    for (let i = 0; i < boxes.length; i++) {
      assert.ok(boxes[i], `controle ${i} visível em ${width}`);
      assert.ok(boxes[i].x >= 0 && boxes[i].x + boxes[i].width <= width + 1);
      for (let j = i + 1; j < boxes.length; j++) {
        const x = boxes[i], y = boxes[j];
        assert.ok(x.x + x.width <= y.x + 1 || y.x + y.width <= x.x + 1 || x.y + x.height <= y.y + 1 || y.y + y.height <= x.y + 1, `controles ${i}/${j} se sobrepõem em ${width}`);
      }
    }
    await header.getByTestId('voice-chat-toggle').click();
    await a.getByTestId('voice-chat').waitFor();
    const openBoxes = await Promise.all(controls.map(c => c.boundingBox()));
    for (let i = 0; i < openBoxes.length; i++) {
      const x = openBoxes[i];
      assert.ok(x.x >= 0 && x.x + x.width <= width + 1, `controle com chat aberto em ${width}`);
      for (let j = i + 1; j < openBoxes.length; j++) {
        const y = openBoxes[j];
        assert.ok(x.x + x.width <= y.x + 1 || y.x + y.width <= x.x + 1 || x.y + x.height <= y.y + 1 || y.y + y.height <= x.y + 1, `sobreposição com chat aberto em ${width}`);
      }
    }
    await header.getByTestId('voice-chat-toggle').click();
    measurements.widths.push(width);
    mkdirSync(resolve(root, 'e2e/.artifacts'), { recursive: true });
    await a.screenshot({ path: resolve(root, `e2e/.artifacts/call-header-${width}.png`) });
  }
  await a.setViewportSize({ width: 1440, height: 900 });
});

test('envios rápidos e simultâneos chegam nas duas contas em ordem e sem duplicatas', { skip: baseline }, async () => {
  for (const page of [a, b]) await page.locator('[data-testid="channel"][data-name="geral"]').click();
  for (let i = 0; i < 2; i++) await Promise.all([[a, 'ana'], [b, 'beto']].map(async ([page, who]) => {
    await page.getByTestId('chat-input').fill(`simultanea-${who}-${i}`);
    await page.getByTestId('chat-input').press('Enter');
  }));
  for (const page of [a, b]) await waitFor(async () => await page.getByTestId('chat-message').filter({ hasText: 'simultanea-' }).count() === 4, 'rajada recebida');
  const ids = await Promise.all([a, b].map(page => page.getByTestId('chat-message').filter({ hasText: 'simultanea-' }).evaluateAll(nodes => nodes.map(n => n.dataset.id))));
  assert.deepEqual(ids[0], ids[1]);
  assert.equal(new Set(ids[0]).size, 4);
});

test('resposta HTTP perdida após gravar: retry confirma a mesma mensagem uma vez', { skip: baseline }, async () => {
  // A mídia continua conectada, mesmo com a conexão do gateway encerrada por alguns instantes.
  await a.evaluate(() => window.__gateways.at(-1).close());
  let posted;
  await a.route(`**/api/channels/${textId}/messages`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    posted = route.request().postDataJSON();
    await route.fetch();
    await route.abort('failed');
  });
  await a.getByTestId('chat-input').fill('gravou-mas-perdeu-resposta');
  await a.getByTestId('chat-input').press('Enter');
  const message = a.getByTestId('chat-message').filter({ hasText: 'gravou-mas-perdeu-resposta' });
  await message.getByRole('button', { name: 'Tentar novamente' }).waitFor();
  await a.unroute(`**/api/channels/${textId}/messages`);
  await message.getByRole('button', { name: 'Tentar novamente' }).click();
  await waitFor(async () => /Enviada/.test(await message.textContent()), 'confirmação do retry');
  const history = await api('GET', `/api/channels/${textId}/messages`, alice.token);
  assert.equal(history.messages.filter(m => m.clientId === posted.clientId).length, 1);
  assert.equal(await b.getByTestId('chat-message').filter({ hasText: 'gravou-mas-perdeu-resposta' }).count(), 1);
});

test('perder rede durante envio mostra erro; reconectar e tentar novamente entrega', { skip: baseline }, async () => {
  await b.context().setOffline(true);
  await b.getByTestId('chat-input').fill('envio-sem-rede');
  await b.getByTestId('chat-input').press('Enter');
  const message = b.getByTestId('chat-message').filter({ hasText: 'envio-sem-rede' });
  await message.getByRole('button', { name: 'Tentar novamente' }).waitFor();
  await b.context().setOffline(false);
  await message.getByRole('button', { name: 'Tentar novamente' }).click();
  await waitFor(async () => /Enviada/.test(await message.textContent()), 'envio após voltar a rede');
  await waitFor(async () => await a.getByTestId('chat-message').filter({ hasText: 'envio-sem-rede' }).count() === 1, 'entrega após reconexão');
});

test('trocar canal, evitar cliques duplicados e sair mantém só a sala solicitada', { skip: baseline }, async () => {
  const { id } = await api('POST', `/api/groups/${groupId}/channels`, alice.token, { name: 'Segunda voz', kind: 'voz' });
  const channel = a.locator('[data-testid="channel"][data-name="Segunda voz"]');
  await channel.waitFor();
  let requests = 0;
  const count = request => { if (request.method() === 'POST' && request.url().endsWith(`/channels/${id}/voice`)) requests++; };
  a.on('request', count);
  await channel.evaluate(button => { button.click(); button.click(); button.click(); });
  await a.getByTestId('room-name').filter({ hasText: 'Segunda voz' }).waitFor();
  await a.locator('[data-testid="connection"][data-phase="connected"]').waitFor();
  assert.equal(requests, 1);
  a.off('request', count);
  let view = await api('GET', `/api/groups/${groupId}`, alice.token);
  assert.ok(view.voice[id].includes(alice.user.id));
  assert.ok(!view.voice[voiceId]?.includes(alice.user.id));
  await a.getByTestId('voice-bar-leave').click();
  await waitFor(async () => await a.getByTestId('voice-bar').count() === 0, 'saída da sala');
  await waitFor(async () => !(await api('GET', `/api/groups/${groupId}`, alice.token)).voice[id]?.includes(alice.user.id), 'saída confirmada pelo servidor');
  await channel.click();
  await a.locator('[data-testid="connection"][data-phase="connected"]').waitFor();
});

test('API lenta ao conectar mantém interface e cancelamento utilizáveis, sem pedidos repetidos', { skip: baseline }, async () => {
  await a.getByTestId('voice-bar-leave').click();
  await waitFor(async () => await a.getByTestId('voice-bar').count() === 0, 'sair antes do teste lento');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let handled;
  const continued = new Promise(resolve => { handled = resolve; });
  let calls = 0;
  await a.route(`**/api/channels/${voiceId}/voice`, async route => { calls++; await gate; await route.continue(); handled(); });
  await a.locator('[data-testid="channel"][data-name="Sala de voz"]').click();
  await a.getByTestId('voice-connecting').waitFor();
  await waitFor(async () => /repouso/.test(await a.getByTestId('voice-connecting').textContent()), 'aviso de backend lento', 12_000);
  assert.equal(calls, 1);
  await a.getByTestId('voice-bar-leave').click();
  release();
  await continued;
  await a.unroute(`**/api/channels/${voiceId}/voice`);
  await waitFor(async () => await a.getByTestId('voice-bar').count() === 0, 'cancelar entrada pendente');
  await waitFor(async () => !(await api('GET', `/api/groups/${groupId}`, alice.token)).voice[voiceId]?.includes(alice.user.id), 'cancelamento limpa presença');
  measurements.slowBackend = 'atraso controlado >8 s; não é cold start real do Render';
});

test('reconecta a chamada após reinício do LiveKit local', { skip: baseline }, async () => {
  await b.locator('[data-testid="channel"][data-name="Sala de voz"]').click();
  await b.locator('[data-testid="connection"][data-phase="connected"]').waitFor();
  await b.evaluate(() => {
    window.__sawReconnect = false;
    const connection = document.querySelector('[data-testid="connection"]');
    window.__phaseObserver = new MutationObserver(() => { if (connection.dataset.phase === 'reconnecting') window.__sawReconnect = true; });
    window.__phaseObserver.observe(connection, { attributes: true, attributeFilter: ['data-phase'] });
  });
  const start = performance.now();
  await stack.restartLivekit(1000);
  await waitFor(() => b.evaluate(() => window.__sawReconnect && document.querySelector('[data-testid="connection"]')?.dataset.phase === 'connected'), 'reconexão WebRTC real', 45_000);
  measurements.livekitRestartReconnectMs = performance.now() - start;
  await b.evaluate(() => window.__phaseObserver.disconnect());
});

test('mensagens privadas são otimistas, mostram erro e permitem retry sem duplicar', { skip: baseline }, async () => {
  const { id } = await api('POST', '/api/dms', alice.token, { userId: bob.user.id });
  for (const page of [a, b]) { await page.evaluate(dm => { location.hash = `#/mensagens/${dm}`; }, id); await page.getByTestId('dm-input').waitFor(); }
  await a.route(`**/api/dms/${id}/messages`, async route => {
    if (route.request().method() === 'POST') await route.abort('failed'); else await route.continue();
  });
  await a.getByTestId('dm-input').fill('privada-com-retry'); await a.getByTestId('dm-input').press('Enter');
  const message = a.getByTestId('dm-message').filter({ hasText: 'privada-com-retry' });
  await message.getByRole('button', { name: 'Tentar novamente' }).waitFor();
  await a.unroute(`**/api/dms/${id}/messages`);
  await message.getByRole('button', { name: 'Tentar novamente' }).click();
  await waitFor(async () => /Enviada/.test(await message.textContent()), 'DM confirmada');
  await waitFor(async () => await b.getByTestId('dm-message').filter({ hasText: 'privada-com-retry' }).count() === 1, 'DM única recebida');
  await waitFor(() => imageShows(b.getByTestId('dm-chat').locator('header [data-avatar="foto"] img')), 'foto na conversa privada');
});

test('salas privadas mostram e sincronizam a foto da conta autenticada', { skip: baseline }, async () => {
  const { invite } = await api('POST', '/api/rooms', alice.token, { name: 'Fotos na sala privada', capacity: 4 });
  for (const [page, name] of [[a, 'Ana'], [b, 'Beto']]) {
    await page.goto(`${BASE_URL}/#/sala/${invite}`);
    await page.getByTestId('gate-name').fill(name);
    await page.getByTestId('gate-join').click();
    await page.locator('[data-testid="connection"][data-phase="connected"]').waitFor();
  }
  await waitFor(() => imageShows(a.getByTestId('call-header').getByRole('button', { name: 'Sua conta nesta sala' }).locator('img')), 'foto no cabeçalho da sala privada');
  await waitFor(() => imageShows(b.getByTestId('call-card').filter({ hasText: 'Ana' }).locator('img')), 'foto recebida pela outra conta na sala privada');
  await waitFor(() => imageShows(b.getByTestId('participants').getByTestId('participant').filter({ hasText: 'Ana' }).locator('img')), 'foto na lista de participantes da sala privada');
  const old = await b.getByTestId('call-card').filter({ hasText: 'Ana' }).locator('img').getAttribute('src');
  await b.emulateMedia({ reducedMotion: 'reduce' });
  const editor = await a.context().newPage();
  await editor.goto(BASE_URL); await editor.getByTestId('account-menu').click();
  await editor.getByTestId('profile-avatar-file').setInputFiles(pngFile('avatar-new-private.png', 120, 120, [255, 120, 30, 255]));
  await editor.getByTestId('profile-upload-confirm').click();
  const remote = b.getByTestId('call-card').filter({ hasText: 'Ana' }).locator('img');
  await waitFor(async () => await remote.getAttribute('src') !== old && await imageShows(remote), 'nova foto chega pela chamada privada');
  await waitFor(async () => await b.getByTestId('call-card').filter({ hasText: 'Ana' }).locator('canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0 && !canvas.classList.contains('hidden')), 'foto estática com movimento reduzido');
  await b.emulateMedia({ reducedMotion: 'no-preference' });
  await waitFor(() => remote.isVisible(), 'foto continua visível ao desativar movimento reduzido');
  await a.route('**/api/media/**', route => route.fulfill({ status: 404, headers: { 'cache-control': 'no-store' }, body: '' }));
  await editor.getByTestId('profile-avatar-file').setInputFiles(pngFile('avatar-recovery.png', 128, 128, [40, 180, 90, 255]));
  await editor.getByTestId('profile-upload-confirm').click();
  const local = a.getByTestId('call-header').getByRole('button', { name: 'Sua conta nesta sala' });
  await waitFor(async () => await local.locator('[data-avatar="iniciais"]').count() === 1, '404 exibe inicial de fallback');
  await a.unroute('**/api/media/**');
  await a.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => imageShows(local.locator('img')), 'foto se recupera após a rede voltar');
  await editor.close();
});
