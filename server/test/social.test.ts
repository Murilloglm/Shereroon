// Perfis, notas pessoais, amizades, bloqueios, mensagens privadas e o painel de moderação.
import { deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type Person, type World } from './world.ts';

let w: World;
let dono: Person, ana: Person, beto: Person, caio: Person, estranho: Person;
let groupId: string;
let geral: string;

const code = async (method: string, path: string, who: Person | null, body?: unknown) => {
  const result = await w.api(method, path, who?.token ?? null, body);
  return result.status === 200 ? 'ok' : (result.json.error.code as string);
};

function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]));
}

async function upload(path: string, who: Person, data: Uint8Array, contentType = 'image/png') {
  const response = await w.app.request(path, { method: 'POST', headers: { authorization: `Bearer ${who.token}`, 'content-type': contentType }, body: data as Uint8Array<ArrayBuffer> });
  return { status: response.status, json: (await response.json()) as any };
}

beforeAll(async () => {
  w = await createWorld();
  [dono, ana, beto, caio, estranho] = (await Promise.all(['dono', 'ana', 'beto', 'caio', 'estranho'].map((name) => w.signup(name)))) as [Person, Person, Person, Person, Person];
  groupId = await w.group(dono, 'Os Amigos');
  await w.join(dono, groupId, ana, beto, caio);
  geral = (await w.channelByName(dono, groupId, 'geral'))!;
});

describe('perfis', () => {
  it('quem divide um grupo vê o perfil; quem não tem relação nenhuma nem sabe que existe', async () => {
    await w.ok('PATCH', '/api/me/profile', ana.token, { bio: 'Jogo à noite.', status: 'no lobby', avatar: 'padrao:3', banner: 'cor:#6c4dff' });
    const seen = (await w.ok('GET', `/api/users/${ana.id}`, beto.token)).profile;
    expect(seen).toMatchObject({ displayName: 'Ana', bio: 'Jogo à noite.', status: 'no lobby', avatar: 'padrao:3', banner: 'cor:#6c4dff', friendship: 'nenhuma', canMessage: true });
    expect(seen.mutualGroups.map((group: { name: string }) => group.name)).toEqual(['Os Amigos']);
    expect(await code('GET', `/api/users/${ana.id}`, estranho)).toBe('usuario_inexistente');
  });

  it('privacidade "só amigos" esconde bio, status e grupos em comum de quem não é amigo', async () => {
    await w.ok('PATCH', '/api/me/profile', ana.token, { profilePrivacy: 'amigos' });
    const seen = (await w.ok('GET', `/api/users/${ana.id}`, beto.token)).profile;
    expect(seen.bio).toBeNull();
    expect(seen.mutualGroups).toBeNull();
    expect(seen.displayName).toBe('Ana');
    await w.ok('PATCH', '/api/me/profile', ana.token, { profilePrivacy: 'membros' });
  });

  it('foto de perfil: formato e dimensões são lidos do arquivo; o que não serve é recusado', async () => {
    const ok = await upload('/api/me/media/avatar', beto, png(128, 128));
    expect(ok.status).toBe(200);
    expect(ok.json.profile.avatar).toMatch(/^arquivo:/);
    const media = await w.app.request(`/api/media/${ok.json.profile.avatar.slice(8)}`);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('image/png');
    expect(media.headers.get('x-content-type-options')).toBe('nosniff');

    expect((await upload('/api/me/media/avatar', beto, new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'image/png')).json.error.code).toBe('imagem_invalida');
    expect((await upload('/api/me/media/avatar', beto, png(16, 16))).json.error.code).toBe('dimensoes_invalidas');
    expect((await upload('/api/me/media/banner', beto, png(200, 50))).json.error.code).toBe('dimensoes_invalidas');
    // Voltar ao avatar padrão apaga a imagem antiga do banco.
    await w.ok('PATCH', '/api/me/profile', beto.token, { avatar: 'padrao:1' });
    expect((await w.app.request(`/api/media/${ok.json.profile.avatar.slice(8)}`)).status).toBe(404);
  });

  it('nota e apelido pessoais: só quem escreveu vê, e o nome da pessoa não muda para os outros', async () => {
    await w.ok('PUT', `/api/users/${beto.id}/note`, ana.token, { note: 'me deve uma pizza', nickname: 'Betão' });
    expect((await w.ok('GET', '/api/me/notes', ana.token)).notes).toEqual([{ userId: beto.id, note: 'me deve uma pizza', nickname: 'Betão' }]);
    expect((await w.ok('GET', '/api/me/notes', caio.token)).notes).toEqual([]);
    expect((await w.ok('GET', `/api/users/${beto.id}`, caio.token)).profile).toMatchObject({ displayName: 'Beto', nickname: '', note: '' });
    expect((await w.ok('GET', `/api/users/${beto.id}`, ana.token)).profile).toMatchObject({ displayName: 'Beto', nickname: 'Betão' });
  });
});

describe('amizades e bloqueios', () => {
  it('pedido por nome de usuário, aceite e lista com quem está online', async () => {
    expect((await w.ok('POST', '/api/friends', ana.token, { username: '@beto' })).state).toBe('enviada');
    expect((await w.ok('GET', '/api/friends', beto.token)).friends[0]).toMatchObject({ user: { username: 'ana' }, state: 'recebida' });
    const live = await w.connect(ana);
    expect((await w.ok('POST', `/api/friends/${ana.id}/accept`, beto.token)).state).toBe('amigos');
    const list = (await w.ok('GET', '/api/friends', beto.token)).friends;
    expect(list[0]).toMatchObject({ state: 'amigos', online: true });
    expect(list[0].since).toBeTruthy();
    expect(live.of('friend.changed').length).toBeGreaterThan(0);
    live.close();
    expect((await w.ok('GET', `/api/users/${ana.id}`, beto.token)).profile.friendship).toBe('amigos');
  });

  it('pedido cruzado vira amizade na hora; desfazer remove dos dois lados', async () => {
    await w.ok('POST', '/api/friends', caio.token, { userId: ana.id });
    expect((await w.ok('POST', '/api/friends', ana.token, { userId: caio.id })).state).toBe('amigos');
    await w.ok('DELETE', `/api/friends/${caio.id}`, ana.token);
    expect((await w.ok('GET', '/api/friends', caio.token)).friends).toEqual([]);
  });

  it('bloquear desfaz a amizade e impede pedidos e mensagens nos dois sentidos', async () => {
    await w.ok('POST', '/api/friends', caio.token, { userId: beto.id });
    await w.ok('PUT', `/api/blocks/${caio.id}`, beto.token);
    expect((await w.ok('GET', '/api/friends', caio.token)).friends).toEqual([]);
    expect(await code('POST', '/api/friends', caio, { userId: beto.id })).toBe('nao_disponivel');
    expect(await code('POST', '/api/dms', caio, { userId: beto.id })).toBe('mensagem_bloqueada');
    expect((await w.ok('GET', `/api/users/${beto.id}`, caio.token)).profile.canMessage).toBe(false);
    await w.ok('DELETE', `/api/blocks/${caio.id}`, beto.token);
  });
});

describe('mensagens privadas', () => {
  let dm: string;

  it('quem divide um grupo conversa; enviar, responder, reagir e não lidas', async () => {
    dm = (await w.ok('POST', '/api/dms', caio.token, { userId: ana.id })).id;
    expect((await w.ok('POST', '/api/dms', ana.token, { userId: caio.id })).id).toBe(dm);
    const live = await w.connect(ana);
    const first = (await w.ok('POST', `/api/dms/${dm}/messages`, caio.token, { content: 'oi, Ana!' })).message;
    const reply = (await w.ok('POST', `/api/dms/${dm}/messages`, ana.token, { content: 'oi!', replyTo: first.id })).message;
    expect(reply.reply).toMatchObject({ id: first.id, authorName: 'Caio' });
    expect(live.of('dm.message').map((event: any) => event.message.content)).toEqual(['oi, Ana!', 'oi!']);
    live.close();
    await w.ok('PUT', `/api/dm-messages/${first.id}/reactions/${encodeURIComponent('😂')}`, ana.token);
    const history = (await w.ok('GET', `/api/dms/${dm}/messages`, caio.token)).messages;
    expect(history.map((message: { content: string }) => message.content)).toEqual(['oi, Ana!', 'oi!']);
    expect(history[0].reactions).toEqual([{ emoji: '😂', users: [ana.id] }]);
    const caioList = (await w.ok('GET', '/api/dms', caio.token)).conversations;
    expect(caioList[0]).toMatchObject({ id: dm, user: { username: 'ana' }, unread: 1, last: { content: 'oi!', mine: false } });
    await w.ok('POST', `/api/dms/${dm}/read`, caio.token, { messageId: reply.id });
    expect((await w.ok('GET', '/api/dms', caio.token)).conversations[0].unread).toBe(0);
  });

  it('editar e apagar só as próprias mensagens', async () => {
    const mine = (await w.ok('POST', `/api/dms/${dm}/messages`, caio.token, { content: 'errado' })).message;
    expect(await code('PATCH', `/api/dm-messages/${mine.id}`, ana, { content: 'hackeado' })).toBe('sem_permissao');
    expect((await w.ok('PATCH', `/api/dm-messages/${mine.id}`, caio.token, { content: 'certo' })).message).toMatchObject({ content: 'certo' });
    expect(await code('DELETE', `/api/dm-messages/${mine.id}`, ana)).toBe('sem_permissao');
    await w.ok('DELETE', `/api/dm-messages/${mine.id}`, caio.token);
    expect((await w.ok('GET', `/api/dms/${dm}/messages`, ana.token)).messages.some((message: { id: string }) => message.id === mine.id)).toBe(false);
  });

  it('anexos ficam só para os dois; administrador do grupo não lê a conversa', async () => {
    const sent = await upload(`/api/dms/${dm}/files?name=foto.png`, caio, png(40, 30));
    expect(sent.json.file).toMatchObject({ mime: 'image/png', width: 40, height: 30 });
    const message = (await w.ok('POST', `/api/dms/${dm}/messages`, caio.token, { content: '', attachments: [sent.json.file.id] })).message;
    expect(message.attachments).toHaveLength(1);
    expect((await w.app.request(`/api/dm-files/${sent.json.file.id}`, { headers: { authorization: `Bearer ${ana.token}` } })).status).toBe(200);
    expect(await code('GET', `/api/dm-files/${sent.json.file.id}`, dono)).toBe('arquivo_inexistente');
    expect(await code('GET', `/api/dms/${dm}/messages`, dono)).toBe('conversa_inexistente');
  });

  it('quem só aceita amigos não recebe de quem apenas divide um grupo', async () => {
    await w.ok('PATCH', '/api/me/profile', beto.token, { dmPrivacy: 'amigos' });
    expect(await code('POST', '/api/dms', caio, { userId: beto.id })).toBe('mensagem_bloqueada');
    // Ana é amiga do Beto: continua podendo.
    expect(await code('POST', '/api/dms', ana, { userId: beto.id })).toBe('ok');
    expect(await code('POST', '/api/dms', estranho, { userId: ana.id })).toBe('usuario_inexistente');
  });

  it('convite para um grupo dentro da conversa: só quem pode convidar; o amigo entra pelo cartão', async () => {
    const friendDm = (await w.ok('POST', '/api/dms', ana.token, { userId: beto.id })).id;
    const other = await w.group(caio, 'Grupo do Caio');
    expect(await code('POST', `/api/dms/${friendDm}/messages`, ana, { invite: { groupId: other } })).not.toBe('ok');
    const card = (await w.ok('POST', `/api/dms/${dm}/messages`, caio.token, { invite: { groupId: other } })).message;
    expect(card.meta).toMatchObject({ type: 'convite', group: { name: 'Grupo do Caio' } });
    expect(card.meta.expiresAt).toBeTruthy();
    await w.ok('POST', `/api/invites/${card.meta.code}/accept`, ana.token);
    expect((await w.view(ana, other)).group.name).toBe('Grupo do Caio');
  });
});

describe('painel de moderação', () => {
  it('a dona vê entrada, cargos, estatísticas deste grupo e o histórico; um membro comum não vê nada', async () => {
    await w.ok('POST', `/api/channels/${geral}/messages`, ana.token, { content: 'olha https://exemplo.com' });
    await w.ok('POST', `/api/channels/${geral}/messages`, ana.token, { content: 'sem link' });
    await w.ok('POST', `/api/groups/${groupId}/members/${ana.id}/timeout`, dono.token, { minutes: 1 });
    const details = await w.ok('GET', `/api/groups/${groupId}/members/${ana.id}/details`, dono.token);
    expect(details.member).toMatchObject({ username: 'ana', joinedVia: { kind: 'convite', invitedBy: { id: dono.id, name: 'Dono' } } });
    expect(details.stats).toMatchObject({ messages: 2, links: 1 });
    expect(details.stats.channels[0]).toMatchObject({ name: 'geral', messages: 2 });
    expect(details.canAct).toMatchObject({ kick: true, ban: true, roles: true });
    expect(details.history.map((entry: { action: string }) => entry.action)).toContain('membro.castigo');
    // Mensagens privadas não entram nas contas do grupo.
    expect(details.stats.messages).toBe(2);
    expect(await code('GET', `/api/groups/${groupId}/members/${ana.id}/details`, beto)).toBe('sem_permissao');
    // Quem criou o grupo aparece como criador.
    expect((await w.ok('GET', `/api/groups/${groupId}/members/${dono.id}/details`, dono.token)).member.joinedVia).toMatchObject({ kind: 'criador' });
  });
});

describe('bots na lista de membros', () => {
  it('quem configura bots escolhe como o bot aparece; é só aparência e o valor é conferido', async () => {
    await w.ok('POST', `/api/groups/${groupId}/bots`, dono.token, { botId: 'lembretes' });
    const botOf = async () => ((await w.view(beto, groupId)).members as { bot?: boolean; botList?: string }[]).find((item) => item.bot)!;
    expect((await botOf()).botList).toBe('categoria');
    await w.ok('PATCH', `/api/groups/${groupId}/bots/lembretes`, dono.token, { memberList: 'ocultar' });
    expect((await botOf()).botList).toBe('ocultar');
    expect(await code('PATCH', `/api/groups/${groupId}/bots/lembretes`, dono, { memberList: 'invisivel' })).toBe('config_invalida');
    expect(await code('PATCH', `/api/groups/${groupId}/bots/lembretes`, beto, { memberList: 'mostrar' })).toBe('sem_permissao');
    // Oculto da lista continua membro (e sujeito às regras): aparece na visão do grupo para quem quiser abrir.
    expect((await w.view(caio, groupId)).members.some((item: { bot?: boolean }) => item.bot)).toBe(true);
  });
});
