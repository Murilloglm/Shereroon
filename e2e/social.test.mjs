// Perfis, menu de botão direito, amizades, apelidos e notas pessoais, mensagens privadas (com anexo, resposta,
// reação, edição e convite para grupo), bloqueio e o painel de moderação, com três contas de verdade.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, startStack, waitFor } from './harness.mjs';
import { bmpFile, imageShows, pngFile } from './images.mjs';

const headless = process.env.E2E_HEADLESS === '1';
let stack;
const browsers = [];
let ana;
let beto;
let caio;

async function open() {
  const browser = await launchChrome({ headless });
  browsers.push(browser);
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 920 } })).newPage();
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

/** Mensagem pelo texto exato (a citação de uma resposta não conta). */
const bubble = (chat, text) => chat.getByTestId('dm-message').filter({ has: chat.page().getByTestId('dm-content').getByText(text, { exact: true }) });
const member = (page, username) => page.getByTestId('member').and(page.locator(`[data-user="${username}"]`));
const memberTrigger = (page, username) => member(page, username).locator('[data-user-trigger]');

before(async () => {
  stack = await startStack();
  [ana, beto, caio] = [await open(), await open(), await open()];
  await ana.goto(BASE_URL);
  await signUp(ana, 'ana');
  await ana.getByTestId('rail-create').click();
  await ana.getByTestId('group-name').fill('Os Amigos');
  await ana.getByTestId('group-create').click();
  await ana.getByTestId('chat').waitFor();
  await ana.getByTestId('group-menu').click();
  await ana.getByTestId('group-invite').click();
  await waitFor(async () => /#\/convite\//.test(await ana.getByTestId('group-invite-link').inputValue()), 'o convite ser gerado');
  const invite = await ana.getByTestId('group-invite-link').inputValue();
  await ana.getByRole('dialog', { name: /Convidar para/ }).getByRole('button', { name: 'Fechar' }).first().click();
  for (const [page, name] of [[beto, 'beto'], [caio, 'caio']]) {
    await page.goto(invite);
    await signUp(page, name);
    await page.getByTestId('join-accept').click();
    await page.getByTestId('chat').waitFor();
  }
});

after(async () => {
  for (const browser of browsers) await browser.close();
  await stack?.stop();
});

const longText = 'palavras e emoji 🌙 '.repeat(10) + '\n' + 'x'.repeat(400) + '\nhttps://example.org/' + 'z'.repeat(400);

async function checkMessageWidth(page, list, content) {
  const before = page.viewportSize();
  await page.setViewportSize({ width: 720, height: 650 });
  try {
    await content.waitFor({state:'visible'});
    await waitFor(() => content.evaluate(node => node.clientWidth > 0 && node.scrollWidth <= node.clientWidth + 1), 'texto longo cabe na largura');
    assert(await list.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    assert.equal(await content.locator('a').count(), 1);
  } finally { await page.setViewportSize(before); }
}

test('mensagens de canal quebram linhas e preservam grupos após recarregar', async () => {
  await ana.locator('[data-testid="channel"][aria-current="true"]').click();
  const input = ana.getByTestId('chat-input');
  await input.fill('Primeira da sequência'); await input.press('Enter');
  await ana.getByTestId('chat-message').filter({hasText:'Primeira da sequência'}).waitFor();
  await input.fill(longText); await input.press('Enter');
  const list = ana.getByTestId('chat-messages');
  const row = list.getByTestId('chat-message').filter({hasText:'x'.repeat(400)});
  await row.waitFor();
  assert.equal(await row.getAttribute('data-grouped'), 'true');
  await checkMessageWidth(ana, list, row.locator('p').filter({hasText:'x'.repeat(400)}));
  await ana.reload(); await row.waitFor();
  assert.equal(await row.getAttribute('data-grouped'), 'true');
});

test('perfil: bio, status e foto enviada com prévia; os outros veem no cartão ao clicar', async () => {
  await ana.getByTestId('account-menu').click();
  const editor = ana.getByTestId('profile-editor');
  await editor.waitFor();
  await editor.getByTestId('profile-status-input').fill('no lobby');
  await editor.getByTestId('profile-bio-input').fill('Jogo à noite e faço lives.');
  await editor.getByTestId('profile-save').click();
  await waitFor(async () => (await editor.getByTestId('profile-save').isDisabled()), 'o perfil salvar');
  await editor.getByTestId('profile-avatar-file').setInputFiles(pngFile('avatar.png', 128, 128));
  await ana.getByTestId('profile-upload-preview').waitFor();
  await ana.getByTestId('profile-upload-confirm').click();
  await ana.getByTestId('profile-upload-preview').waitFor({ state: 'detached' });
  await waitFor(async () => (await editor.getByTestId('profile-preview').locator('[data-avatar="foto"]').count()) === 1, 'a foto aparecer na prévia');
  await waitFor(() => imageShows(editor.getByTestId('profile-preview').locator('[data-avatar="foto"] img').first()), 'a foto carregar de verdade');

  // Qualquer imagem: um BMP (que o servidor não guarda) é convertido no app e aparece; uma imagem enorme é reduzida.
  for (const file of [bmpFile('avatar.bmp', 96, 80), pngFile('enorme.png', 3000, 2400)]) {
    const before = await editor.getByTestId('profile-preview').locator('[data-avatar="foto"] img').first().getAttribute('src');
    await editor.getByTestId('profile-avatar-file').setInputFiles(file);
    await ana.getByTestId('profile-upload-preview').waitFor();
    await ana.getByTestId('profile-upload-confirm').click();
    await ana.getByTestId('profile-upload-preview').waitFor({ state: 'detached' });
    const photo = editor.getByTestId('profile-preview').locator('[data-avatar="foto"] img').first();
    await waitFor(async () => (await photo.getAttribute('src')) !== before && (await imageShows(photo)), `a foto nova (${file.split(/[\\/]/).pop()}) aparecer`);
  }
  assert.equal(await ana.getByTestId('dialog').count(), 0, 'nenhuma imagem foi recusada');
  await ana.getByRole('dialog', { name: 'Configurações' }).getByRole('button', { name: 'Fechar' }).first().click();

  await waitFor(async () => (await member(beto, 'ana').locator('[data-avatar="foto"]').count()) === 1, 'o Beto ver a foto da Ana na lista');
  await memberTrigger(beto, 'ana').click();
  const card = beto.getByTestId('profile-card');
  await card.waitFor();
  await waitFor(async () => /Jogo à noite/.test((await card.textContent()) ?? ''), 'a bio aparecer no cartão');
  assert.match(await card.getByTestId('profile-status').textContent(), /no lobby/);
  assert.equal(await card.getByTestId('profile-moderate').count(), 0, 'membro comum não vê "Abrir como moderador"');
  await beto.keyboard.press('Escape');
});

test('pesquisa de membros: pelo nome ou usuário, abre o perfil pelo resultado; "ninguém encontrado"', async () => {
  const search = beto.getByTestId('member-search');
  await search.fill('CAI');
  const results = beto.getByTestId('member-results');
  await results.waitFor();
  assert.deepEqual(await results.getByTestId('member').evaluateAll((items) => items.map((item) => item.dataset.user)), ['caio']);
  await results.getByTestId('member').locator('[data-user-trigger]').click();
  await beto.getByTestId('profile-card').waitFor();
  await beto.keyboard.press('Escape');
  await search.fill('@ana');
  assert.deepEqual(await results.getByTestId('member').evaluateAll((items) => items.map((item) => item.dataset.user)), ['ana']);
  await search.fill('ninguem-com-esse-nome');
  assert.match(await results.textContent(), /Ninguém encontrado/);
  await search.fill('');
  assert.equal(await beto.getByTestId('member-results').count(), 0, 'sem pesquisa, volta a lista por cargos');
});

test('menu de botão direito: amizade, apelido e nota pessoais (só quem criou vê)', async () => {
  await memberTrigger(beto, 'ana').click({ button: 'right' });
  const menu = beto.getByTestId('user-menu');
  await menu.waitFor();
  await menu.getByTestId('menu-add-friend').click();
  await ana.getByTestId('rail-dms').click();
  await ana.getByTestId('friends-tab-pendentes').click();
  await ana.getByTestId('friend-row').and(ana.locator('[data-user="beto"]')).getByTestId('friend-accept').click();
  await ana.getByTestId('friends-tab-todos').click();
  await ana.getByTestId('friend-row').and(ana.locator('[data-user="beto"][data-state="amigos"]')).waitFor();

  await memberTrigger(beto, 'ana').click({ button: 'right' });
  await beto.getByTestId('menu-nickname').click();
  await beto.getByTestId('dialog-input').fill('Aninha');
  await beto.getByTestId('dialog-confirm').click();
  await waitFor(async () => (await member(beto, 'ana').getByTestId('member-name').textContent()) === 'Aninha', 'o Beto ver o apelido que deu');
  assert.equal(await member(caio, 'ana').getByTestId('member-name').textContent(), 'Ana', 'o Caio continua vendo o nome da Ana');

  await memberTrigger(beto, 'ana').click({ button: 'right' });
  await beto.getByTestId('menu-note').click();
  await beto.getByTestId('dialog-input').fill('me deve uma pizza');
  await beto.getByTestId('dialog-confirm').click();
  await memberTrigger(beto, 'ana').click();
  await beto.getByTestId('profile-note').waitFor();
  assert.match(await beto.getByTestId('profile-note').textContent(), /pizza/);
  await beto.keyboard.press('Escape');
  await memberTrigger(caio, 'ana').click();
  await caio.getByTestId('profile-card').getByTestId('profile-name').waitFor();
  assert.equal(await caio.getByTestId('profile-note').count(), 0, 'a nota não aparece para o Caio');
  await caio.keyboard.press('Escape');
});

test('mensagem privada: não lida, resposta, reação, edição, exclusão e anexo; sincroniza nos dois lados', async () => {
  await memberTrigger(beto, 'ana').click({ button: 'right' });
  await beto.getByTestId('menu-message').click();
  const chat = beto.getByTestId('dm-chat');
  await chat.waitFor();
  await chat.getByTestId('dm-input').fill(longText); await chat.getByTestId('dm-input').press('Enter');
  const long = chat.getByTestId('dm-content').filter({hasText:'x'.repeat(400)});
  await long.waitFor(); await checkMessageWidth(beto, chat.getByTestId('dm-messages'), long);
  await chat.getByTestId('dm-input').fill('oi, Ana!');
  await chat.getByTestId('dm-input').press('Enter');
  await bubble(chat, 'oi, Ana!').waitFor();

  await waitFor(async () => (await ana.getByTestId('rail-dm-unread').count()) === 1, 'a Ana ver a mensagem não lida');
  await ana.getByTestId('dm-conversation').and(ana.locator('[data-user="beto"]')).click();
  const anaChat = ana.getByTestId('dm-chat');
  const first = bubble(anaChat, 'oi, Ana!');
  await first.waitFor();
  assert.equal(await first.getAttribute('data-grouped'), 'true');
  assert.equal(await first.locator('header').count(), 0);
  await waitFor(async () => (await ana.getByTestId('rail-dm-unread').count()) === 0, 'a não lida sumir ao ler');

  await first.hover();
  await first.getByTestId('dm-reply').click();
  await anaChat.getByTestId('dm-input').fill('oi, Beto!');
  await anaChat.getByTestId('dm-input').press('Enter');
  await bubble(chat, 'oi, Beto!').getByTestId('dm-reply-quote').waitFor();
  await first.hover();
  await first.getByTestId('dm-react').click();
  await ana.getByRole('button', { name: '😂' }).first().click();
  await bubble(chat, 'oi, Ana!').getByTestId('dm-reaction').waitFor();

  // Editar e apagar só as próprias.
  const mine = bubble(chat, 'oi, Ana!');
  await mine.hover();
  await mine.getByTestId('dm-edit').click();
  await chat.getByTestId('dm-edit-input').fill('olá, Ana!');
  await chat.getByTestId('dm-edit-input').press('Enter');
  await bubble(anaChat, 'olá, Ana!').waitFor();
  const theirs = bubble(chat, 'oi, Beto!');
  await theirs.hover();
  assert.equal(await theirs.getByTestId('dm-edit').count(), 0, 'não dá para editar a mensagem da outra pessoa');
  await chat.getByTestId('dm-input').fill('mensagem errada');
  await chat.getByTestId('dm-input').press('Enter');
  const wrong = bubble(chat, 'mensagem errada');
  await wrong.hover();
  await wrong.getByTestId('dm-delete').click();
  await beto.getByTestId('dialog-confirm').click();
  await waitFor(async () => (await bubble(anaChat, 'mensagem errada').count()) === 0, 'a mensagem apagada sumir para a Ana');

  // Imagem anexada aparece para os dois.
  await chat.getByTestId('dm-file').setInputFiles(pngFile('foto-dm.png', 60, 40));
  await waitFor(async () => !(await chat.getByTestId('dm-send').isDisabled()), 'o anexo terminar de subir');
  await chat.getByTestId('dm-send').click();
  await anaChat.locator('[data-testid="attachment-image"][data-loaded="true"]').waitFor({ timeout: 15_000 });
});

test('convite para um grupo pela conversa: o amigo entra pelo cartão', async () => {
  await ana.getByTestId('rail-create').click();
  await ana.getByTestId('group-name').fill('Grupo das Lives');
  await ana.getByTestId('group-create').click();
  await ana.getByTestId('chat').waitFor();
  await ana.getByTestId('rail-dms').click();
  await ana.getByTestId('dm-conversation').and(ana.locator('[data-user="beto"]')).click();
  await ana.getByTestId('dm-invite').click();
  await ana.getByTestId('dm-invite-group').and(ana.locator('[data-name="Grupo das Lives"]')).click();
  const card = beto.getByTestId('dm-invite-card');
  await card.waitFor();
  assert.match(await card.textContent(), /Grupo das Lives/);
  await card.getByTestId('dm-invite-join').click();
  await waitFor(async () => (await beto.getByTestId('group-title').textContent().catch(() => '')) === 'Grupo das Lives', 'o Beto abrir o grupo novo');
});

test('bloqueio: quem foi bloqueado não manda mensagem nem pedido', async () => {
  await caio.getByTestId('rail-group').and(caio.locator('[data-name="Os Amigos"]')).click();
  await memberTrigger(caio, 'beto').click({ button: 'right' });
  await caio.getByTestId('menu-block').click();
  await caio.getByTestId('dialog-confirm').click();
  await beto.getByTestId('rail-group').and(beto.locator('[data-name="Os Amigos"]')).click();
  await memberTrigger(beto, 'caio').click();
  const card = beto.getByTestId('profile-card');
  await card.getByTestId('profile-message').waitFor();
  await waitFor(async () => card.getByTestId('profile-message').isDisabled(), 'o botão de mensagem ficar desligado');
  await beto.keyboard.press('Escape');
});

test('painel de moderação: só a dona abre; mostra entrada, atividade e registra o castigo', async () => {
  await ana.getByTestId('rail-group').and(ana.locator('[data-name="Os Amigos"]')).click();
  await ana.getByTestId('chat-input').waitFor();
  await memberTrigger(ana, 'caio').click({ button: 'right' });
  await ana.getByTestId('menu-moderate').click();
  const panel = ana.getByTestId('moderation-panel');
  await panel.waitFor();
  assert.match(await panel.getByTestId('moderation-joined').textContent(), /Por convite/);
  await panel.getByTestId('moderation-timeout').selectOption('10');
  await waitFor(async () => /mudou o castigo/.test((await panel.getByTestId('moderation-history').textContent().catch(() => '')) ?? ''), 'o castigo aparecer no histórico');
  await ana.getByRole('dialog', { name: /Moderação/ }).getByRole('button', { name: 'Fechar' }).first().click();

  await memberTrigger(beto, 'caio').click({ button: 'right' });
  await beto.getByTestId('user-menu').waitFor();
  assert.equal(await beto.getByTestId('menu-moderate').count(), 0, 'membro comum não tem a opção');
  await beto.keyboard.press('Escape');
});

test('emojis do grupo: a dona envia, usa na mensagem e outra pessoa reage com ele', async () => {
  await ana.getByTestId('group-menu').click();
  await ana.getByTestId('group-settings-open').click();
  await ana.getByTestId('settings-tab-emojis').click();
  await ana.getByTestId('emoji-name').fill('festa');
  await ana.getByTestId('emoji-file').setInputFiles(pngFile('festa.png', 64, 64));
  await ana.getByTestId('emoji-add').click();
  await ana.getByTestId('emoji-row').and(ana.locator('[data-name="festa"]')).waitFor();
  await ana.getByRole('dialog', { name: /Configurações de/ }).getByRole('button', { name: 'Fechar' }).first().click();

  await ana.getByTestId('chat-input').fill('bora :festa:');
  await ana.getByTestId('chat-input').press('Enter');
  const message = beto.getByTestId('chat-message').filter({ hasText: 'bora' }).last();
  await message.locator('img[alt=":festa:"]').waitFor();
  await message.hover();
  await message.getByTestId('chat-react').click();
  await beto.getByTestId('emoji-picker').locator('[data-emoji=":festa:"]').click();
  await ana.getByTestId('chat-message').filter({ hasText: 'bora' }).last().locator('[data-emoji=":festa:"]').waitFor();
});
