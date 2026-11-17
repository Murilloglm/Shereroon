// Convites, canais de voz privados, chat da chamada e mover pessoas entre canais, de ponta a ponta, com três
// contas de permissões diferentes (dona, membro com acesso ao canal privado e membro sem acesso).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, sourcePageHtml, startStack, videoFacts, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
let stack;
const browsers = [];
let ana;
let beto;
let caio;
let invite;

const channel = (page, name) => page.getByTestId('channel').filter({ hasText: new RegExp(`^${name}$`) });
const item = (page, name) => page.getByTestId('channel-item').filter({ has: channel(page, name) });
const peopleIn = (page, name) => item(page, name).getByTestId('channel-voice-people').locator('[data-user]');

async function open(name, options = {}) {
  const browser = await launchChrome({ headless, ...options });
  browsers.push(browser);
  const context = await browser.newContext({ viewport: { width: 1600, height: 920 } });
  if (options.captureTitle) await (await context.newPage()).setContent(sourcePageHtml(options.captureTitle, 0));
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.dismiss());
  return page;
}

async function signUp(page, username) {
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-display-name').fill(username[0].toUpperCase() + username.slice(1));
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
}

async function createChannel(page, name, kind, setup) {
  await page.getByTestId('group-menu').click();
  await page.getByTestId('group-new-channel').click();
  await page.getByTestId(`channel-kind-${kind}`).click();
  await page.getByTestId('channel-name').fill(name);
  await setup?.(page.getByTestId('create-channel'));
  await page.getByTestId('create-channel').locator('button[type="submit"]').click();
  await channel(page, name).waitFor();
}

before(async () => {
  stack = await startStack();
  ana = await open('ana', { captureTitle: 'sr-tela-canais' });
  beto = await open('beto');
  caio = await open('caio');
  await ana.goto(BASE_URL);
  await ana.getByTestId('home-groups').click();
  await signUp(ana, 'ana');
  await ana.getByTestId('rail-create').click();
  await ana.getByTestId('group-name').fill('Os Amigos');
  await ana.getByTestId('group-create').click();
  await ana.getByTestId('chat').waitFor();
  await ana.getByTestId('group-menu').click();
  await ana.getByTestId('group-invite').click();
  await waitFor(async () => /#\/convite\//.test(await ana.getByTestId('group-invite-link').inputValue()), 'o convite ser gerado');
  invite = await ana.getByTestId('group-invite-link').inputValue();
  await ana.getByRole('dialog', { name: /Convidar para/ }).getByRole('button', { name: 'Fechar' }).first().click();
});

after(async () => {
  for (const browser of browsers) await browser.close();
  await stack?.stop();
});

test('convite sem conta: mostra o grupo, a validade e as opções do aplicativo; a conta nova entra', async () => {
  for (const [page, name] of [[beto, 'beto'], [caio, 'caio']]) {
    await page.goto(invite);
    const card = page.getByTestId('invite-card');
    await card.waitFor();
    assert.match(await card.textContent(), /Os Amigos/);
    assert.match(await card.textContent(), /vale até/);
    const code = invite.split('/convite/')[1];
    assert.equal(await page.getByTestId('invite-open-app').getAttribute('href'), `cosmicnight://convite/${code}`);
    assert.match(await page.getByTestId('invite-download').getAttribute('href'), /^https:\/\//);
    await signUp(page, name);
    await page.getByTestId('join-accept').click();
    await page.getByTestId('chat').waitFor();
  }
});

test('canal de voz privado: só quem foi escolhido vê; os outros nem sabem que existe', async () => {
  await createChannel(ana, 'Call Privada', 'voz', async (form) => {
    await form.getByTestId('channel-private').check();
    await form.getByTestId('channel-allow-member').and(ana.locator('[data-user="beto"]')).locator('input').check();
    await form.getByTestId('channel-user-limit').fill('3');
  });
  await waitFor(async () => (await channel(beto, 'Call Privada').count()) === 1, 'o Beto ver o canal privado');
  await beto.waitForTimeout(500);
  assert.equal(await channel(caio, 'Call Privada').count(), 0, 'o Caio não vê o canal privado');
  await createChannel(ana, 'Cinema', 'voz');
});

test('chat da chamada: conversa enquanto assiste a transmissão; quem está fora vê a não lida', async () => {
  await channel(ana, 'Sala de voz').click();
  await ana.getByTestId('voice-room').getByTestId('room').waitFor({ timeout: 20_000 });
  await ana.getByTestId('dock-share').click();
  await channel(beto, 'Sala de voz').click();
  await beto.getByTestId('voice-room').getByTestId('room').waitFor({ timeout: 20_000 });
  await beto.getByTestId('stage-owner').waitFor({ timeout: 20_000 });

  // O chat da chamada fica ao lado do palco: o Beto escreve sem parar de assistir.
  const chat = beto.getByTestId('voice-chat');
  await chat.waitFor();
  await chat.getByTestId('chat-input').fill('que jogada!');
  await chat.getByTestId('chat-input').press('Enter');
  await chat.getByTestId('chat-message').filter({ hasText: 'que jogada!' }).waitFor();
  const before = (await videoFacts(beto)).frames;
  await beto.waitForTimeout(800);
  assert.ok((await videoFacts(beto)).frames > before, 'o vídeo continuou chegando enquanto conversava');

  // A Ana vê a mensagem no chat dela; o Caio, fora da chamada, vê a não lida e abre pelo atalho do canal.
  await ana.getByTestId('voice-chat').getByTestId('chat-message').filter({ hasText: 'que jogada!' }).waitFor();
  await waitFor(async () => (await item(caio, 'Sala de voz').getAttribute('data-unread')) === 'true', 'o Caio ver a não lida no canal de voz');
  await channel(caio, 'Sala de voz').hover();
  await item(caio, 'Sala de voz').getByTestId('voice-channel-chat').click();
  await caio.getByTestId('voice-chat').getByTestId('chat-message').filter({ hasText: 'que jogada!' }).waitFor();
  assert.equal(await caio.getByTestId('voice-room').count(), 0, 'abrir o chat não entrou na chamada');
  assert.equal(await caio.getByTestId('voice-lobby').count(), 1);
});

test('arrastar: a dona leva o Beto para outro canal; o destino acende e todos veem na hora', async () => {
  const from = item(ana, 'Sala de voz').getByTestId('voice-member').and(ana.locator('[data-user="beto"]'));
  await from.dragTo(channel(ana, 'Cinema'));
  await waitFor(async () => (await peopleIn(ana, 'Cinema').filter({ hasText: 'Beto' }).count()) === 1, 'o Beto aparecer no Cinema');
  await waitFor(async () => (await peopleIn(caio, 'Cinema').filter({ hasText: 'Beto' }).count()) === 1, 'o Caio ver o Beto no Cinema');
  await beto.getByTestId('voice-room').getByTestId('room').waitFor({ timeout: 20_000 });
});

test('mover para canal sem acesso: recusa; com a concessão explícita, libera, registra e move', async () => {
  await item(caio, 'Sala de voz').getByTestId('channel').click();
  await caio.getByTestId('voice-room').getByTestId('room').waitFor({ timeout: 20_000 });
  await waitFor(async () => (await peopleIn(ana, 'Sala de voz').filter({ hasText: 'Caio' }).count()) === 1, 'o Caio entrar na Sala de voz');

  const caioRow = item(ana, 'Sala de voz').getByTestId('voice-member').and(ana.locator('[data-user="caio"]'));
  await caioRow.dragTo(channel(ana, 'Call Privada'));
  const dialog = ana.getByTestId('dialog');
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /não tem acesso a “Call Privada”/);
  await ana.getByTestId('dialog-cancel').click();
  await ana.waitForTimeout(800);
  assert.equal(await peopleIn(ana, 'Sala de voz').filter({ hasText: 'Caio' }).count(), 1, 'cancelar não move');
  assert.equal(await channel(caio, 'Call Privada').count(), 0, 'e não dá acesso');

  await caioRow.dragTo(channel(ana, 'Call Privada'));
  await ana.getByTestId('dialog-confirm').click();
  await waitFor(async () => (await peopleIn(ana, 'Call Privada').filter({ hasText: 'Caio' }).count()) === 1, 'o Caio ir para a Call Privada');
  await waitFor(async () => (await channel(caio, 'Call Privada').count()) === 1, 'o Caio passar a ver o canal');

  // Fica registrado na auditoria.
  await ana.getByTestId('group-menu').click();
  await ana.getByTestId('group-settings-open').click();
  await ana.getByTestId('settings-tab-auditoria').click();
  await waitFor(async () => /liberou o acesso/.test((await ana.getByTestId('audit-tab').textContent().catch(() => '')) ?? ''), 'a concessão aparecer na auditoria');
});
