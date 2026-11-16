// Segurança de cargos e permissões: tudo aqui é pedido direto à API, como faria alguém tentando burlar a interface.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  basePermissions,
  canActOnMember,
  canManageRole,
  channelPermissions,
  DEFAULT_EVERYONE,
  forbiddenChanges,
  P,
  parsePermissions,
  PERMISSIONS,
  topPosition,
  type RoleLike,
} from '../../shared/permissions.ts';
import { createWorld, type Person, type World } from './world.ts';

let w: World;
let dono: Person, admin: Person, gerente: Person, mod: Person, mod2: Person, vip: Person, comum: Person, alvo: Person;
let groupId: string;
let roles: Record<string, string>;
let geral: string;

const code = async (method: string, path: string, who: Person, body?: unknown) => {
  const result = await w.api(method, path, who.token, body);
  return result.status === 200 ? 'ok' : (result.json.error.code as string);
};
const roleIds = async () => Object.fromEntries(((await w.view(dono, groupId)).roles as any[]).map((role) => [role.name, role.id])) as Record<string, string>;
const audit = async () => (await w.ok('GET', `/api/groups/${groupId}/audit`, dono.token)).entries as any[];

beforeAll(async () => {
  w = await createWorld();
  [dono, admin, gerente, mod, mod2, vip, comum, alvo] = (await Promise.all(['dono', 'admin', 'gerente', 'mod', 'mod2', 'vip', 'comum', 'alvo'].map((name) => w.signup(name)))) as [
    Person, Person, Person, Person, Person, Person, Person, Person,
  ];
  groupId = await w.group(dono, 'Hierarquia');
  await w.join(dono, groupId, admin, gerente, mod, mod2, vip, comum, alvo);
  await w.role(dono, groupId, 'Gerente', DEFAULT_EVERYONE | P.MANAGE_ROLES);
  await w.role(dono, groupId, 'Banidor', P.BAN_MEMBERS);
  await w.role(dono, groupId, 'Ajudante', DEFAULT_EVERYONE);
  await w.order(dono, groupId, ['Administrador', 'Gerente', 'Moderador', 'Banidor', 'Ajudante']);
  roles = await roleIds();
  await w.give(dono, groupId, admin, [roles.Administrador!]);
  await w.give(dono, groupId, gerente, [roles.Gerente!]);
  await w.give(dono, groupId, mod, [roles.Moderador!]);
  await w.give(dono, groupId, mod2, [roles.Moderador!]);
  await w.give(dono, groupId, vip, [roles.Ajudante!]);
  geral = (await w.channelByName(dono, groupId, 'geral'))!;
}, 60_000);

describe('as contas de permissão (funções puras)', () => {
  const everyone: RoleLike = { id: 'e', position: 0, permissions: P.VIEW_CHANNEL | P.SEND_MESSAGES, isEveryone: true };
  const vipRole: RoleLike = { id: 'vip', position: 2, permissions: P.MENTION_EVERYONE, isEveryone: false };
  const modRole: RoleLike = { id: 'mod', position: 3, permissions: P.KICK_MEMBERS | P.MANAGE_MESSAGES, isEveryone: false };
  const all = [modRole, vipRole, everyone];
  const subject = (roleIds: string[] = [], extra: object = {}) => ({ userId: 'u1', isOwner: false, roleIds: new Set(roleIds), ...extra });

  it('cada permissão tem um bit próprio e o texto decimal vai e volta', () => {
    expect(new Set(PERMISSIONS.map((item) => item.bit)).size).toBe(PERMISSIONS.length);
    expect(parsePermissions(ALL_PERMISSIONS.toString())).toBe(ALL_PERMISSIONS);
    expect(parsePermissions((ALL_PERMISSIONS + 1n).toString())).toBeNull();
    for (const bad of ['-1', '1.5', '0x10', '', ' 1', null, 7]) expect(parsePermissions(bad), String(bad)).toBeNull();
  });

  it('soma dos cargos; dono e administrador têm tudo', () => {
    expect(basePermissions(subject(), all)).toBe(everyone.permissions);
    expect(basePermissions(subject(['vip', 'mod']), all)).toBe(everyone.permissions | vipRole.permissions | modRole.permissions);
    expect(basePermissions(subject([], { isOwner: true }), all)).toBe(ALL_PERMISSIONS);
    expect(basePermissions(subject(['adm']), [...all, { id: 'adm', position: 9, permissions: P.ADMINISTRATOR, isEveryone: false }])).toBe(ALL_PERMISSIONS);
  });

  it('regras por canal: negar, permitir e herdar, da categoria para o canal', () => {
    const hide = [{ targetKind: 'cargo' as const, targetId: 'e', allow: 0n, deny: P.VIEW_CHANNEL }];
    const openVip = [{ targetKind: 'cargo' as const, targetId: 'vip', allow: P.VIEW_CHANNEL, deny: 0n }];
    // Categoria esconde de todos; canal sem regra própria herda e continua escondido.
    expect(channelPermissions(subject(), all, [hide, []])).toBe(0n);
    // O canal libera para o VIP: quem tem o cargo vê, quem não tem continua sem ver.
    expect(channelPermissions(subject(['vip']), all, [hide, openVip]) & P.VIEW_CHANNEL).toBe(P.VIEW_CHANNEL);
    expect(channelPermissions(subject(), all, [hide, openVip])).toBe(0n);
    // Regra do membro vence a do cargo; permitir de um cargo vence negar de outro cargo da mesma pessoa.
    const mute = [{ targetKind: 'cargo' as const, targetId: 'vip', allow: 0n, deny: P.SEND_MESSAGES }];
    expect(channelPermissions(subject(['vip']), all, [[], mute]) & P.SEND_MESSAGES).toBe(0n);
    expect(channelPermissions(subject(['vip']), all, [[], [...mute, { targetKind: 'membro', targetId: 'u1', allow: P.SEND_MESSAGES, deny: 0n }]]) & P.SEND_MESSAGES).toBe(P.SEND_MESSAGES);
    expect(channelPermissions(subject(['vip', 'mod']), all, [[], [...mute, { targetKind: 'cargo', targetId: 'mod', allow: P.SEND_MESSAGES, deny: 0n }]]) & P.SEND_MESSAGES).toBe(P.SEND_MESSAGES);
  });

  it('regra de canal não cria poder de administração; gerenciar mensagens inclui excluir e fixar; castigo corta escrita e voz', () => {
    const sneaky = [{ targetKind: 'membro' as const, targetId: 'u1', allow: P.KICK_MEMBERS | P.ADMINISTRATOR | P.MANAGE_ROLES, deny: 0n }];
    const result = channelPermissions(subject(), all, [[], sneaky]);
    expect(result & (P.KICK_MEMBERS | P.ADMINISTRATOR | P.MANAGE_ROLES)).toBe(0n);
    expect(channelPermissions(subject(['mod']), all, []) & (P.DELETE_MESSAGES | P.PIN_MESSAGES)).toBe(P.DELETE_MESSAGES | P.PIN_MESSAGES);
    const talk = [{ ...everyone, permissions: everyone.permissions | P.SPEAK | P.STREAM | P.CONNECT }];
    const punished = channelPermissions(subject([], { timedOut: true }), talk, []);
    expect(punished & (P.SEND_MESSAGES | P.SPEAK | P.STREAM)).toBe(0n);
    expect(punished & (P.VIEW_CHANNEL | P.CONNECT)).toBe(P.VIEW_CHANNEL | P.CONNECT);
  });

  it('hierarquia: só abaixo do cargo mais alto; ninguém age sobre o dono nem sobre si', () => {
    const me = subject(['mod']);
    expect(topPosition(me, all)).toBe(3);
    expect(canManageRole(me, all, vipRole)).toBe(true);
    expect(canManageRole(me, all, modRole)).toBe(false);
    expect(canManageRole(subject(), all, everyone), 'quem só tem @everyone não gerencia nem o @everyone').toBe(false);
    const other = (id: string, roleIds: string[], isOwner = false) => ({ userId: id, isOwner, roleIds: new Set(roleIds) });
    expect(canActOnMember(me, other('u2', ['vip']), all)).toBe(true);
    expect(canActOnMember(me, other('u2', ['mod']), all)).toBe(false);
    expect(canActOnMember(me, other('u2', [], true), all)).toBe(false);
    expect(canActOnMember(me, me, all)).toBe(false);
    expect(canActOnMember(other('dono', [], true), other('u2', ['mod']), all)).toBe(true);
  });

  it('ninguém liga nem desliga uma permissão que não tem', () => {
    const mine = P.MANAGE_ROLES | P.SEND_MESSAGES;
    expect(forbiddenChanges(mine, 0n, P.SEND_MESSAGES)).toBe(0n);
    expect(forbiddenChanges(mine, 0n, P.ADMINISTRATOR)).toBe(P.ADMINISTRATOR);
    expect(forbiddenChanges(mine, P.BAN_MEMBERS, 0n), 'tirar também conta').toBe(P.BAN_MEMBERS);
    expect(forbiddenChanges(mine, P.BAN_MEMBERS, P.BAN_MEMBERS | P.SEND_MESSAGES), 'o que não mudou não importa').toBe(0n);
  });
});

describe('membro comum chamando a API direto', () => {
  it('não mexe em cargos, canais, membros, grupo nem vê auditoria', async () => {
    const attempts: [string, string, unknown?][] = [
      ['POST', `/api/groups/${groupId}/roles`, { name: 'meu cargo', permissions: P.ADMINISTRATOR.toString() }],
      ['PATCH', `/api/roles/${roles.Ajudante}`, { permissions: ALL_PERMISSIONS.toString() }],
      ['DELETE', `/api/roles/${roles.Ajudante}`],
      ['PUT', `/api/groups/${groupId}/roles/order`, { order: Object.values(roles) }],
      ['PATCH', `/api/groups/${groupId}/members/${comum.id}`, { roleIds: [roles.Administrador] }],
      ['POST', `/api/groups/${groupId}/channels`, { kind: 'texto', name: 'meu-canal' }],
      ['PATCH', `/api/channels/${geral}`, { name: 'renomeado' }],
      ['DELETE', `/api/channels/${geral}`],
      ['PUT', `/api/groups/${groupId}/channels/order`, { items: [{ id: geral, position: 9 }] }],
      ['GET', `/api/channels/${geral}/overrides`],
      ['PUT', `/api/channels/${geral}/overrides/membro/${comum.id}`, { allow: P.MENTION_EVERYONE.toString(), deny: '0' }],
      ['POST', `/api/groups/${groupId}/members/${alvo.id}/kick`, {}],
      ['POST', `/api/groups/${groupId}/members/${alvo.id}/ban`, {}],
      ['POST', `/api/groups/${groupId}/members/${alvo.id}/timeout`, { minutes: 5 }],
      ['DELETE', `/api/groups/${groupId}/bans/${alvo.id}`],
      ['GET', `/api/groups/${groupId}/bans`],
      ['PATCH', `/api/groups/${groupId}`, { name: 'tomado' }],
      ['GET', `/api/groups/${groupId}/audit`],
      ['GET', `/api/groups/${groupId}/members/${alvo.id}/permissions`],
    ];
    const before = (await audit()).length;
    for (const [method, path, body] of attempts) {
      expect(await code(method, path, comum, body), `${method} ${path}`).toBe('sem_permissao');
    }
    expect((await w.api('DELETE', `/api/groups/${groupId}`, comum.token)).json.error.code).toBe('so_o_dono');
    expect((await audit()).length, 'tentativa recusada não deixa rastro de alteração').toBe(before);
    expect((await w.view(comum, groupId)).me).toMatchObject({ isOwner: false, roleIds: [], top: 0 });
  });
});

describe('quem gerencia cargos não consegue se promover', () => {
  it('cria e edita só com as permissões que tem', async () => {
    const created = await w.role(gerente, groupId, 'Cargo do gerente', DEFAULT_EVERYONE);
    expect(((await w.view(dono, groupId)).roles as any[]).find((role) => role.id === created)).toMatchObject({ position: 1 });
    expect(await code('POST', `/api/groups/${groupId}/roles`, gerente, { name: 'x', permissions: P.ADMINISTRATOR.toString() })).toBe('escalonamento');
    expect(await code('POST', `/api/groups/${groupId}/roles`, gerente, { name: 'x', permissions: (DEFAULT_EVERYONE | P.BAN_MEMBERS).toString() })).toBe('escalonamento');
    expect(await code('PATCH', `/api/roles/${created}`, gerente, { permissions: (DEFAULT_EVERYONE | P.KICK_MEMBERS).toString() })).toBe('escalonamento');
    // Tirar de um cargo uma permissão que o gerente não tem também é recusado.
    expect(await code('PATCH', `/api/roles/${roles.Banidor}`, gerente, { permissions: '0' })).toBe('escalonamento');
    expect(await code('PATCH', `/api/roles/${roles.Banidor}`, gerente, { name: 'Banidor', color: '#ff00aa' })).toBe('ok');
    expect(await code('PATCH', `/api/roles/${created}`, gerente, { permissions: (DEFAULT_EVERYONE & ~P.SEND_LINKS).toString() })).toBe('ok');
    expect(await code('PATCH', `/api/roles/${created}`, gerente, { permissions: '99999999999999999999' })).toBe('permissoes_invalidas');
    await w.ok('DELETE', `/api/roles/${created}`, gerente.token);
  });

  it('não toca no próprio cargo nem nos de cima, e o @everyone só nas permissões que tem', async () => {
    expect(await code('PATCH', `/api/roles/${roles.Gerente}`, gerente, { permissions: ALL_PERMISSIONS.toString() })).toBe('hierarquia');
    expect(await code('PATCH', `/api/roles/${roles.Gerente}`, gerente, { name: 'Chefe' })).toBe('hierarquia');
    expect(await code('PATCH', `/api/roles/${roles.Administrador}`, gerente, { name: 'Ex-admin' })).toBe('hierarquia');
    expect(await code('DELETE', `/api/roles/${roles.Administrador}`, gerente)).toBe('hierarquia');
    expect(await code('DELETE', `/api/roles/${roles.Gerente}`, gerente)).toBe('hierarquia');
    expect(await code('PATCH', `/api/roles/${roles['@everyone']}`, gerente, { permissions: (DEFAULT_EVERYONE | P.MENTION_EVERYONE).toString() })).toBe('escalonamento');
    expect(await code('DELETE', `/api/roles/${roles['@everyone']}`, dono)).toBe('everyone_fixo');
  });

  it('não entrega cargo com permissões que não tem, nem a si mesmo, nem cargo de cima', async () => {
    expect(await code('PATCH', `/api/groups/${groupId}/members/${gerente.id}`, gerente, { roleIds: [roles.Gerente, roles.Banidor] })).toBe('escalonamento');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${comum.id}`, gerente, { roleIds: [roles.Banidor] })).toBe('escalonamento');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${gerente.id}`, gerente, { roleIds: [roles.Gerente, roles.Administrador] })).toBe('hierarquia');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${comum.id}`, gerente, { roleIds: [roles.Gerente] })).toBe('hierarquia');
    // Um cargo permitido, mas para alguém acima (ou o dono): recusado pela hierarquia de membros.
    expect(await code('PATCH', `/api/groups/${groupId}/members/${admin.id}`, gerente, { roleIds: [roles.Administrador, roles.Ajudante] })).toBe('hierarquia');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${dono.id}`, gerente, { roleIds: [roles.Ajudante] })).toBe('hierarquia');
    // O caso legítimo funciona.
    expect(await code('PATCH', `/api/groups/${groupId}/members/${comum.id}`, gerente, { roleIds: [roles.Ajudante] })).toBe('ok');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${comum.id}`, gerente, { roleIds: [] })).toBe('ok');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${comum.id}`, gerente, { roleIds: ['cargo-de-outro-grupo'] })).toBe('cargo_inexistente');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${comum.id}`, gerente, { roleIds: 'Administrador' })).toBe('cargos_invalidos');
    expect((await w.view(dono, groupId)).members.find((member: any) => member.userId === gerente.id).roleIds).toEqual([roles.Gerente]);
  });

  it('não reordena para subir um cargo acima do seu, nem duplica cargo com permissões que não tem', async () => {
    const top = ['Administrador', 'Gerente', 'Moderador'];
    const ids = (names: string[]) => names.map((name) => roles[name]);
    expect(await code('PUT', `/api/groups/${groupId}/roles/order`, gerente, { order: ids(['Ajudante', ...top, 'Banidor']) })).toBe('hierarquia');
    expect(await code('PUT', `/api/groups/${groupId}/roles/order`, gerente, { order: ids(['Gerente', 'Administrador', 'Moderador', 'Banidor', 'Ajudante']) })).toBe('hierarquia');
    expect(await code('PUT', `/api/groups/${groupId}/roles/order`, gerente, { order: ids([...top, 'Ajudante', 'Banidor']) })).toBe('ok');
    expect(await code('PUT', `/api/groups/${groupId}/roles/order`, gerente, { order: ids([...top, 'Banidor']) })).toBe('ordem_invalida');
    expect(await code('PUT', `/api/groups/${groupId}/roles/order`, gerente, { order: ids([...top, 'Banidor', 'Banidor']) })).toBe('ordem_invalida');
    await w.order(dono, groupId, ['Administrador', 'Gerente', 'Moderador', 'Banidor', 'Ajudante']);

    expect(await code('POST', `/api/groups/${groupId}/roles`, gerente, { copyFrom: roles.Banidor })).toBe('escalonamento');
    const copy = await w.ok('POST', `/api/groups/${groupId}/roles`, gerente.token, { copyFrom: roles.Ajudante });
    const copied = ((await w.view(dono, groupId)).roles as any[]).find((role) => role.id === copy.id);
    expect(copied).toMatchObject({ name: 'Ajudante (cópia)', permissions: DEFAULT_EVERYONE.toString() });
    await w.ok('DELETE', `/api/roles/${copy.id}`, dono.token);
    expect(((await w.view(dono, groupId)).roles as any[]).map((role) => role.position)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it('administrador também respeita a hierarquia; o dono pode tudo', async () => {
    expect(await code('PATCH', `/api/roles/${roles.Administrador}`, admin, { name: 'Super' })).toBe('hierarquia');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${comum.id}`, admin, { roleIds: [roles.Administrador] })).toBe('hierarquia');
    expect(await code('POST', `/api/groups/${groupId}/transfer`, admin, { userId: admin.id })).toBe('so_o_dono');
    expect(await code('PATCH', `/api/roles/${roles.Gerente}`, admin, { color: '#00ffaa' })).toBe('ok');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${comum.id}`, dono, { roleIds: [roles.Administrador] })).toBe('ok');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${comum.id}`, dono, { roleIds: [] })).toBe('ok');
  });
});

describe('punições seguem a hierarquia', () => {
  it('moderador só pune quem está abaixo; ninguém pune o dono nem a si mesmo', async () => {
    for (const action of ['kick', 'ban', 'timeout']) {
      const body = action === 'timeout' ? { minutes: 5 } : {};
      expect(await code('POST', `/api/groups/${groupId}/members/${mod2.id}/${action}`, mod, body), `${action} em cargo igual`).toBe('hierarquia');
      expect(await code('POST', `/api/groups/${groupId}/members/${admin.id}/${action}`, mod, body), `${action} em cargo acima`).toBe('hierarquia');
      expect(await code('POST', `/api/groups/${groupId}/members/${dono.id}/${action}`, mod, body), `${action} no dono`).toBe('hierarquia');
      expect(await code('POST', `/api/groups/${groupId}/members/${dono.id}/${action}`, admin, body), `admin: ${action} no dono`).toBe('hierarquia');
      expect(await code('POST', `/api/groups/${groupId}/members/${mod.id}/${action}`, mod, body), `${action} em si mesmo`).toBe('hierarquia');
      expect(await code('POST', `/api/groups/${groupId}/members/${alvo.id}/${action}`, gerente, body), `${action} sem a permissão`).toBe('sem_permissao');
    }
    expect(await code('POST', `/api/groups/${groupId}/members/${alvo.id}/timeout`, mod, { minutes: 5 })).toBe('ok');
    expect(await code('POST', `/api/groups/${groupId}/members/${alvo.id}/timeout`, mod, { minutes: -1 })).toBe('tempo_invalido');
    expect(await code('POST', `/api/groups/${groupId}/members/${alvo.id}/kick`, mod, { reason: 'spam' })).toBe('ok');
    expect(await code('POST', `/api/groups/${groupId}/members/${alvo.id}/kick`, mod, {})).toBe('membro_inexistente');
    expect((await w.api('GET', `/api/groups/${groupId}`, alvo.token)).status).toBe(404);
    await w.join(dono, groupId, alvo);
  });
});

describe('registro de auditoria', () => {
  it('guarda quem fez o quê, com antes e depois', async () => {
    const entries = await audit();
    const find = (action: string) => entries.find((entry) => entry.action === action);
    expect(find('membro.expulso')).toMatchObject({ actorId: mod.id, actorName: 'Mod', targetId: alvo.id, detail: { motivo: 'spam' } });
    expect(find('membro.castigo')).toMatchObject({ actorId: mod.id, targetId: alvo.id });
    expect(find('cargo.reordenado').detail.ordem).toEqual(['Administrador', 'Gerente', 'Moderador', 'Banidor', 'Ajudante']);
    expect(find('membro.cargos')).toMatchObject({ actorId: dono.id, targetId: comum.id, detail: { adicionados: [], removidos: ['Administrador'] } });
    const edited = entries.find((entry) => entry.action === 'cargo.atualizado' && entry.detail.permissoes);
    expect(edited.detail.permissoes).toEqual([DEFAULT_EVERYONE.toString(), (DEFAULT_EVERYONE & ~P.SEND_LINKS).toString()]);
    expect(find('cargo.criado')).toBeDefined();
    expect(find('cargo.excluido')).toBeDefined();
    // O moderador (modelo padrão) pode ler; o registro vem do mais novo para o mais antigo e em páginas.
    const forMod = (await w.ok('GET', `/api/groups/${groupId}/audit`, mod.token)).entries;
    expect(forMod.length).toBeGreaterThan(10);
    expect(Number(forMod[0].id)).toBeGreaterThan(Number(forMod[1].id));
    const older = (await w.ok('GET', `/api/groups/${groupId}/audit?before=${forMod.at(-1).id}`, mod.token)).entries;
    expect(older.every((entry: any) => Number(entry.id) < Number(forMod.at(-1).id))).toBe(true);
  });
});

describe('permissões por canal', () => {
  let area: string, lounge: string, avisos: string, aberto: string;

  beforeAll(async () => {
    area = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'categoria', name: 'Área VIP' })).id;
    await w.ok('PUT', `/api/channels/${area}/overrides/cargo/${roles['@everyone']}`, dono.token, { allow: '0', deny: P.VIEW_CHANNEL.toString() });
    await w.ok('PUT', `/api/channels/${area}/overrides/cargo/${roles.Ajudante}`, dono.token, { allow: P.VIEW_CHANNEL.toString(), deny: '0' });
    lounge = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'texto', name: 'lounge', parentId: area })).id;
    avisos = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'texto', name: 'avisos-vip', parentId: area })).id;
    await w.ok('PUT', `/api/channels/${avisos}/overrides/cargo/${roles.Ajudante}`, dono.token, { allow: '0', deny: P.SEND_MESSAGES.toString() });
    aberto = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'texto', name: 'aberto', parentId: area })).id;
    await w.ok('PUT', `/api/channels/${aberto}/overrides/cargo/${roles['@everyone']}`, dono.token, { allow: P.VIEW_CHANNEL.toString(), deny: '0' });
  });

  it('canal exclusivo: quem tem o cargo vê e escreve; quem não tem nem sabe que existe', async () => {
    const names = async (who: Person) => ((await w.view(who, groupId)).channels as any[]).map((channel) => channel.name);
    expect(await names(vip)).toEqual(expect.arrayContaining(['Área VIP', 'lounge', 'avisos-vip', 'aberto']));
    const seen = await names(comum);
    expect(seen).not.toContain('lounge');
    expect(seen).not.toContain('avisos-vip');
    // Permitir no canal vence o negar herdado da categoria.
    expect(seen).toEqual(expect.arrayContaining(['Área VIP', 'aberto']));

    expect(await code('POST', `/api/channels/${lounge}/messages`, vip, { content: 'só para VIP' })).toBe('ok');
    for (const [method, path, body] of [
      ['GET', `/api/channels/${lounge}/messages`, undefined],
      ['POST', `/api/channels/${lounge}/messages`, { content: 'entrei?' }],
      ['POST', `/api/channels/${lounge}/voice`, {}],
    ] as const) {
      expect(await code(method, path, comum, body), path).toBe('canal_inexistente');
    }
    const secret = (await w.ok('GET', `/api/channels/${lounge}/messages`, vip.token)).messages[0].id;
    expect(await code('DELETE', `/api/messages/${secret}`, comum), 'mensagem de canal invisível "não existe"').toBe('mensagem_inexistente');
    expect(await code('POST', `/api/channels/${aberto}/messages`, comum, { content: 'aqui eu posso' })).toBe('ok');
    expect(((await w.view(vip, groupId)).channels as any[]).find((channel) => channel.id === lounge).private).toBe(true);
  });

  it('negar no canal para o cargo; a regra individual do membro vence a do cargo', async () => {
    expect(await code('POST', `/api/channels/${avisos}/messages`, vip, { content: 'posso?' })).toBe('sem_permissao');
    await w.ok('PUT', `/api/channels/${avisos}/overrides/membro/${vip.id}`, dono.token, { allow: P.SEND_MESSAGES.toString(), deny: '0' });
    expect(await code('POST', `/api/channels/${avisos}/messages`, vip, { content: 'agora sim' })).toBe('ok');
    // Regra vazia apaga a regra: volta a herdar do cargo.
    await w.ok('PUT', `/api/channels/${avisos}/overrides/membro/${vip.id}`, dono.token, { allow: '0', deny: '0' });
    expect(await code('POST', `/api/channels/${avisos}/messages`, vip, { content: 'e agora?' })).toBe('sem_permissao');
    expect((await w.ok('GET', `/api/channels/${avisos}/overrides`, dono.token)).overrides).toEqual([
      { targetKind: 'cargo', targetId: roles.Ajudante, allow: '0', deny: P.SEND_MESSAGES.toString() },
    ]);
  });

  it('permissões efetivas de um membro, canal por canal', async () => {
    const result = await w.ok('GET', `/api/groups/${groupId}/members/${vip.id}/permissions`, dono.token);
    expect(BigInt(result.base)).toBe(DEFAULT_EVERYONE);
    expect(BigInt(result.channels[lounge]) & P.SEND_MESSAGES).toBe(P.SEND_MESSAGES);
    expect(BigInt(result.channels[avisos]) & P.SEND_MESSAGES).toBe(0n);
    expect(BigInt(result.channels[avisos]) & P.VIEW_CHANNEL).toBe(P.VIEW_CHANNEL);
    const forComum = await w.ok('GET', `/api/groups/${groupId}/members/${comum.id}/permissions`, dono.token);
    expect(forComum.channels[lounge]).toBe('0');
    expect((await w.ok('GET', `/api/groups/${groupId}/members/${dono.id}/permissions`, dono.token)).isOwner).toBe(true);
    // Cada um pode consultar as próprias; as dos outros, só quem gerencia cargos. E só aparecem canais que quem pergunta vê.
    const own = await w.ok('GET', `/api/groups/${groupId}/members/${comum.id}/permissions`, comum.token);
    expect(Object.keys(own.channels)).not.toContain(lounge);
    expect(await code('GET', `/api/groups/${groupId}/members/${vip.id}/permissions`, comum)).toBe('sem_permissao');
  });

  it('regras de canal também não servem para se promover', async () => {
    const put = (who: Person, kind: string, target: string, allow: bigint, deny = 0n, channel = geral) =>
      code('PUT', `/api/channels/${channel}/overrides/${kind}/${target}`, who, { allow: allow.toString(), deny: deny.toString() });
    expect(await put(gerente, 'membro', gerente.id, P.MENTION_EVERYONE)).toBe('escalonamento');
    expect(await put(gerente, 'cargo', roles.Ajudante!, P.MANAGE_MESSAGES)).toBe('escalonamento');
    expect(await put(gerente, 'cargo', roles.Ajudante!, 0n, P.MENTION_EVERYONE), 'negar o que não tem também não').toBe('escalonamento');
    expect(await put(gerente, 'cargo', roles.Administrador!, 0n, P.SEND_MESSAGES)).toBe('hierarquia');
    expect(await put(gerente, 'cargo', roles.Gerente!, P.SEND_MESSAGES)).toBe('hierarquia');
    expect(await put(gerente, 'membro', admin.id, 0n, P.SEND_MESSAGES)).toBe('hierarquia');
    expect(await put(dono, 'cargo', roles.Ajudante!, P.KICK_MEMBERS), 'permissão do grupo inteiro não entra em regra de canal').toBe('permissoes_invalidas');
    expect(await put(dono, 'cargo', roles.Ajudante!, P.SEND_MESSAGES, P.SEND_MESSAGES)).toBe('permissoes_invalidas');
    expect(await put(dono, 'grupo', roles.Ajudante!, P.SEND_MESSAGES)).toBe('alvo_invalido');
    expect(await put(dono, 'cargo', 'cargo-que-nao-existe', P.SEND_MESSAGES)).toBe('cargo_inexistente');
    // O gerente não vê a área VIP (não tem o cargo): não consegue nem mexer nas regras dela.
    expect(await put(gerente, 'cargo', roles.Ajudante!, P.SEND_MESSAGES, 0n, lounge)).toBe('canal_inexistente');
    // O uso legítimo funciona e tem efeito.
    expect(await put(gerente, 'cargo', roles.Ajudante!, 0n, P.SEND_LINKS)).toBe('ok');
    expect(await code('POST', `/api/channels/${geral}/messages`, vip, { content: 'https://exemplo.com' })).toBe('sem_permissao');
    expect(await put(gerente, 'cargo', roles.Ajudante!, 0n, 0n)).toBe('ok');
    expect(await code('POST', `/api/channels/${geral}/messages`, vip, { content: 'https://exemplo.com' })).toBe('ok');
  });

  it('gerenciar canais: validações, canal privado e quem não vê o canal não mexe nele', async () => {
    const maker = await w.signup('criador');
    await w.join(dono, groupId, maker);
    const canais = await w.role(dono, groupId, 'Canais', DEFAULT_EVERYONE | P.MANAGE_CHANNELS);
    await w.give(dono, groupId, maker, [canais]);

    expect(await code('POST', `/api/groups/${groupId}/channels`, maker, { kind: 'video', name: 'x' })).toBe('tipo_invalido');
    expect(await code('POST', `/api/groups/${groupId}/channels`, maker, { kind: 'texto', name: '   ' })).toBe('nome_invalido');
    expect(await code('POST', `/api/groups/${groupId}/channels`, maker, { kind: 'texto', name: 'x', parentId: geral })).toBe('categoria_invalida');
    expect(await code('POST', `/api/groups/${groupId}/channels`, maker, { kind: 'categoria', name: 'x', parentId: area })).toBe('categoria_invalida');
    expect(await code('POST', `/api/groups/${groupId}/channels`, maker, { kind: 'texto', name: 'x', parentId: area }), 'categoria que ele não vê').toBe('categoria_invalida');
    expect(await code('POST', `/api/groups/${groupId}/channels`, maker, { kind: 'voz', name: 'x', userLimit: 500 })).toBe('limite_invalido');
    // Canal privado que ele não enxerga: para ele não existe, então não renomeia nem apaga.
    expect(await code('PATCH', `/api/channels/${lounge}`, maker, { name: 'tomado' })).toBe('canal_inexistente');
    expect(await code('DELETE', `/api/channels/${lounge}`, maker)).toBe('canal_inexistente');
    expect(await code('PUT', `/api/groups/${groupId}/channels/order`, maker, { items: [{ id: lounge, position: 0 }] })).toBe('ordem_invalida');

    const privado = (await w.ok('POST', `/api/groups/${groupId}/channels`, maker.token, { kind: 'texto', name: 'so-meu', private: true, topic: 'assunto' })).id;
    expect(await code('POST', `/api/channels/${privado}/messages`, maker, { content: 'criador entra' })).toBe('ok');
    expect(await code('GET', `/api/channels/${privado}/messages`, comum)).toBe('canal_inexistente');
    expect(await code('GET', `/api/channels/${privado}/messages`, admin), 'administrador vê tudo').toBe('ok');

    const voz = (await w.ok('POST', `/api/groups/${groupId}/channels`, maker.token, { kind: 'voz', name: 'Duo', userLimit: 2 })).id;
    await w.ok('PATCH', `/api/channels/${voz}`, maker.token, { name: 'Trio', userLimit: 3 });
    await w.ok('PUT', `/api/groups/${groupId}/channels/order`, maker.token, { items: [{ id: voz, position: 7 }, { id: privado, position: 3 }] });
    const state = (await w.view(maker, groupId)).channels as any[];
    expect(state.find((channel) => channel.id === voz)).toMatchObject({ name: 'Trio', userLimit: 3, position: 7 });
    await w.ok('DELETE', `/api/channels/${voz}`, maker.token);
    await w.ok('DELETE', `/api/channels/${privado}`, maker.token);
    expect((await audit()).some((entry) => entry.action === 'canal.excluido' && entry.actorId === maker.id)).toBe(true);
  });

  it('excluir um cargo ou expulsar um membro leva junto as regras de canal deles', async () => {
    const temp = await w.role(dono, groupId, 'Temporário', DEFAULT_EVERYONE);
    await w.ok('PUT', `/api/channels/${geral}/overrides/cargo/${temp}`, dono.token, { allow: '0', deny: P.SEND_MESSAGES.toString() });
    await w.ok('PUT', `/api/channels/${geral}/overrides/membro/${alvo.id}`, dono.token, { allow: '0', deny: P.SEND_MESSAGES.toString() });
    expect((await w.ok('GET', `/api/channels/${geral}/overrides`, dono.token)).overrides).toHaveLength(2);
    await w.ok('DELETE', `/api/roles/${temp}`, dono.token);
    await w.ok('POST', `/api/groups/${groupId}/members/${alvo.id}/kick`, dono.token, {});
    expect((await w.ok('GET', `/api/channels/${geral}/overrides`, dono.token)).overrides).toEqual([]);
    await w.join(dono, groupId, alvo);
    expect(await code('POST', `/api/channels/${geral}/messages`, alvo, { content: 'de volta, sem a regra antiga' })).toBe('ok');
  });
});
