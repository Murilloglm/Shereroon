// Conversa nos grupos, de ponta a ponta, com duas contas em dois navegadores de verdade: anexos, respostas,
// menções, reações, não lidas, notificações por canal, painéis, ordem dos canais e a chamada de voz (silenciar o
// que se ouve, mover participante). Backend real (PostgreSQL em memória) e LiveKit local.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, root, startStack, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
const shots = resolve(root, 'e2e/.artifacts');
let stack;
let anaBrowser;
let betoBrowser;
let ana;
let beto;

/** PNG de 2x2 pixels desenhado pelo próprio navegador: é o "print" que o Beto envia. */
const makePng = async (page) =>
  Buffer.from(
    await page.evaluate(() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 2, height: 2 });
      const context = canvas.getContext('2d');
      context.fillStyle = '#7c4dff';
      context.fillRect(0, 0, 2, 2);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );

const channel = (page, name) => page.getByTestId('channel').filter({ hasText: new RegExp(`^${name}$`) });
const item = (page, name) => page.getByTestId('channel-item').filter({ has: channel(page, name) });
const message = (page, text) => page.getByTestId('chat-message').filter({ hasText: text });
const shot = (page, name) => page.screenshot({ path: resolve(shots, `${name}.png`) });

async function signUp(page, username, displayName) {
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-display-name').fill(displayName);
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
}

async function say(page, text) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-input').press('Enter');
}

async function createChannel(page, name, kind = 'texto') {
  await page.getByTestId('group-menu').click();
  await page.getByTestId('group-new-channel').click();
  await page.getByTestId(`channel-kind-${kind}`).click();
  await page.getByTestId('channel-name').fill(name);
  await page.getByTestId('create-channel').locator('button[type="submit"]').click();
  await channel(page, name).waitFor();
}

before(async () => {
  mkdirSync(shots, { recursive: true });
  stack = await startStack();
  anaBrowser = await launchChrome({ headless, fakeMic: true });
  betoBrowser = await launchChrome({ headless, fakeMic: true });
  ana = await (await anaBrowser.newContext({ viewport: { width: 1672, height: 941 }, acceptDownloads: true })).newPage();
  beto = await (await betoBrowser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true })).newPage();

  await ana.goto(BASE_URL);
  await signUp(ana, 'ana', 'Ana');
  await ana.getByTestId('rail-create').click();
  await ana.getByTestId('group-name').fill('Cosmic Crew');
  await ana.getByTestId('group-create').click();
  await ana.getByTestId('chat').waitFor();
  await ana.getByTestId('group-menu').click();
  await ana.getByTestId('group-invite').click();
  await waitFor(async () => /#\/convite\//.test(await ana.getByTestId('group-invite-link').inputValue()), 'o link de convite ser gerado');
  const invite = await ana.getByTestId('group-invite-link').inputValue();
  await ana.getByRole('dialog').getByRole('button', { name: 'Fechar' }).first().click();

  await beto.goto(invite);
  await signUp(beto, 'beto', 'Beto');
  await beto.getByTestId('join-accept').click();
  await beto.getByTestId('chat').waitFor();
  await waitFor(async () => (await ana.getByTestId('groups').getAttribute('data-live')) === 'true' && (await beto.getByTestId('groups').getAttribute('data-live')) === 'true', 'os dois conectarem ao tempo real');
});

after(async () => {
  await anaBrowser?.close();
  await betoBrowser?.close();
  await stack?.stop();
});

test('anexos: a imagem aparece na conversa do outro e o documento é baixado com os mesmos bytes', async () => {
  await beto.getByTestId('chat-file').setInputFiles([
    { name: 'print.png', mimeType: 'image/png', buffer: await makePng(beto) },
    { name: 'regras.txt', mimeType: 'text/plain', buffer: Buffer.from('1. Sem spoiler.\n') },
  ]);
  await waitFor(async () => (await beto.getByTestId('upload').and(beto.locator('[data-ready="true"]')).count()) === 2, 'os dois arquivos terminarem de subir');
  await say(beto, 'olha o print e as regras');

  const received = message(ana, 'olha o print e as regras');
  await received.waitFor();
  const image = received.getByTestId('attachment-image');
  await waitFor(async () => (await image.getAttribute('data-loaded')) === 'true', 'a imagem carregar para a Ana');
  assert.equal(await image.locator('img').evaluate((node) => node.naturalWidth), 2, 'a imagem é a que o Beto enviou');

  const [download] = await Promise.all([ana.waitForEvent('download'), received.getByTestId('attachment-download').click()]);
  assert.equal(download.suggestedFilename(), 'regras.txt');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), '1. Sem spoiler.\n');

  // Ampliar a imagem e fechar com Esc.
  await image.click();
  await ana.getByTestId('lightbox').waitFor();
  await ana.keyboard.press('Escape');
  await waitFor(async () => (await ana.getByTestId('lightbox').count()) === 0, 'a imagem ampliada fechar');
});

test('resposta: mostra a mensagem original e destaca para quem foi respondido', async () => {
  await say(beto, 'alguém joga hoje?');
  const question = message(ana, 'alguém joga hoje?');
  await question.hover();
  await question.getByTestId('chat-reply').click();
  await ana.getByTestId('reply-banner').waitFor();
  await say(ana, 'eu jogo!');

  const reply = message(beto, 'eu jogo!');
  await reply.waitFor();
  assert.match(await reply.getByTestId('reply-reference').textContent(), /Beto.*alguém joga hoje\?/);
  assert.equal(await reply.getAttribute('data-mentioned'), 'true', 'a resposta conta como menção ao Beto');
  assert.equal(await ana.getByTestId('reply-banner').count(), 0, 'o aviso de resposta some depois de enviar');
});

test('menção: completar com @, destaque na mensagem e contador no canal de quem foi mencionado', async () => {
  await createChannel(ana, 'jogos');
  await channel(ana, 'geral').click();
  await channel(beto, 'jogos').click();
  await beto.getByTestId('chat-title').filter({ hasText: 'jogos' }).waitFor();

  await ana.getByTestId('chat-input').pressSequentially('partida às 22h @be');
  await ana.getByTestId('mention-option').filter({ hasText: 'Beto' }).waitFor();
  await ana.getByTestId('chat-input').press('Enter');
  assert.equal(await ana.getByTestId('chat-input').inputValue(), 'partida às 22h @beto ');
  await ana.getByTestId('chat-input').press('Enter');
  await message(ana, 'partida às 22h').getByTestId('mention').waitFor();

  // O Beto está em outro canal: #geral acende com 1 menção, e o título da janela mostra o número.
  await waitFor(async () => (await item(beto, 'geral').getAttribute('data-mentions')) === '1', 'o contador de menções aparecer para o Beto');
  assert.equal(await item(beto, 'geral').getAttribute('data-unread'), 'true');
  await waitFor(async () => (await beto.title()).startsWith('(1) '), 'o título da janela mostrar a menção');
  await shot(beto, 'conversa-nao-lida');

  await channel(beto, 'geral').click();
  await beto.getByTestId('unread-divider').waitFor();
  assert.equal(await message(beto, 'partida às 22h').getByTestId('mention').textContent(), '@Beto');
  await waitFor(async () => (await item(beto, 'geral').getAttribute('data-mentions')) === '0', 'a menção ser marcada como lida');
  // O que foi lido continua lido depois de recarregar (está no servidor, não no navegador).
  await beto.reload();
  await beto.getByTestId('chat').waitFor();
  assert.equal(await item(beto, 'geral').getAttribute('data-unread'), 'false');
});

test('reações: aparecem para os dois em tempo real e cada um tira a sua', async () => {
  const mine = message(beto, 'partida às 22h');
  await mine.hover();
  await mine.getByTestId('chat-react').click();
  await beto.getByTestId('emoji-picker').locator('[data-emoji="🔥"]').click();

  const seen = message(ana, 'partida às 22h').getByTestId('reaction').and(ana.locator('[data-emoji="🔥"]'));
  await seen.waitFor();
  assert.equal(await seen.getByTestId('reaction-count').textContent(), '1');
  await seen.click();
  await waitFor(async () => (await mine.getByTestId('reaction-count').textContent()) === '2', 'a reação da Ana chegar ao Beto');
  assert.equal(await mine.getByTestId('reaction').getAttribute('aria-pressed'), 'true');

  await mine.getByTestId('reaction').click();
  await waitFor(async () => (await seen.getByTestId('reaction-count').textContent()) === '1', 'a reação do Beto sair');
  await shot(ana, 'conversa-chat');
});

test('fixar: a mensagem entra na lista de fixadas, que leva de volta a ela', async () => {
  // A resposta da Ana cita o mesmo texto: a primeira é a mensagem original.
  const target = message(ana, 'alguém joga hoje?').first();
  await target.hover();
  await target.getByTestId('chat-pin').click();
  await beto.getByTestId('chat-pins').click();
  const pinned = beto.getByTestId('pinned-message');
  await pinned.waitFor();
  assert.match(await pinned.textContent(), /alguém joga hoje\?/);
  await pinned.getByRole('button', { name: 'Ir para a mensagem' }).click();
  assert.equal(await beto.getByTestId('pins-panel').count(), 0);
});

test('notificações por canal: silenciado não acende; a escolha fica guardada no servidor', async () => {
  await beto.getByTestId('chat-notify').click();
  await beto.getByTestId('notify-nada').click();
  await channel(beto, 'jogos').click();
  await beto.getByTestId('chat-title').filter({ hasText: 'jogos' }).waitFor();

  await say(ana, 'isso o @beto não quer ver agora');
  await message(ana, 'não quer ver agora').waitFor();
  await say(ana, 'chegou esta em jogos?');
  await ana.waitForTimeout(600);
  assert.equal(await item(beto, 'geral').getAttribute('data-unread'), 'false', 'canal silenciado não fica como não lido');
  assert.equal(await item(beto, 'geral').getAttribute('data-mentions'), '0');

  await beto.reload();
  await beto.getByTestId('chat').waitFor();
  assert.equal(await item(beto, 'geral').getAttribute('data-unread'), 'false', 'a escolha vale depois de recarregar');
  await channel(beto, 'geral').click();
  await beto.getByTestId('chat-notify').click();
  assert.equal(await beto.getByTestId('notify-nada').getAttribute('class').then((value) => /bg-brand-500\/15/.test(value)), true, 'o menu mostra o nível escolhido');
  await beto.getByTestId('notify-herdar').click();
});

test('painéis: recolher membros, redimensionar canais pelo teclado e manter depois de recarregar', async () => {
  await ana.getByTestId('members-panel').waitFor();
  await ana.getByTestId('toggle-members').click();
  await waitFor(async () => (await ana.getByTestId('members-panel').count()) === 0, 'a lista de membros recolher');

  const width = async () => Math.round((await ana.getByTestId('channels-panel').boundingBox()).width);
  const before = await width();
  await ana.getByTestId('resizer-canais').focus();
  await ana.keyboard.press('ArrowRight');
  await ana.keyboard.press('ArrowRight');
  await waitFor(async () => (await width()) === before + 32, 'a coluna de canais alargar');

  await ana.reload();
  await ana.getByTestId('chat').waitFor();
  assert.equal(await width(), before + 32);
  assert.equal(await ana.getByTestId('members-panel').count(), 0);
  await ana.getByTestId('toggle-members').click();
  await ana.getByTestId('members-panel').waitFor();

  await ana.getByTestId('toggle-channels').click();
  await waitFor(async () => (await ana.getByTestId('channels-panel').count()) === 0, 'a coluna de canais recolher');
  await ana.getByTestId('toggle-channels').click();
  await ana.getByTestId('channels-panel').waitFor();
});

test('arrastar canais: a dona reorganiza e a nova ordem chega ao outro membro', async () => {
  // Canais dentro da categoria "Canais de texto", na ordem em que aparecem.
  const inCategory = (page) =>
    page
      .locator('section')
      .filter({ has: page.getByTestId('category').and(page.locator('[data-name="Canais de texto"]')) })
      .getByTestId('channel')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.name));
  // "jogos" foi criado fora das categorias: começa solto, no topo da lista.
  assert.deepEqual(await inCategory(ana), ['geral']);
  await item(ana, 'jogos').dragTo(item(ana, 'geral'));
  await waitFor(async () => JSON.stringify(await inCategory(ana)) === JSON.stringify(['jogos', 'geral']), 'o canal entrar na categoria, antes de geral');
  await waitFor(async () => JSON.stringify(await inCategory(beto)) === JSON.stringify(['jogos', 'geral']), 'a nova ordem chegar ao Beto');
  // Arrastar de volta: "geral" passa para antes de "jogos".
  await item(ana, 'geral').dragTo(item(ana, 'jogos'));
  await waitFor(async () => JSON.stringify(await inCategory(beto)) === JSON.stringify(['geral', 'jogos']), 'a segunda mudança chegar ao Beto');
  // O Beto não gerencia canais: para ele os canais não são arrastáveis.
  assert.equal(await item(beto, 'geral').getAttribute('draggable'), null);
  assert.equal(await item(ana, 'geral').getAttribute('draggable'), 'true');
});

test('voz: entrar com um clique, silenciar o que se ouve, e a dona move o outro de canal', async () => {
  await createChannel(ana, 'Cinema', 'voz');
  await channel(beto, 'Sala de voz').click();
  await beto.getByTestId('voice-room').getByTestId('room').waitFor({ timeout: 20_000 });
  await channel(ana, 'Sala de voz').click();
  await ana.getByTestId('voice-room').getByTestId('room').waitFor({ timeout: 20_000 });
  await waitFor(async () => (await ana.getByTestId('channel-voice-people').locator('[data-user]').count()) === 2, 'os dois aparecerem no canal de voz');

  // Microfone pelo painel do usuário; quem está no canal vê o estado mudar.
  assert.equal(await ana.getByTestId('user-mic').getAttribute('aria-pressed'), 'false', 'o microfone entra desligado');
  await ana.getByTestId('user-mic').click();
  await waitFor(async () => (await ana.getByTestId('user-mic').getAttribute('aria-pressed')) === 'true', 'o microfone da Ana ligar');

  // Silenciar tudo o que se ouve e voltar.
  await beto.getByTestId('user-deafen').click();
  assert.equal(await beto.getByTestId('user-deafen').getAttribute('aria-pressed'), 'true');
  await beto.getByTestId('user-deafen').click();
  assert.equal(await beto.getByTestId('user-deafen').getAttribute('aria-pressed'), 'false');

  // Continua na chamada enquanto conversa por texto.
  await channel(beto, 'geral').click();
  await beto.getByTestId('chat').waitFor();
  await beto.getByTestId('voice-bar').waitFor();
  await say(beto, 'falando daqui da chamada');
  await shot(ana, 'conversa-voz');

  // A dona move o Beto para o canal "Cinema".
  await ana.getByTestId('voice-person-menu').click();
  await ana.getByRole('menuitem', { name: 'Mover para Cinema' }).click();
  await waitFor(async () => (await item(ana, 'Cinema').getByTestId('channel-voice-people').locator('[data-user="beto"]').count()) === 1, 'o Beto aparecer no canal Cinema');
  await waitFor(async () => (await item(ana, 'Sala de voz').getByTestId('channel-voice-people').locator('[data-user="beto"]').count()) === 0, 'o Beto sair do canal anterior');

  await beto.getByTestId('voice-bar-leave').click();
  await waitFor(async () => (await ana.getByTestId('channel-voice-people').locator('[data-user="beto"]').count()) === 0, 'o Beto sair da chamada');
  await ana.getByTestId('voice-bar-leave').click();
});

test('bots: a dona instala um bot da biblioteca, ele entra como membro, e ela desliga e remove', async () => {
  await ana.getByTestId('group-menu').click();
  await ana.getByTestId('group-settings-open').click();
  await ana.getByTestId('settings-tab-bots').click();
  const library = ana.getByTestId('library-bot').first();
  await library.waitFor();
  const botId = await library.getAttribute('data-bot');
  await library.getByTestId('bot-install').click();

  const installed = ana.getByTestId('installed-bot').and(ana.locator(`[data-bot="${botId}"]`));
  await installed.waitFor();
  // Recém-instalado, o bot já roda; alguns avisam que ainda falta escolher um canal nas opções.
  assert.match(await installed.getByTestId('bot-status').getAttribute('data-state'), /^(ativo|aviso)$/);
  // O bot é um membro do grupo: aparece na lista de membros do Beto sem recarregar.
  await waitFor(async () => (await beto.getByTestId('member').count()) === 3, 'o bot aparecer como membro para o Beto');
  await waitFor(async () => (await beto.getByTestId('member-section').and(beto.locator('[data-section="Bots"]')).count()) === 1, 'o bot aparecer na categoria Bots');

  // Fora da lista: some da lista do Beto, mas continua acessível no fim dela (só aparência).
  await installed.getByTestId('bot-configure').click();
  await installed.getByTestId('bot-member-list').selectOption('ocultar');
  await waitFor(async () => (await beto.getByTestId('member').count()) === 2, 'o bot sair da lista do Beto');
  await beto.getByTestId('hidden-bots').click();
  await waitFor(async () => (await beto.getByTestId('member').count()) === 3, 'o bot aparecer ao abrir os bots fora da lista');
  assert.equal(await beto.getByTestId('member-bot-tag').count(), 1, 'com a marca BOT');
  await beto.getByTestId('hidden-bots').click();
  await installed.getByTestId('bot-member-list').selectOption('categoria');
  await installed.getByTestId('bot-configure').click();

  await installed.getByRole('switch').click();
  await waitFor(async () => (await installed.getByTestId('bot-status').getAttribute('data-state')) === 'desativado', 'o bot ser desligado');

  await installed.getByTestId('bot-configure').click();
  await installed.getByTestId('bot-remove').click();
  await ana.getByTestId('dialog-confirm').click();
  await waitFor(async () => (await ana.getByTestId('installed-bot').count()) === 0, 'o bot sair da lista de instalados');
  await waitFor(async () => (await beto.getByTestId('member').count()) === 2, 'o bot sair da lista de membros');
  // Boas-vindas num canal só de leitura (@everyone sem "Enviar mensagens"): escolher o canal de saída liga o
  // aviso na tela, e salvar libera o cargo do bot nos dois canais, com o aviso do que foi liberado.
  const api = (method, path, body) =>
    ana.evaluate(
      async ([method, path, body]) => {
        const response = await fetch(path, { method, headers: { authorization: `Bearer ${localStorage.getItem('shareroom:conta')}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        return response.json();
      },
      [method, path, body],
    );
  const groupId = (await api('GET', '/api/groups')).groups[0].id;
  const everyone = (await api('GET', `/api/groups/${groupId}`)).roles.find((role) => role.isEveryone).id;
  for (const name of ['bem-vindos', 'saida']) {
    const { id } = await api('POST', `/api/groups/${groupId}/channels`, { kind: 'texto', name });
    await api('PUT', `/api/channels/${id}/overrides/cargo/${everyone}`, { allow: '0', deny: String(1n << 9n) });
  }
  await ana.getByTestId('library-bot').and(ana.locator('[data-bot="boas-vindas"]')).getByTestId('bot-install').click();
  const welcome = ana.getByTestId('installed-bot').and(ana.locator('[data-bot="boas-vindas"]'));
  await welcome.waitFor();
  await welcome.getByTestId('bot-configure').click();
  await welcome.locator('[data-field="canalEntrada"] select').selectOption({ label: '#bem-vindos' });
  const leaveToggle = welcome.locator('[data-field="avisarSaida"]').getByRole('switch');
  assert.equal(await leaveToggle.getAttribute('aria-checked'), 'false');
  await welcome.locator('[data-field="canalSaida"] select').selectOption({ label: '#saida' });
  assert.equal(await leaveToggle.getAttribute('aria-checked'), 'true', 'escolher o canal de saída liga o aviso');
  await welcome.getByTestId('bot-save').click();
  await ana.getByText('Configuração salva. O bot agora pode escrever em #bem-vindos e #saida.').waitFor();
  await waitFor(async () => (await welcome.getByTestId('bot-status').getAttribute('data-state')) === 'ativo', 'o bot ficar ativo, sem aviso de canal');
  await welcome.getByTestId('bot-configure').click();
  await welcome.getByTestId('bot-remove').click();
  await ana.getByTestId('dialog-confirm').click();
  await waitFor(async () => (await ana.getByTestId('installed-bot').count()) === 0, 'o bot de boas-vindas sair');

  // O Beto não tem permissão de bots: a aba nem aparece para ele.
  await ana.getByRole('dialog').getByRole('button', { name: 'Fechar' }).first().click();
  await beto.getByTestId('group-menu').click();
  await beto.getByTestId('group-settings-open').click();
  assert.equal(await beto.getByTestId('settings-tab-bots').count(), 0);
  await beto.getByRole('dialog').getByRole('button', { name: 'Fechar' }).first().click();
});
