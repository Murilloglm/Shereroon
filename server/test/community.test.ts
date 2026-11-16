// Contas, grupos, canais e mensagens, com as regras aplicadas no backend. Banco PostgreSQL de verdade (PGlite).
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_EVERYONE, P } from '../../shared/permissions.ts';
import { createApp } from '../src/app.ts';
import { RateLimiter } from '../src/ratelimit.ts';
import { FakeSfu } from './fake-sfu.ts';
import { config, createWorld, type Person, type World } from './world.ts';

let w: World;
let serial = 0;
const person = (prefix: string): Promise<Person> => w.signup(`${prefix}${++serial}`);

beforeAll(async () => {
  w = await createWorld();
}, 60_000);

describe('contas', () => {
  it('cadastro, entrada e sessão; a senha e o código de sessão não ficam guardados em texto', async () => {
    const ana = await person('ana');
    expect((await w.ok('GET', '/api/auth/me', ana.token)).user.username).toBe(ana.name);

    const [row] = await w.db.query('SELECT password_hash FROM users WHERE id = $1', [ana.id]);
    expect(String(row!.password_hash)).toMatch(/^scrypt\$\d+\$/);
    expect(String(row!.password_hash)).not.toContain('senha-de-teste-1');
    const sessions = await w.db.query('SELECT token_hash FROM sessions WHERE user_id = $1', [ana.id]);
    expect(sessions).toHaveLength(1);
    expect(String(sessions[0]!.token_hash)).not.toBe(ana.token);
    expect(String(sessions[0]!.token_hash)).toMatch(/^[0-9a-f]{64}$/);

    const login = await w.ok('POST', '/api/auth/login', null, { username: ana.name.toUpperCase(), password: 'senha-de-teste-1' });
    expect(login.user.id).toBe(ana.id);
    expect(login.token).not.toBe(ana.token);
  });

  it('recusa nome repetido (mesmo com outra caixa), nome inválido e senha curta', async () => {
    const bia = await person('bia');
    expect((await w.api('POST', '/api/auth/register', null, { username: bia.name.toUpperCase(), password: 'outra-senha-9' })).json.error.code).toBe('usuario_em_uso');
    expect((await w.api('POST', '/api/auth/register', null, { username: 'a b', password: 'outra-senha-9' })).json.error.code).toBe('usuario_invalido');
    expect((await w.api('POST', '/api/auth/register', null, { username: `curta${++serial}`, password: '1234567' })).json.error.code).toBe('senha_invalida');
  });

  it('senha errada e conta inexistente dão a mesma resposta', async () => {
    const caio = await person('caio');
    const wrong = await w.api('POST', '/api/auth/login', null, { username: caio.name, password: 'senha-errada-1' });
    const missing = await w.api('POST', '/api/auth/login', null, { username: 'ninguem-com-esse-nome', password: 'senha-errada-1' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.json).toEqual(missing.json);
  });

  it('sair encerra a sessão; trocar a senha derruba as outras sessões', async () => {
    const duda = await person('duda');
    const second = (await w.ok('POST', '/api/auth/login', null, { username: duda.name, password: 'senha-de-teste-1' })).token as string;
    await w.ok('POST', '/api/auth/logout', duda.token);
    expect((await w.api('GET', '/api/auth/me', duda.token)).status).toBe(401);

    expect((await w.api('POST', '/api/auth/password', second, { current: 'errada-errada', next: 'senha-nova-123' })).json.error.code).toBe('senha_incorreta');
    const fresh = (await w.ok('POST', '/api/auth/password', second, { current: 'senha-de-teste-1', next: 'senha-nova-123' })).token as string;
    expect((await w.api('GET', '/api/auth/me', second)).status).toBe(401);
    expect((await w.api('GET', '/api/auth/me', fresh)).status).toBe(200);
    expect((await w.api('POST', '/api/auth/login', null, { username: duda.name, password: 'senha-de-teste-1' })).status).toBe(401);
  });

  it('sem sessão, nada dos grupos responde', async () => {
    for (const [method, path] of [['GET', '/api/groups'], ['POST', '/api/groups'], ['GET', '/api/groups/qualquer'], ['POST', '/api/channels/x/messages']] as const) {
      const result = await w.api(method, path, null, method === 'POST' ? {} : undefined);
      expect(result.status, path).toBe(401);
    }
    expect((await w.api('GET', '/api/groups', 'um-codigo-de-sessao-inventado-123456')).status).toBe(401);
  });

  it('tentativas de entrar são limitadas por conta', async () => {
    const limited = await createWorld(new RateLimiter());
    const eva = await limited.signup('eva');
    let last = 0;
    for (let attempt = 0; attempt < 11; attempt++) {
      last = (await limited.api('POST', '/api/auth/login', null, { username: eva.name, password: 'senha-errada-1' })).status;
    }
    expect(last).toBe(429);
    // Nem a senha certa passa enquanto o limite não zera.
    expect((await limited.api('POST', '/api/auth/login', null, { username: eva.name, password: 'senha-de-teste-1' })).status).toBe(429);
  }, 60_000);
});

describe('grupos, convites e entrada', () => {
  it('criar um grupo traz o dono, os cargos iniciais e os canais iniciais', async () => {
    const dono = await person('dono');
    const groupId = await w.group(dono, 'Os Amigos', { description: 'Jogar e conversar' });
    const state = await w.view(dono, groupId);
    expect(state.group).toMatchObject({ name: 'Os Amigos', description: 'Jogar e conversar', isPublic: false, ownerId: dono.id });
    expect(state.me).toMatchObject({ isOwner: true, top: null });
    expect(state.roles.map((role: any) => [role.name, role.position])).toEqual([['Administrador', 2], ['Moderador', 1], ['@everyone', 0]]);
    expect(BigInt(state.roles.at(-1).permissions)).toBe(DEFAULT_EVERYONE);
    expect(state.channels.map((channel: any) => [channel.kind, channel.name])).toEqual([
      ['categoria', 'Canais de texto'],
      ['categoria', 'Canais de voz'],
      ['texto', 'geral'],
      ['voz', 'Sala de voz'],
    ]);
    expect(state.members).toHaveLength(1);
    expect((await w.ok('GET', '/api/groups', dono.token)).groups.map((group: any) => group.id)).toContain(groupId);
  });

  it('quem não é membro não descobre nada de um grupo privado', async () => {
    const dono = await person('dono');
    const fora = await person('fora');
    const groupId = await w.group(dono);
    const channelId = await w.channelByName(dono, groupId, 'geral');
    for (const [method, path, body] of [
      ['GET', `/api/groups/${groupId}`, undefined],
      ['PATCH', `/api/groups/${groupId}`, { name: 'invadido' }],
      ['POST', `/api/groups/${groupId}/join`, {}],
      ['GET', `/api/channels/${channelId}/messages`, undefined],
      ['POST', `/api/channels/${channelId}/messages`, { content: 'oi' }],
      ['POST', `/api/groups/${groupId}/roles`, { name: 'x' }],
      ['GET', `/api/groups/${groupId}/audit`, undefined],
    ] as const) {
      expect((await w.api(method, path, fora.token, body)).status, `${method} ${path}`).toBe(404);
    }
    expect((await w.ok('GET', '/api/groups/public', fora.token)).groups).toEqual([]);
  });

  it('grupo público aparece na busca e aceita entrada direta', async () => {
    const dono = await person('dono');
    const novo = await person('novo');
    const groupId = await w.group(dono, `Publico${serial}`, { isPublic: true });
    const found = (await w.ok('GET', `/api/groups/public?q=Publico${serial}`, novo.token)).groups;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: groupId, memberCount: 1, joined: false });
    await w.ok('POST', `/api/groups/${groupId}/join`, novo.token, {});
    expect((await w.view(novo, groupId)).members).toHaveLength(2);
  });

  it('convite: limite de usos, validade, revogação e banimento', async () => {
    const dono = await person('dono');
    const [a, b, c] = [await person('a'), await person('b'), await person('c')];
    const groupId = await w.group(dono);

    const { invite } = await w.ok('POST', `/api/groups/${groupId}/invites`, dono.token, { maxUses: 1 });
    expect((await w.ok('GET', `/api/invites/${invite.code}`, a.token)).group).toMatchObject({ id: groupId, memberCount: 1 });
    await w.ok('POST', `/api/invites/${invite.code}/accept`, a.token);
    // Aceitar de novo não gasta outro uso nem dá erro.
    await w.ok('POST', `/api/invites/${invite.code}/accept`, a.token);
    expect((await w.api('POST', `/api/invites/${invite.code}/accept`, b.token)).json.error.code).toBe('convite_invalido');

    const second = (await w.ok('POST', `/api/groups/${groupId}/invites`, dono.token, {})).invite;
    await w.db.query(`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE code = $1`, [second.code]);
    expect((await w.api('POST', `/api/invites/${second.code}/accept`, b.token)).status).toBe(404);

    const third = (await w.ok('POST', `/api/groups/${groupId}/invites`, dono.token, { expiresInHours: 0 })).invite;
    await w.ok('DELETE', `/api/invites/${third.code}`, dono.token);
    expect((await w.api('POST', `/api/invites/${third.code}/accept`, b.token)).status).toBe(404);

    const fourth = (await w.ok('POST', `/api/groups/${groupId}/invites`, dono.token, {})).invite;
    await w.ok('POST', `/api/invites/${fourth.code}/accept`, c.token);
    await w.ok('POST', `/api/groups/${groupId}/members/${c.id}/ban`, dono.token, { reason: 'teste' });
    expect((await w.api('POST', `/api/invites/${fourth.code}/accept`, c.token)).json.error.code).toBe('banido');
    expect((await w.ok('GET', `/api/groups/${groupId}/bans`, dono.token)).bans[0]).toMatchObject({ userId: c.id, reason: 'teste' });
    await w.ok('DELETE', `/api/groups/${groupId}/bans/${c.id}`, dono.token);
    await w.ok('POST', `/api/invites/${fourth.code}/accept`, c.token);
  });

  it('o dono não sai sem passar o grupo; excluir é só do dono', async () => {
    const dono = await person('dono');
    const outro = await person('outro');
    const groupId = await w.group(dono);
    await w.join(dono, groupId, outro);
    expect((await w.api('POST', `/api/groups/${groupId}/leave`, dono.token, {})).json.error.code).toBe('dono_nao_sai');
    expect((await w.api('DELETE', `/api/groups/${groupId}`, outro.token)).json.error.code).toBe('so_o_dono');
    expect((await w.api('POST', `/api/groups/${groupId}/transfer`, outro.token, { userId: outro.id })).json.error.code).toBe('so_o_dono');
    await w.ok('POST', `/api/groups/${groupId}/transfer`, dono.token, { userId: outro.id });
    await w.ok('POST', `/api/groups/${groupId}/leave`, dono.token, {});
    await w.ok('DELETE', `/api/groups/${groupId}`, outro.token);
    expect((await w.api('GET', `/api/groups/${groupId}`, outro.token)).status).toBe(404);
  });
});

describe('mensagens', () => {
  let dono: Person;
  let membro: Person;
  let groupId: string;
  let geral: string;

  beforeAll(async () => {
    dono = await person('dono');
    membro = await person('membro');
    groupId = await w.group(dono);
    await w.join(dono, groupId, membro);
    geral = (await w.channelByName(dono, groupId, 'geral'))!;
  });

  it('enviar, listar em páginas, editar e apagar a própria mensagem', async () => {
    const ids: string[] = [];
    for (let index = 1; index <= 5; index++) ids.push((await w.ok('POST', `/api/channels/${geral}/messages`, membro.token, { content: `mensagem ${index}` })).message.id);
    const page = (await w.ok('GET', `/api/channels/${geral}/messages?limit=2`, dono.token)).messages;
    expect(page.map((message: any) => message.content)).toEqual(['mensagem 4', 'mensagem 5']);
    const older = (await w.ok('GET', `/api/channels/${geral}/messages?limit=2&before=${page[0].id}`, dono.token)).messages;
    expect(older.map((message: any) => message.content)).toEqual(['mensagem 2', 'mensagem 3']);
    expect(page[0].author).toMatchObject({ id: membro.id, username: membro.name });

    const edited = (await w.ok('PATCH', `/api/messages/${ids[4]}`, membro.token, { content: 'corrigida' })).message;
    expect(edited).toMatchObject({ content: 'corrigida' });
    expect(edited.editedAt).not.toBeNull();
    await w.ok('DELETE', `/api/messages/${ids[3]}`, membro.token);
    expect((await w.api('PATCH', `/api/messages/${ids[3]}`, membro.token, { content: 'x' })).status).toBe(404);
  });

  it('ninguém edita a mensagem de outra pessoa, nem o dono; apagar a de outro exige permissão', async () => {
    const mine = (await w.ok('POST', `/api/channels/${geral}/messages`, dono.token, { content: 'do dono' })).message.id;
    const theirs = (await w.ok('POST', `/api/channels/${geral}/messages`, membro.token, { content: 'do membro' })).message.id;
    expect((await w.api('PATCH', `/api/messages/${theirs}`, dono.token, { content: 'reescrita' })).json.error.code).toBe('nao_e_autor');
    expect((await w.api('DELETE', `/api/messages/${mine}`, membro.token)).json.error.code).toBe('sem_permissao');
    expect((await w.api('POST', `/api/messages/${mine}/pin`, membro.token, { pinned: true })).json.error.code).toBe('sem_permissao');
    await w.ok('DELETE', `/api/messages/${theirs}`, dono.token);
    const pinned = (await w.ok('POST', `/api/messages/${mine}/pin`, dono.token, { pinned: true })).message;
    expect(pinned.pinned).toBe(true);
    expect((await w.ok('GET', `/api/channels/${geral}/messages?pinned=1`, membro.token)).messages.map((message: any) => message.id)).toEqual([mine]);
  });

  it('mensagem vazia, longa demais ou com caracteres de controle', async () => {
    expect((await w.api('POST', `/api/channels/${geral}/messages`, membro.token, { content: '   \n ' })).json.error.code).toBe('mensagem_vazia');
    expect((await w.api('POST', `/api/channels/${geral}/messages`, membro.token, { content: 'a'.repeat(4001) })).json.error.code).toBe('mensagem_longa');
    const clean = (await w.ok('POST', `/api/channels/${geral}/messages`, membro.token, { content: 'linha 1\r\nlinha\u0000 2​' })).message;
    expect(clean.content).toBe('linha 1\nlinha 2​'.replace('​', '​'));
    expect(clean.content).not.toContain('\u0000');
    expect(clean.content).not.toContain('\r');
  });

  it('links e @everyone dependem de permissão', async () => {
    const state = await w.view(dono, groupId);
    const everyone = state.roles.find((role: any) => role.isEveryone);
    await w.ok('PATCH', `/api/roles/${everyone.id}`, dono.token, { permissions: (DEFAULT_EVERYONE & ~P.SEND_LINKS).toString() });
    expect((await w.api('POST', `/api/channels/${geral}/messages`, membro.token, { content: 'veja https://exemplo.com/x' })).json.error.code).toBe('sem_permissao');
    expect((await w.api('POST', `/api/channels/${geral}/messages`, membro.token, { content: 'entra em www.exemplo.com' })).status).toBe(403);
    await w.ok('POST', `/api/channels/${geral}/messages`, dono.token, { content: 'o dono pode: https://exemplo.com' });

    const plain = (await w.ok('POST', `/api/channels/${geral}/messages`, membro.token, { content: '@everyone acordem' })).message;
    expect(plain.mentionEveryone).toBe(false);
    const real = (await w.ok('POST', `/api/channels/${geral}/messages`, dono.token, { content: '@everyone reunião' })).message;
    expect(real.mentionEveryone).toBe(true);
    await w.ok('PATCH', `/api/roles/${everyone.id}`, dono.token, { permissions: DEFAULT_EVERYONE.toString() });
  });

  it('de castigo a pessoa lê, mas não escreve; o castigo acaba sozinho', async () => {
    await w.ok('POST', `/api/groups/${groupId}/members/${membro.id}/timeout`, dono.token, { minutes: 10 });
    expect((await w.api('POST', `/api/channels/${geral}/messages`, membro.token, { content: 'posso?' })).json.error.code).toBe('em_castigo');
    expect((await w.api('GET', `/api/channels/${geral}/messages`, membro.token)).status).toBe(200);
    await w.db.query(`UPDATE members SET timeout_until = now() - interval '1 second' WHERE user_id = $1`, [membro.id]);
    await w.ok('POST', `/api/groups/${groupId}/members/${membro.id}/timeout`, dono.token, { minutes: 0 });
    await w.ok('POST', `/api/channels/${geral}/messages`, membro.token, { content: 'voltei' });
  });

  it('canal de voz não aceita mensagens; enviar rápido demais é contido', async () => {
    const voz = (await w.channelByName(dono, groupId, 'Sala de voz'))!;
    expect((await w.api('POST', `/api/channels/${voz}/messages`, membro.token, { content: 'oi' })).json.error.code).toBe('nao_e_texto');

    const limited = await createWorld(new RateLimiter());
    const rapido = await limited.signup('rapido');
    const other = await limited.group(rapido);
    const channel = (await limited.channelByName(rapido, other, 'geral'))!;
    const statuses: number[] = [];
    for (let index = 0; index < 12; index++) statuses.push((await limited.api('POST', `/api/channels/${channel}/messages`, rapido.token, { content: `m${index}` })).status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(10);
    expect(statuses.at(-1)).toBe(429);
  }, 60_000);
});

describe('tempo real', () => {
  it('a mensagem chega só a quem pode ver o canal; presença e saída do grupo são avisadas', async () => {
    const dono = await person('dono');
    const vip = await person('vip');
    const comum = await person('comum');
    const groupId = await w.group(dono);
    await w.join(dono, groupId, vip, comum);
    const secreto = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'texto', name: 'so-vip', private: true })).id as string;
    const vipRole = await w.role(dono, groupId, 'VIP', DEFAULT_EVERYONE);
    await w.give(dono, groupId, vip, [vipRole]);
    await w.ok('PUT', `/api/channels/${secreto}/overrides/cargo/${vipRole}`, dono.token, { allow: P.VIEW_CHANNEL.toString(), deny: '0' });

    const donoLive = await w.connect(dono);
    const vipLive = await w.connect(vip);
    const comumLive = await w.connect(comum);
    expect(donoLive.of('presence').map((event) => [event.userId, event.online])).toContainEqual([comum.id, true]);
    expect((await w.view(dono, groupId)).members.filter((member: any) => member.online)).toHaveLength(3);

    await w.ok('POST', `/api/channels/${secreto}/messages`, vip.token, { content: 'segredo' });
    expect(donoLive.of('message.created')).toHaveLength(1);
    expect(vipLive.of('message.created')).toHaveLength(1);
    expect(comumLive.of('message.created'), 'quem não vê o canal não recebe nem o evento').toHaveLength(0);

    const geral = (await w.channelByName(dono, groupId, 'geral'))!;
    const sent = (await w.ok('POST', `/api/channels/${geral}/messages`, comum.token, { content: 'oi' })).message;
    expect(comumLive.of('message.created').map((event: any) => event.message.id)).toEqual([sent.id]);
    await w.ok('DELETE', `/api/messages/${sent.id}`, dono.token);
    expect(comumLive.of('message.deleted')).toHaveLength(1);

    await w.ok('POST', `/api/groups/${groupId}/members/${comum.id}/kick`, dono.token, {});
    expect(comumLive.of('group.removed')).toEqual([{ t: 'group.removed', groupId, reason: 'expulso' }]);
    await w.ok('POST', `/api/channels/${geral}/messages`, dono.token, { content: 'depois da expulsão' });
    expect(comumLive.of('message.created')).toHaveLength(1);

    vipLive.close();
    expect(donoLive.of('presence').at(-1)).toMatchObject({ userId: vip.id, online: false });
    donoLive.close();
    comumLive.close();
  });
});

describe('sem banco de dados', () => {
  it('as salas por link seguem funcionando e os grupos respondem que estão indisponíveis', async () => {
    const app = createApp({ config, sfu: new FakeSfu() });
    expect(await (await app.request('/api/features')).json()).toEqual({ groups: false });
    const login = await app.request('/api/auth/login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(login.status).toBe(503);
    expect(((await login.json()) as any).error.code).toBe('grupos_indisponiveis');
    const room = await app.request('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Sala' }), headers: { 'content-type': 'application/json' } });
    expect(room.status).toBe(200);
    expect(await (await w.app.request('/api/features')).json()).toEqual({ groups: true, maxFileBytes: 10 * 1024 * 1024 });
  });
});
