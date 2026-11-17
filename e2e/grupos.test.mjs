// Grupos, canais, cargos e voz, de ponta a ponta: duas pessoas em dois navegadores de verdade, falando com o
// backend de verdade (banco PostgreSQL em memória) e com o LiveKit local.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, sourcePageHtml, startStack, videoFacts, waitFor } from './harness.mjs';

const noWindows = process.env.E2E_HEADLESS === '1';
let stack;
let anaBrowser;
let betoBrowser;
let ana;
let beto;
let inviteLink;

const channel = (page, name) => page.getByTestId('channel').filter({ hasText: new RegExp(`^${name}$`) });
const member = (page, username) => page.getByTestId('member').and(page.locator(`[data-user="${username}"]`));
const toast = (page) => page.getByRole('status');
const openSettings = async (page, tab) => {
  await page.getByTestId('group-menu').click();
  await page.getByTestId('group-settings-open').click();
  await page.getByTestId(`settings-tab-${tab}`).click();
};
const closeDialog = (page, name) => page.getByRole('dialog', { name }).getByRole('button', { name: 'Fechar' }).first().click();

async function signUp(page, username, displayName) {
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-display-name').fill(displayName);
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
}

before(async () => {
  stack = await startStack();
  anaBrowser = await launchChrome({ captureTitle: 'sr-fonte-grupos', headless: noWindows });
  betoBrowser = await launchChrome({ headless: noWindows });
  const context = await anaBrowser.newContext({ viewport: { width: 1672, height: 941 } });
  await (await context.newPage()).setContent(sourcePageHtml('sr-fonte-grupos', 0));
  ana = await context.newPage();
  beto = await (await betoBrowser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
});

after(async () => {
  await anaBrowser?.close();
  await betoBrowser?.close();
  await stack?.stop();
});

test('conta e primeiro grupo: nasce com canais e a dona aparece online', async () => {
  await ana.goto(BASE_URL);
  await signUp(ana, 'ana', 'Ana');
  await ana.getByTestId('groups').waitFor();
  await ana.getByTestId('rail-create').click();
  await ana.getByTestId('group-name').fill('Os Amigos');
  await ana.getByTestId('group-create').click();
  await ana.getByTestId('chat').waitFor();
  assert.equal(await ana.getByTestId('group-title').textContent(), 'Os Amigos');
  assert.equal(await ana.getByTestId('chat-title').textContent(), 'geral');
  assert.deepEqual(await ana.getByTestId('channel').evaluateAll((nodes) => nodes.map((node) => `${node.dataset.kind}:${node.dataset.name}`)), ['texto:geral', 'voz:Sala de voz']);
  await waitFor(async () => (await ana.getByTestId('groups').getAttribute('data-live')) === 'true', 'o tempo real conectar');
  await waitFor(async () => (await member(ana, 'ana').getAttribute('data-online')) === 'true', 'a dona aparecer online');
  // Recarregar não derruba a sessão nem o grupo.
  await ana.reload();
  await ana.getByTestId('chat').waitFor();
  assert.equal(await ana.getByTestId('group-title').textContent(), 'Os Amigos');
});

test('convite: outra pessoa cria conta pelo link e entra; a presença aparece em tempo real', async () => {
  await ana.getByTestId('group-menu').click();
  await ana.getByTestId('group-invite').click();
  await waitFor(async () => /#\/convite\//.test(await ana.getByTestId('group-invite-link').inputValue()), 'o link de convite ser gerado');
  inviteLink = await ana.getByTestId('group-invite-link').inputValue();
  await closeDialog(ana, /Convidar para/);

  await beto.goto(inviteLink);
  await signUp(beto, 'beto', 'Beto');
  const preview = beto.getByTestId('join-preview');
  await preview.waitFor();
  assert.match(await preview.textContent(), /Os Amigos/);
  assert.match(await preview.textContent(), /1 membro/);
  await beto.getByTestId('join-accept').click();
  await beto.getByTestId('chat').waitFor();
  assert.equal(await beto.getByTestId('group-title').textContent(), 'Os Amigos');

  await waitFor(async () => (await member(ana, 'beto').count()) === 1 && (await member(ana, 'beto').getAttribute('data-online')) === 'true', 'a Ana ver o Beto online sem recarregar');
});

test('chat em tempo real: enviar, editar e apagar; a dona apaga a mensagem de outro', async () => {
  await ana.getByTestId('chat-input').fill('oi, Beto!');
  await ana.getByTestId('chat-input').press('Enter');
  const received = beto.getByTestId('chat-message').filter({ hasText: 'oi, Beto!' });
  await received.waitFor();
  assert.equal(await received.getByTestId('chat-author').textContent(), 'Ana');

  await beto.getByTestId('chat-input').fill('oi, Ana! veja https://exemplo.com/pagina');
  await beto.getByTestId('chat-send').click();
  const reply = ana.getByTestId('chat-message').filter({ hasText: 'oi, Ana!' });
  await reply.waitFor();
  assert.equal(await reply.getByRole('link').getAttribute('href'), 'https://exemplo.com/pagina');
  assert.equal(await reply.getByRole('link').getAttribute('rel'), 'noreferrer noopener');

  // O Beto não tem como apagar a mensagem da Ana: o botão nem aparece para ele.
  await received.hover();
  assert.equal(await received.getByTestId('chat-delete').count(), 0);
  // A dona apaga a do Beto, e ela some para os dois.
  await reply.hover();
  await reply.getByTestId('chat-delete').click();
  await ana.getByTestId('dialog-confirm').click();
  await waitFor(async () => (await beto.getByTestId('chat-message').filter({ hasText: 'oi, Ana!' }).count()) === 0, 'a mensagem apagada sumir para o Beto');

  // Conteúdo com marcação não vira HTML.
  await beto.getByTestId('chat-input').fill('<img src=x onerror="window.invadido=1"> <b>negrito</b>');
  await beto.getByTestId('chat-input').press('Enter');
  const raw = ana.getByTestId('chat-message').filter({ hasText: '<b>negrito</b>' });
  await raw.waitFor();
  assert.equal(await raw.locator('img, b').count(), 0);
  assert.equal(await ana.evaluate(() => window.invadido), undefined);
});

test('cargos: criar pelo modelo, dar a um membro e ver a cor e o cargo na lista dos dois', async () => {
  await openSettings(ana, 'cargos');
  assert.deepEqual(await ana.getByTestId('role-item').evaluateAll((nodes) => nodes.map((node) => node.dataset.role)), ['Administrador', 'Moderador', '@everyone']);
  await ana.getByTestId('role-new').click();
  await ana.getByRole('menuitem', { name: 'VIP' }).click();
  await waitFor(async () => (await ana.getByTestId('role-editor').getAttribute('data-role')) === 'VIP', 'o cargo VIP abrir no editor');
  assert.equal(await ana.getByTestId('perm-MENTION_EVERYONE').getByRole('switch').getAttribute('aria-checked'), 'true');
  assert.equal(await ana.getByTestId('perm-KICK_MEMBERS').getByRole('switch').getAttribute('aria-checked'), 'false');
  // Cargo novo nasce no pé da lista, logo acima do @everyone.
  assert.deepEqual(await ana.getByTestId('role-item').evaluateAll((nodes) => nodes.map((node) => node.dataset.role)), ['Administrador', 'Moderador', 'VIP', '@everyone']);

  await ana.getByTestId('settings-tab-membros').click();
  const row = ana.getByTestId('member-row').and(ana.locator('[data-user="beto"]'));
  await row.getByTestId('member-roles').click();
  await ana.getByTestId('member-role-VIP').click();
  await waitFor(async () => (await row.getByTestId('member-role').filter({ hasText: 'VIP' }).count()) === 1, 'o cargo aparecer no membro');
  await closeDialog(ana, /Configurações de/);

  for (const page of [ana, beto]) {
    await waitFor(async () => (await member(page, 'beto').getByTestId('member-top-role').textContent().catch(() => '')) === 'VIP', 'o cargo aparecer na lista de membros');
    assert.equal(await member(page, 'beto').getByTestId('member-name').evaluate((node) => getComputedStyle(node.parentElement).color), 'rgb(251, 191, 36)');
  }
});

test('canal privado: só aparece para o Beto depois que o cargo dele é liberado nas permissões do canal', async () => {
  await ana.getByTestId('group-menu').click();
  await ana.getByTestId('group-new-channel').click();
  await ana.getByTestId('channel-name').fill('so-vip');
  await ana.getByTestId('channel-private').check();
  await ana.getByTestId('channel-create').click();
  await channel(ana, 'so-vip').waitFor();
  await channel(ana, 'so-vip').click();
  await ana.getByTestId('chat-input').fill('segredo dos VIPs');
  await ana.getByTestId('chat-input').press('Enter');
  await ana.getByTestId('chat-message').filter({ hasText: 'segredo dos VIPs' }).waitFor();
  assert.equal(await channel(beto, 'so-vip').count(), 0, 'o Beto ainda não vê o canal');

  await openSettings(ana, 'canais');
  await ana.getByTestId('channel-row').and(ana.locator('[data-channel="so-vip"]')).getByTestId('channel-permissions-open').click();
  await ana.getByTestId('channel-permissions').waitFor();
  await ana.getByTestId('override-add').selectOption({ label: 'VIP' });
  const view = ana.getByTestId('override-VIEW_CHANNEL');
  assert.equal(await view.getAttribute('data-choice'), 'herdar');
  await view.getByRole('radio', { name: 'Permitir' }).click();
  await ana.getByTestId('override-save').click();
  await waitFor(async () => (await ana.getByTestId('override-save').isDisabled()) === true, 'a regra ser salva');
  await closeDialog(ana, /Permissões de canal/);
  await closeDialog(ana, /Configurações de/);

  await channel(beto, 'so-vip').waitFor({ timeout: 15_000 });
  await channel(beto, 'so-vip').click();
  await beto.getByTestId('chat-message').filter({ hasText: 'segredo dos VIPs' }).waitFor();
  await beto.getByTestId('chat-input').fill('agora eu vejo');
  await beto.getByTestId('chat-input').press('Enter');
  await ana.getByTestId('chat-message').filter({ hasText: 'agora eu vejo' }).waitFor();
});

test('negar no canal: o Beto continua lendo, mas a caixa de mensagem vira um aviso', async () => {
  await openSettings(ana, 'canais');
  await ana.getByTestId('channel-row').and(ana.locator('[data-channel="so-vip"]')).getByTestId('channel-permissions-open').click();
  await ana.getByTestId('override-target').filter({ hasText: 'VIP' }).click();
  await ana.getByTestId('override-SEND_MESSAGES').getByRole('radio', { name: 'Negar' }).click();
  await ana.getByTestId('override-save').click();
  await waitFor(async () => (await ana.getByTestId('override-save').isDisabled()) === true, 'a regra ser salva');
  await closeDialog(ana, /Permissões de canal/);

  await beto.getByTestId('chat-readonly').waitFor({ timeout: 15_000 });
  assert.equal(await beto.getByTestId('chat-input').count(), 0);
  assert.equal(await beto.getByTestId('chat-message').filter({ hasText: 'segredo dos VIPs' }).count(), 1);

  // Permissões efetivas, calculadas pelo servidor: o painel mostra o mesmo resultado.
  await ana.getByTestId('settings-tab-membros').click();
  await ana.getByTestId('member-row').and(ana.locator('[data-user="beto"]')).getByTestId('member-effective').click();
  await ana.getByTestId('effective-permissions').waitFor();
  await ana.getByTestId('effective-where').selectOption({ label: '# so-vip' });
  await waitFor(async () => (await ana.getByTestId('effective-SEND_MESSAGES').getAttribute('data-granted')) === 'false', 'o painel mostrar que ele não envia mensagens ali');
  assert.equal(await ana.getByTestId('effective-VIEW_CHANNEL').getAttribute('data-granted'), 'true');
  await ana.getByTestId('effective-where').selectOption({ label: '# geral' });
  await waitFor(async () => (await ana.getByTestId('effective-SEND_MESSAGES').getAttribute('data-granted')) === 'true', 'em #geral ele envia');
  await closeDialog(ana, /Permissões efetivas/);
  await closeDialog(ana, /Configurações de/);
});

test('canal de voz: entrar clicando, ver quem está dentro, transmitir a tela e continuar conectado no chat', { skip: noWindows && 'precisa de janelas para capturar a tela' }, async () => {
  await channel(beto, 'Sala de voz').click();
  await beto.getByTestId('voice-room').getByTestId('room').waitFor({ timeout: 20_000 });
  // A Ana vê o Beto dentro do canal de voz, na lista de canais, sem recarregar.
  await waitFor(async () => (await ana.getByTestId('channel-voice-people').locator('[data-user="beto"]').count()) === 1, 'o Beto aparecer dentro do canal de voz');

  await channel(ana, 'Sala de voz').click();
  await ana.getByTestId('voice-room').getByTestId('room').waitFor({ timeout: 20_000 });
  await waitFor(async () => (await beto.getByTestId('participant').count()) === 2, 'os dois aparecerem no canal');
  assert.equal(await ana.getByTestId('room-name').textContent(), 'Sala de voz');
  assert.equal(await ana.getByTestId('dock-invite').count(), 0, 'canal de voz não tem link de convite de sala');

  await ana.getByTestId('dock-share').click();
  await beto.getByTestId('stage-owner').waitFor({ timeout: 20_000 });
  await waitFor(async () => (await videoFacts(beto)).frames > 20, 'a tela da Ana chegar ao Beto');

  // O Beto vai conversar por texto: a voz continua (barra de voz) e o vídeo segue quando ele volta.
  await channel(beto, 'geral').click();
  await beto.getByTestId('chat').waitFor();
  await beto.getByTestId('voice-bar').waitFor();
  await beto.getByTestId('chat-input').fill('estou vendo sua tela');
  await beto.getByTestId('chat-input').press('Enter');
  assert.equal(await ana.getByTestId('channel-voice-people').locator('[data-user="beto"]').count(), 1, 'ele segue no canal de voz');
  await channel(beto, 'Sala de voz').click();
  const before = (await videoFacts(beto)).frames;
  await waitFor(async () => (await videoFacts(beto)).frames > before + 20, 'o vídeo continuar depois de voltar do chat');

  // Sem a permissão de transmitir, o botão fica desligado e o servidor recusa de qualquer jeito.
  assert.equal(await beto.getByTestId('dock-share').isDisabled(), false);
  await beto.getByTestId('voice-bar-leave').click();
  await waitFor(async () => (await ana.getByTestId('channel-voice-people').locator('[data-user="beto"]').count()) === 0, 'o Beto sair do canal de voz');
  await ana.getByTestId('dock-stop').click();
});

test('auditoria registra quem fez o quê; expulsar tira a pessoa do grupo na hora', async () => {
  if (await ana.getByTestId('voice-bar').count()) await ana.getByTestId('voice-bar-leave').click();
  await channel(ana, 'geral').click();
  await openSettings(ana, 'auditoria');
  await ana.getByTestId('audit-entry').first().waitFor();
  const actions = await ana.getByTestId('audit-entry').evaluateAll((nodes) => nodes.map((node) => node.dataset.action));
  for (const expected of ['grupo.criado', 'convite.criado', 'cargo.criado', 'membro.cargos', 'canal.criado', 'canal.permissoes', 'mensagem.excluida']) {
    assert.ok(actions.includes(expected), `falta ${expected} em ${actions.join(', ')}`);
  }
  const permissions = ana.getByTestId('audit-entry').and(ana.locator('[data-action="canal.permissoes"]')).first();
  assert.match(await permissions.textContent(), /Ana mudou as permissões do canal so-vip/);
  assert.match(await permissions.textContent(), /negar \+ Enviar mensagens/);

  await ana.getByTestId('settings-tab-membros').click();
  await ana.getByTestId('member-row').and(ana.locator('[data-user="beto"]')).getByTestId('member-punish').click();
  await ana.getByTestId('member-kick').click();
  assert.match(await ana.getByTestId('dialog-title').textContent(), /Expulsar/);
  await ana.getByTestId('dialog-confirm').click();
  await waitFor(async () => (await ana.getByTestId('member-row').count()) === 1, 'o Beto sair da lista de membros');
  await closeDialog(ana, /Configurações de/);

  await waitFor(async () => /Você foi removido de “Os Amigos”/.test((await toast(beto).textContent().catch(() => '')) ?? ''), 'o Beto ser avisado da expulsão');
  await waitFor(async () => (await beto.getByTestId('rail-group').count()) === 0, 'o grupo sumir da barra do Beto');
  // O convite antigo ainda vale (expulsão não é banimento): ele consegue voltar.
  await beto.goto(inviteLink);
  await beto.getByTestId('join-accept').click();
  await beto.getByTestId('chat').waitFor();
});

test('sair da conta encerra a sessão; senha errada não entra', async () => {
  await beto.getByTestId('account-menu').click();
  // Cancelar não sai da conta; confirmar sai.
  await beto.getByTestId('account-logout').click();
  await beto.getByTestId('dialog-cancel').click();
  await waitFor(async () => (await beto.getByTestId('dialog').count()) === 0, 'o diálogo fechar');
  assert.notEqual(await beto.evaluate(() => localStorage.getItem('shareroom:conta')), null);
  await beto.getByTestId('account-logout').click();
  await beto.getByTestId('dialog-confirm').click();
  await beto.getByTestId('auth-submit').waitFor();
  assert.equal(await beto.evaluate(() => localStorage.getItem('shareroom:conta')), null);
  await beto.getByTestId('auth-tab-entrar').click();
  await beto.getByTestId('auth-username').fill('beto');
  await beto.getByTestId('auth-password').fill('senha-errada-9');
  await beto.getByTestId('auth-submit').click();
  assert.match(await beto.getByTestId('auth-error').textContent(), /Usuário ou senha incorretos/);
  await beto.getByTestId('auth-password').fill('senha-de-teste-1');
  await beto.getByTestId('auth-submit').click();
  await beto.getByTestId('chat').waitFor();
});
