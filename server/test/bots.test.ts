// Central de Bots (Fase 1) e os bots da Fase 2: AutoMod, Boas-vindas e Cargos, Lembretes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_EVERYONE, P } from '../../shared/permissions.ts';
import { officialBots } from '../src/bots/catalog.ts';
import { splitArgs } from '../src/bots/runtime.ts';
import type { BotModule } from '../src/bots/types.ts';
import { fill, parseWhen } from '../src/bots/util.ts';
import { Community } from '../src/community/core.ts';
import { Hub } from '../src/community/hub.ts';
import { config, createWorld, Unlimited, type Person, type World } from './world.ts';

/** Bots de teste: um que repete tudo (para provar que não há laço) e um que sempre falha. */
const echo: BotModule = {
  id: 'eco',
  name: 'Eco',
  about: 'Repete as mensagens.',
  category: 'Diversão',
  icon: 'bot',
  features: [],
  permissions: P.VIEW_CHANNEL | P.SEND_MESSAGES,
  defaultConfig: { prefixo: 'eco: ', vezes: 1 },
  fields: [
    { key: 'prefixo', type: 'text', label: 'Prefixo' },
    { key: 'vezes', type: 'number', label: 'Vezes', min: 1, max: 3 },
  ],
  async onEvent(ctx, event) {
    if (event.type === 'message' && !event.message.content.startsWith('/')) await ctx.say(event.channel.id, `${String(ctx.install.config.prefixo)}${event.message.content}`);
  },
  commands: [
    { name: 'ping', usage: 'ping', about: 'Responde pong.', run: async () => 'pong' },
    { name: 'segredo', usage: 'segredo', about: 'Só para a moderação.', permission: P.USE_ADMIN_TOOLS, run: async (_ctx, call) => `argumentos: ${call.argv.join('|')}` },
  ],
};
const broken: BotModule = {
  id: 'quebrado',
  name: 'Quebrado',
  about: 'Falha sempre.',
  category: 'Diversão',
  icon: 'bot',
  features: [],
  permissions: P.VIEW_CHANNEL,
  defaultConfig: {},
  fields: [],
  async onEvent() {
    throw new Error('defeito de propósito');
  },
};

let w: World;
let serial = 0;
const person = (prefix: string): Promise<Person> => w.signup(`${prefix}${++serial}`);
const code = async (method: string, path: string, who: Person, body?: unknown) => {
  const result = await w.api(method, path, who.token, body);
  return result.status === 200 ? 'ok' : (result.json.error.code as string);
};
const install = (who: Person, groupId: string, botId: string) => w.ok('POST', `/api/groups/${groupId}/bots`, who.token, { botId });
const configure = (who: Person, groupId: string, botId: string, patch: object) => w.ok('PATCH', `/api/groups/${groupId}/bots/${botId}`, who.token, patch);
const installed = async (who: Person, groupId: string, botId: string) => ((await w.ok('GET', `/api/groups/${groupId}/bots`, who.token)).installed as any[]).find((item) => item.botId === botId);
const logs = async (who: Person, groupId: string) => (await w.ok('GET', `/api/groups/${groupId}/bots/logs`, who.token)).entries as any[];
const memberOf = async (who: Person, groupId: string, userId: string) => ((await w.view(who, groupId)).members as any[]).find((member) => member.userId === userId);

beforeAll(async () => {
  w = await createWorld(new Unlimited(), [...officialBots(), echo, broken]);
}, 60_000);

describe('Central de Bots: instalar, configurar e remover', () => {
  it('a biblioteca descreve cada bot, com as permissões que ele pede', async () => {
    const dono = await person('dono');
    expect((await w.api('GET', '/api/bots')).status).toBe(401);
    const { bots } = await w.ok('GET', '/api/bots', dono.token);
    const automod = bots.find((bot: any) => bot.id === 'automod');
    expect(automod).toMatchObject({ name: 'AutoMod', category: 'Moderação' });
    expect(BigInt(automod.permissions)).toBe(P.VIEW_CHANNEL | P.SEND_MESSAGES | P.DELETE_MESSAGES | P.KICK_MEMBERS | P.BAN_MEMBERS);
    expect(automod.fields.length).toBeGreaterThan(10);
    expect(automod.commands.map((command: any) => command.name)).toEqual(['advertir', 'advertencias', 'perdoar']);
    expect(bots.map((bot: any) => bot.id)).toEqual(expect.arrayContaining(['automod', 'boas-vindas', 'lembretes']));
  });

  it('instalar exige a permissão e todas as permissões que o bot vai ter', async () => {
    const dono = await person('dono');
    const comum = await person('comum');
    const instalador = await person('instalador');
    const groupId = await w.group(dono);
    await w.join(dono, groupId, comum, instalador);
    await w.give(dono, groupId, instalador, [await w.role(dono, groupId, 'Instalador', DEFAULT_EVERYONE | P.INSTALL_BOTS | P.CONFIGURE_BOTS)]);

    expect(await code('POST', `/api/groups/${groupId}/bots`, comum, { botId: 'eco' })).toBe('sem_permissao');
    // Tem "Instalar bots", mas o AutoMod bane e expulsa: instalar não pode ser atalho para ganhar esses poderes.
    const refused = await w.api('POST', `/api/groups/${groupId}/bots`, instalador.token, { botId: 'automod' });
    expect(refused.json.error.code).toBe('escalonamento');
    expect(refused.json.error.message).toMatch(/Expulsar membros/);
    expect(await code('POST', `/api/groups/${groupId}/bots`, instalador, { botId: 'eco' })).toBe('ok');
    expect(await code('POST', `/api/groups/${groupId}/bots`, instalador, { botId: 'eco' })).toBe('ja_instalado');
    expect(await code('POST', `/api/groups/${groupId}/bots`, dono, { botId: 'nao-existe' })).toBe('bot_inexistente');
    expect(await code('GET', `/api/groups/${groupId}/bots`, comum)).toBe('sem_permissao');
    expect(await code('GET', `/api/groups/${groupId}/bots/logs`, instalador), 'ver logs é outra permissão').toBe('sem_permissao');
  });

  it('o bot vira um membro com um cargo próprio, no pé da hierarquia, só com o que pediu', async () => {
    const dono = await person('dono');
    const groupId = await w.group(dono);
    await install(dono, groupId, 'automod');
    const state = await w.view(dono, groupId);
    const role = state.roles.find((item: any) => item.botId === 'automod');
    expect(role).toMatchObject({ name: 'AutoMod', position: 1, memberCount: 1 });
    expect(BigInt(role.permissions)).toBe(P.VIEW_CHANNEL | P.SEND_MESSAGES | P.DELETE_MESSAGES | P.KICK_MEMBERS | P.BAN_MEMBERS);
    expect(state.roles.map((item: any) => [item.name, item.position])).toEqual([['Administrador', 3], ['Moderador', 2], ['AutoMod', 1], ['@everyone', 0]]);
    const bot = state.members.find((member: any) => member.bot);
    expect(bot).toMatchObject({ displayName: 'AutoMod', online: true, roleIds: [role.id] });
    expect((await installed(dono, groupId, 'automod')).status).toMatchObject({ state: 'aviso' });
    const audit = (await w.ok('GET', `/api/groups/${groupId}/audit`, dono.token)).entries;
    expect(audit[0]).toMatchObject({ action: 'bot.instalado', targetName: 'AutoMod', actorId: dono.id });
  });

  it('a conta e o cargo do bot só mudam pela Central de Bots', async () => {
    const dono = await person('dono');
    const groupId = await w.group(dono);
    await install(dono, groupId, 'eco');
    const state = await w.view(dono, groupId);
    const bot = state.members.find((member: any) => member.bot);
    const role = state.roles.find((item: any) => item.botId === 'eco');
    const admin = state.roles.find((item: any) => item.name === 'Administrador');

    // Ninguém entra como o bot: a conta não tem senha válida.
    expect((await w.api('POST', '/api/auth/login', null, { username: bot.username, password: '!' })).status).toBe(401);
    expect((await w.api('POST', '/api/auth/register', null, { username: 'bot-eco', password: 'senha-de-teste-1' })).json.error.code).toBe('usuario_invalido');
    for (const action of ['kick', 'ban', 'timeout']) {
      expect(await code('POST', `/api/groups/${groupId}/members/${bot.userId}/${action}`, dono, { minutes: 5 }), action).toBe('bot_gerenciado');
    }
    expect(await code('PATCH', `/api/groups/${groupId}/members/${bot.userId}`, dono, { roleIds: [role.id, admin.id] }), 'dar Administrador ao bot').toBe('bot_gerenciado');
    expect(await code('POST', `/api/groups/${groupId}/transfer`, dono, { userId: bot.userId })).toBe('bot_gerenciado');
    expect(await code('PATCH', `/api/roles/${role.id}`, dono, { permissions: P.ADMINISTRATOR.toString() }), 'aumentar o cargo do bot').toBe('cargo_de_bot');
    expect(await code('DELETE', `/api/roles/${role.id}`, dono)).toBe('cargo_de_bot');
    expect(await code('PATCH', `/api/groups/${groupId}/members/${dono.id}`, dono, { roleIds: [role.id] }), 'pegar o cargo do bot').toBe('cargo_de_bot');
    // A posição na hierarquia é a única coisa que se muda por fora: é ela que diz sobre quem o bot pode agir.
    await w.order(dono, groupId, ['Administrador', 'Eco', 'Moderador']);
    expect((await w.view(dono, groupId)).roles.find((item: any) => item.botId === 'eco').position).toBe(2);
  });

  it('configurar: campos conferidos um a um, canais, cargos, nome e prefixo', async () => {
    const dono = await person('dono');
    const comum = await person('comum');
    const groupId = await w.group(dono);
    await w.join(dono, groupId, comum);
    await install(dono, groupId, 'eco');
    const geral = (await w.channelByName(dono, groupId, 'geral'))!;

    expect(await code('PATCH', `/api/groups/${groupId}/bots/eco`, comum, { enabled: false })).toBe('sem_permissao');
    const bad = await w.api('PATCH', `/api/groups/${groupId}/bots/eco`, dono.token, { config: { vezes: 99 } });
    expect(bad.json.error).toMatchObject({ code: 'config_invalida' });
    expect(bad.json.error.message).toMatch(/“Vezes”/);
    expect(await code('PATCH', `/api/groups/${groupId}/bots/eco`, dono, { config: { prefixo: 12 } })).toBe('config_invalida');
    expect(await code('PATCH', `/api/groups/${groupId}/bots/eco`, dono, { channels: ['canal-inventado'] })).toBe('config_invalida');
    expect(await code('PATCH', `/api/groups/${groupId}/bots/eco`, dono, { prefix: '/x' })).toBe('prefixo_invalido');
    expect(await code('PATCH', `/api/groups/${groupId}/bots/nao-instalado`, dono, {})).toBe('bot_inexistente');

    await configure(dono, groupId, 'eco', { config: { prefixo: 'repito>', campoQueNaoExiste: 'x' }, displayName: 'Papagaio', prefix: '?' });
    const now = await installed(dono, groupId, 'eco');
    expect(now).toMatchObject({ config: { prefixo: 'repito>', vezes: 1 }, displayName: 'Papagaio', prefix: '?', status: { state: 'ativo' } });
    expect(now.config).not.toHaveProperty('campoQueNaoExiste');
    expect((await w.view(dono, groupId)).members.find((member: any) => member.bot).displayName).toBe('Papagaio');

    await w.say(comum, geral, 'olá');
    expect(await w.texts(dono, geral)).toEqual(['olá', 'repito>olá']);
    const [, reply] = (await w.ok('GET', `/api/channels/${geral}/messages`, dono.token)).messages;
    expect(reply.author).toMatchObject({ name: 'Papagaio', bot: true });

    // Desligado, não reage; restrito a outro canal, também não.
    await configure(dono, groupId, 'eco', { enabled: false });
    await w.say(comum, geral, 'tem alguém aí?');
    expect((await installed(dono, groupId, 'eco')).status.state).toBe('desativado');
    const outro = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'texto', name: 'outro' })).id;
    await configure(dono, groupId, 'eco', { enabled: true, channels: [outro] });
    await w.say(comum, geral, 'e agora?');
    await w.say(comum, outro, 'aqui sim');
    expect(await w.texts(dono, geral)).toEqual(['olá', 'repito>olá', 'tem alguém aí?', 'e agora?']);
    expect(await w.texts(dono, outro)).toEqual(['aqui sim', 'repito>aqui sim']);

    const audit = ((await w.ok('GET', `/api/groups/${groupId}/audit`, dono.token)).entries as any[]).filter((entry) => entry.action === 'bot.configurado');
    expect(audit.length).toBe(3);
    expect((await logs(dono, groupId)).map((entry) => entry.action)).toEqual(expect.arrayContaining(['instalado', 'configurado']));
  });

  it('remover leva junto a conta, o cargo, os dados e as tarefas do bot', async () => {
    const dono = await person('dono');
    const comum = await person('comum');
    const groupId = await w.group(dono);
    await w.join(dono, groupId, comum);
    await install(dono, groupId, 'lembretes');
    const geral = (await w.channelByName(dono, groupId, 'geral'))!;
    await w.say(dono, geral, '/lembrete em 10m beber água');
    expect((await w.db.query('SELECT 1 FROM bot_jobs WHERE group_id = $1', [groupId])).length).toBe(1);

    expect(await code('DELETE', `/api/groups/${groupId}/bots/lembretes`, comum)).toBe('sem_permissao');
    await w.ok('DELETE', `/api/groups/${groupId}/bots/lembretes`, dono.token);
    const state = await w.view(dono, groupId);
    expect(state.members.some((member: any) => member.bot)).toBe(false);
    expect(state.roles.map((item: any) => [item.name, item.position])).toEqual([['Administrador', 2], ['Moderador', 1], ['@everyone', 0]]);
    for (const table of ['bot_jobs', 'bot_data', 'bot_installs']) expect((await w.db.query(`SELECT 1 FROM ${table} WHERE group_id = $1`, [groupId])).length, table).toBe(0);
    expect((await w.db.query(`SELECT 1 FROM users WHERE username_key = $1`, [`bot-lembretes-${groupId}`.toLowerCase()])).length).toBe(0);
    expect(await code('DELETE', `/api/groups/${groupId}/bots/lembretes`, dono)).toBe('bot_nao_instalado');
    // O histórico continua disponível depois da remoção.
    expect((await logs(dono, groupId)).map((entry) => entry.action)).toContain('removido');
    await w.clock.now.setTime(w.clock.now.getTime() + 3_600_000);
    expect(await w.bots.tick()).toBe(0);
  });
});

describe('comandos, isolamento de falhas e laços', () => {
  let dono: Person, comum: Person, mod: Person;
  let groupId: string, geral: string;

  beforeAll(async () => {
    dono = await person('dono');
    comum = await person('comum');
    mod = await person('mod');
    groupId = await w.group(dono);
    await w.join(dono, groupId, comum, mod);
    const state = await w.view(dono, groupId);
    await w.give(dono, groupId, mod, [state.roles.find((role: any) => role.name === 'Moderador').id]);
    geral = (await w.channelByName(dono, groupId, 'geral'))!;
    await install(dono, groupId, 'eco');
  });

  it('os bots não reagem a mensagens de bots: não há como entrar em laço', async () => {
    await w.say(comum, geral, 'um');
    expect(await w.texts(dono, geral)).toEqual(['um', 'eco: um']);
  });

  it('comando com barra, com o prefixo do bot, com permissão extra e a ajuda', async () => {
    await w.say(comum, geral, '/ping');
    await w.say(comum, geral, '!ping');
    await w.say(comum, geral, '/comando-que-nao-existe');
    await w.say(comum, geral, '/segredo');
    await w.say(mod, geral, '/segredo um "dois três" quatro');
    await w.say(comum, geral, '/ajuda');
    const texts = await w.texts(dono, geral);
    expect(texts.filter((text) => text === 'pong')).toHaveLength(2);
    expect(texts).toContain('Comum, o comando /segredo exige a permissão “Utilizar ferramentas administrativas”.'.replace('Comum', `Comum${comum.name.slice(5)}`));
    expect(texts).toContain('argumentos: um|dois três|quatro');
    const help = texts.at(-1)!;
    expect(help).toMatch(/\/ping — Responde pong\./);
    expect(help, 'a ajuda só lista o que a pessoa pode usar').not.toMatch(/segredo/);
    expect((await w.ok('GET', `/api/groups/${groupId}/commands`, mod.token)).commands.map((item: any) => item.name)).toEqual(['ping', 'segredo']);
    expect(splitArgs('a "b c" “d e” f')).toEqual(['a', 'b c', 'd e', 'f']);
  });

  it('sem “Executar comandos”, fora dos cargos escolhidos ou rápido demais, o comando não roda', async () => {
    const everyone = (await w.view(dono, groupId)).roles.find((role: any) => role.isEveryone);
    await w.ok('PUT', `/api/channels/${geral}/overrides/membro/${comum.id}`, dono.token, { allow: '0', deny: P.USE_COMMANDS.toString() });
    await w.say(comum, geral, '/ping');
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/não tem a permissão “Executar comandos”/);
    await w.ok('PUT', `/api/channels/${geral}/overrides/membro/${comum.id}`, dono.token, { allow: '0', deny: '0' });

    const moderador = (await w.view(dono, groupId)).roles.find((role: any) => role.name === 'Moderador').id;
    await configure(dono, groupId, 'eco', { commandRoles: [moderador] });
    await w.say(comum, geral, '/ping');
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/reservados a alguns cargos/);
    await w.say(mod, geral, '/ping');
    expect((await w.texts(dono, geral)).at(-1)).toBe('pong');
    await w.say(dono, geral, '/ping');
    expect((await w.texts(dono, geral)).at(-1), 'o dono passa pela restrição de cargos').toBe('pong');
    await configure(dono, groupId, 'eco', { commandRoles: [everyone.id] });

    const limited = await createWorld(new Unlimited(), [echo]);
    const apressado = await limited.signup('apressado');
    const other = await limited.group(apressado);
    const channel = (await limited.channelByName(apressado, other, 'geral'))!;
    await limited.ok('POST', `/api/groups/${other}/bots`, apressado.token, { botId: 'eco' });
    for (let index = 0; index < 8; index++) await limited.say(apressado, channel, '/ping', 0);
    const texts = await limited.texts(apressado, channel);
    expect(texts.filter((text) => text === 'pong')).toHaveLength(6);
    expect(texts.filter((text) => /devagar/.test(text))).toHaveLength(2);
  }, 60_000);

  it('um bot que falha fica registrado e não atrapalha os outros nem a mensagem', async () => {
    await install(dono, groupId, 'quebrado');
    const sent = await w.say(comum, geral, 'continua funcionando?');
    expect(sent.status).toBe(200);
    expect((await w.texts(dono, geral)).slice(-2)).toEqual(['continua funcionando?', 'eco: continua funcionando?']);
    expect((await installed(dono, groupId, 'quebrado')).status).toMatchObject({ state: 'erro' });
    expect((await installed(dono, groupId, 'quebrado')).status.text).toMatch(/defeito de propósito/);
    const failure = (await logs(dono, groupId)).find((entry) => entry.action === 'falha');
    expect(failure).toMatchObject({ botId: 'quebrado', level: 'erro', detail: { erro: 'defeito de propósito' } });
    expect((await w.ok('GET', `/api/groups/${groupId}/bots/logs?bot=eco`, dono.token)).entries.every((entry: any) => entry.botId === 'eco')).toBe(true);
    await w.ok('DELETE', `/api/groups/${groupId}/bots/quebrado`, dono.token);
  });

  it('um bot só fala onde pode falar; a recusa vira registro', async () => {
    const mudo = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'texto', name: 'sem-bots' })).id;
    const role = (await w.view(dono, groupId)).roles.find((item: any) => item.botId === 'eco').id;
    await w.ok('PUT', `/api/channels/${mudo}/overrides/cargo/${role}`, dono.token, { allow: '0', deny: P.SEND_MESSAGES.toString() });
    await w.say(comum, mudo, 'ninguém repete aqui');
    expect(await w.texts(dono, mudo)).toEqual(['ninguém repete aqui']);
    expect((await logs(dono, groupId)).find((entry) => entry.action === 'mensagem não enviada')).toMatchObject({ botId: 'eco', level: 'aviso' });
  });
});

describe('AutoMod', () => {
  let dono: Person, comum: Person, mod: Person, vip: Person;
  let groupId: string, geral: string, roles: Record<string, string>;
  const timedOut = async (who: Person) => (await memberOf(dono, groupId, who.id))?.timeoutUntil ?? null;
  const pardon = async (who: Person) => {
    await w.ok('POST', `/api/groups/${groupId}/members/${who.id}/timeout`, dono.token, { minutes: 0 });
    await w.clock.now.setTime(w.clock.now.getTime() + 600_000);
  };

  beforeAll(async () => {
    [dono, comum, mod, vip] = [await person('dono'), await person('comum'), await person('mod'), await person('vip')];
    groupId = await w.group(dono);
    await w.join(dono, groupId, comum, mod, vip);
    await w.role(dono, groupId, 'VIP', DEFAULT_EVERYONE);
    await install(dono, groupId, 'automod');
    roles = Object.fromEntries(((await w.view(dono, groupId)).roles as any[]).map((role) => [role.name, role.id]));
    await w.give(dono, groupId, mod, [roles.Moderador!]);
    await w.give(dono, groupId, vip, [roles.VIP!]);
    // AutoMod acima do VIP e abaixo do Moderador.
    await w.order(dono, groupId, ['Administrador', 'Moderador', 'AutoMod', 'VIP']);
    geral = (await w.channelByName(dono, groupId, 'geral'))!;
    await configure(dono, groupId, 'automod', { config: { palavras: ['bobão', 'cala a boca'], spamMensagens: 0, repetidas: 0 } });
  });

  it('palavra proibida: apaga, adverte e registra; acento e maiúsculas não escapam, palavra parecida escapa', async () => {
    await w.say(comum, geral, 'você é um BOBAO mesmo');
    expect(await w.texts(dono, geral)).toEqual([`⚠ ${comum.name[0]!.toUpperCase()}${comum.name.slice(1)}: palavra proibida. (advertência 1)`]);
    await w.say(comum, geral, 'que bobãozinho'); // outra palavra
    await w.say(comum, geral, 'Cala  a boca'.replace('  ', ' '));
    const texts = await w.texts(dono, geral);
    expect(texts).toContain('que bobãozinho');
    expect(texts.at(-1)).toMatch(/advertência 2/);
    expect(texts.filter((text) => /cala a boca/i.test(text))).toEqual([]);

    const audit = (await w.ok('GET', `/api/groups/${groupId}/audit`, dono.token)).entries as any[];
    expect(audit.find((entry) => entry.action === 'mensagem.excluida')).toMatchObject({ actorName: 'AutoMod' });
    expect((await logs(dono, groupId)).filter((entry) => entry.action === 'advertência')).toHaveLength(2);
  });

  it('na terceira advertência vem o castigo configurado', async () => {
    await w.say(comum, geral, 'bobão');
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/castigo de 10 min com 3 advertências/);
    expect(await timedOut(comum)).not.toBeNull();
    expect((await w.say(comum, geral, 'posso falar?')).json.error.code).toBe('em_castigo');
    await pardon(comum);
    await w.say(mod, geral, `/perdoar ${comum.name}`);
    await w.say(mod, geral, `/advertencias ${comum.name}`);
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/não tem advertências válidas/);
  });

  it('links, convites e tipos de arquivo', async () => {
    await configure(dono, groupId, 'automod', { config: { bloquearLinks: true, dominiosPermitidos: ['youtube.com'], bloquearConvites: true, extensoesBloqueadas: ['exe'], linksAcao: 'apagar' } });
    const kept: string[] = [];
    for (const [text, stays] of [
      ['olha https://site-estranho.example/pagina', false],
      ['www.outro.example', false],
      ['video: https://www.youtube.com/watch?v=abc', true],
      ['entra aqui https://exemplo.github.io/shareroom/#/convite/AbCdEf123456', false],
      ['baixa https://youtube.com/arquivo.exe', false],
      ['sem link nenhum', true],
    ] as const) {
      await w.say(comum, geral, text);
      if (stays) kept.push(text);
    }
    const texts = await w.texts(dono, geral);
    for (const text of kept) expect(texts).toContain(text);
    expect(texts.filter((text) => /example|convite|\.exe/.test(text))).toEqual([]);
    expect((await logs(dono, groupId)).filter((entry) => entry.action === 'mensagem removida').map((entry) => entry.detail.motivo)).toEqual(
      expect.arrayContaining(['link não autorizado', 'convite não autorizado', 'link para arquivo .exe']),
    );
    await configure(dono, groupId, 'automod', { config: { bloquearLinks: false, bloquearConvites: false, extensoesBloqueadas: [] } });
  });

  it('enxurrada e repetição levam ao castigo; maiúsculas só apaga', async () => {
    await configure(dono, groupId, 'automod', { config: { spamMensagens: 4, spamSegundos: 10, repetidas: 0, spamAcao: 'castigo', castigoMinutos: 5 } });
    w.clock.now = new Date(w.clock.now.getTime() + 300_000);
    for (let index = 1; index <= 4; index++) expect((await w.say(comum, geral, `mensagem ${index}`, 1000)).status).toBe(200);
    expect(await timedOut(comum)).toBeNull();
    await w.say(comum, geral, 'mensagem 5', 1000);
    expect(await timedOut(comum), 'a quinta em 10 segundos passa do limite').not.toBeNull();
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/mensagens demais em pouco tempo\. \(castigo de 5 min\)/);
    await pardon(comum);

    await configure(dono, groupId, 'automod', { config: { spamMensagens: 0, repetidas: 3 } });
    await w.say(comum, geral, 'compre agora');
    await w.say(comum, geral, 'Compre AGORA');
    expect(await timedOut(comum)).toBeNull();
    await w.say(comum, geral, 'compre agora');
    expect(await timedOut(comum)).not.toBeNull();
    await pardon(comum);

    await configure(dono, groupId, 'automod', { config: { repetidas: 0, maiusculas: true } });
    await w.say(comum, geral, 'ISSO AQUI É UM GRITO BEM COMPRIDO MESMO');
    await w.say(comum, geral, 'OK');
    const texts = await w.texts(dono, geral);
    expect(texts).not.toContain('ISSO AQUI É UM GRITO BEM COMPRIDO MESMO');
    expect(texts.at(-1)).toBe('OK');
    await configure(dono, groupId, 'automod', { config: { maiusculas: false } });
  });

  it('exceções: dono, quem modera mensagens, cargo, pessoa e canal isentos', async () => {
    const livre = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'texto', name: 'livre' })).id;
    await configure(dono, groupId, 'automod', { config: { canaisIsentos: [livre] } });
    await w.say(dono, geral, 'o dono diz bobão');
    await w.say(mod, geral, 'o moderador diz bobão');
    await w.say(comum, livre, 'no canal livre: bobão');
    await w.say(vip, geral, 'vip sem isenção: bobão');
    await configure(dono, groupId, 'automod', { config: { cargosIsentos: [roles.VIP], membrosIsentos: [comum.id] } });
    await w.say(vip, geral, 'vip isento: bobão');
    await w.say(comum, geral, 'pessoa isenta: bobão');
    const texts = await w.texts(dono, geral);
    for (const text of ['o dono diz bobão', 'o moderador diz bobão', 'vip isento: bobão', 'pessoa isenta: bobão']) expect(texts).toContain(text);
    expect(texts).not.toContain('vip sem isenção: bobão');
    expect(await w.texts(dono, livre)).toEqual(['no canal livre: bobão']);
    await configure(dono, groupId, 'automod', { config: { cargosIsentos: [], membrosIsentos: [], canaisIsentos: [] } });
  });

  it('o bot respeita a hierarquia: apaga a mensagem, mas não castiga quem está acima do cargo dele', async () => {
    await w.order(dono, groupId, ['Administrador', 'Moderador', 'VIP', 'AutoMod']);
    await configure(dono, groupId, 'automod', { config: { palavrasAcao: 'castigo' } });
    await w.say(vip, geral, 'bobão');
    expect(await timedOut(vip), 'VIP está acima do AutoMod').toBeNull();
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/palavra proibida\. Mensagem removida\./);
    const refused = (await logs(dono, groupId)).find((entry) => entry.action === 'ação recusada');
    expect(refused.detail.motivo).toMatch(/abaixo do seu cargo mais alto/);
    expect((await installed(dono, groupId, 'automod')).status.text).toMatch(/não consegue castigar, expulsar nem banir/);

    // Subindo o cargo do bot, a mesma regra passa a valer para o VIP.
    await w.order(dono, groupId, ['Administrador', 'Moderador', 'AutoMod', 'VIP']);
    await w.say(vip, geral, 'bobão de novo');
    expect(await timedOut(vip)).not.toBeNull();
    await w.ok('POST', `/api/groups/${groupId}/members/${vip.id}/timeout`, dono.token, { minutes: 0 });
    await configure(dono, groupId, 'automod', { config: { palavrasAcao: 'advertir' } });
  });

  it('expulsar e banir pela configuração; mensagem apagada não vira comando', async () => {
    const alvo = await person('alvo');
    await w.join(dono, groupId, alvo);
    await install(dono, groupId, 'eco');
    await configure(dono, groupId, 'automod', { config: { palavras: ['bobão', 'ping'], palavrasAcao: 'apagar' } });
    await w.say(alvo, geral, '/ping');
    expect(await w.texts(dono, geral), 'o AutoMod apagou antes: nem o comando nem o eco rodam').not.toContain('pong');
    await w.ok('DELETE', `/api/groups/${groupId}/bots/eco`, dono.token);

    await configure(dono, groupId, 'automod', { config: { palavras: ['bobão'], palavrasAcao: 'expulsar' } });
    await w.say(alvo, geral, 'bobão');
    expect(await memberOf(dono, groupId, alvo.id)).toBeUndefined();
    await w.join(dono, groupId, alvo);
    await configure(dono, groupId, 'automod', { config: { palavrasAcao: 'banir' } });
    await w.say(alvo, geral, 'bobão');
    expect((await w.ok('GET', `/api/groups/${groupId}/bans`, dono.token)).bans[0]).toMatchObject({ userId: alvo.id, reason: 'AutoMod: palavra proibida' });
    const audit = (await w.ok('GET', `/api/groups/${groupId}/audit`, dono.token)).entries as any[];
    expect(audit.find((entry) => entry.action === 'membro.banido')).toMatchObject({ actorName: 'AutoMod', targetId: alvo.id });
    await configure(dono, groupId, 'automod', { config: { palavrasAcao: 'advertir' } });
  });

  it('advertência manual exige a ferramenta administrativa e respeita a hierarquia de quem adverte', async () => {
    // O VIP já recebeu advertências em outros cenários; este alvo começa sem histórico.
    const alvo = await person('advertido');
    await w.join(dono, groupId, alvo);
    await w.say(comum, geral, `/advertir ${alvo.name} motivo qualquer`);
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/exige a permissão “Utilizar ferramentas administrativas”/);
    await w.say(mod, geral, `/advertir ${dono.name} tentando advertir o dono`);
    expect((await w.texts(dono, geral)).at(-1)).toBe('Você só pode advertir quem está abaixo do seu cargo mais alto.');
    await w.say(mod, geral, `/advertir @${alvo.name} flood no canal`);
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/flood no canal\. \(advertência 1\)/);
    await w.say(mod, geral, `/advertencias ${alvo.name}`);
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/tem 1 advertência:/);
    await w.say(mod, geral, '/advertir fulano-que-nao-existe x');
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/Não achei essa pessoa/);
  });

  it('desligado, o AutoMod não toca em nada', async () => {
    await configure(dono, groupId, 'automod', { enabled: false });
    await w.say(comum, geral, 'bobão com o bot desligado');
    expect(await w.texts(dono, geral)).toContain('bobão com o bot desligado');
    await configure(dono, groupId, 'automod', { enabled: true });
  });
});

describe('Boas-vindas e Cargos', () => {
  let dono: Person;
  let groupId: string, geral: string, roles: Record<string, string>;
  const refresh = async () => (roles = Object.fromEntries(((await w.view(dono, groupId)).roles as any[]).map((role) => [role.name, role.id])));
  const rolesOf = async (who: Person) => ((await memberOf(dono, groupId, who.id)).roleIds as string[]).map((id) => Object.keys(roles).find((name) => roles[name] === id));

  beforeAll(async () => {
    dono = await person('dono');
    groupId = await w.group(dono, 'Clube');
    geral = (await w.channelByName(dono, groupId, 'geral'))!;
    await w.role(dono, groupId, 'Membro', DEFAULT_EVERYONE);
    await w.role(dono, groupId, 'Jogador', DEFAULT_EVERYONE);
    await w.role(dono, groupId, 'Poderoso', DEFAULT_EVERYONE | P.BAN_MEMBERS);
    await install(dono, groupId, 'boas-vindas');
    await refresh();
    await w.order(dono, groupId, ['Administrador', 'Moderador', 'Boas-vindas e Cargos', 'Membro', 'Jogador', 'Poderoso']);
  });

  it('entrada: mensagem com variáveis e cargos automáticos; saída avisada', async () => {
    await configure(dono, groupId, 'boas-vindas', { config: { canalEntrada: geral, cargosAutomaticos: [roles.Membro], avisarSaida: true } });
    const nova = await person('nova');
    await w.join(dono, groupId, nova);
    await w.bots.idle();
    expect(await w.texts(dono, geral)).toEqual([`Boas-vindas, ${nova.name[0]!.toUpperCase()}${nova.name.slice(1)}! Você é o membro número 2 de Clube.`]);
    expect(await rolesOf(nova)).toEqual(['Membro']);
    const audit = (await w.ok('GET', `/api/groups/${groupId}/audit`, dono.token)).entries as any[];
    expect(audit.find((entry) => entry.action === 'membro.cargos')).toMatchObject({ actorName: 'Boas-vindas e Cargos', detail: { adicionados: ['Membro'] } });

    await w.ok('POST', `/api/groups/${groupId}/leave`, nova.token, {});
    await w.bots.idle();
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/saiu de Clube\.$/);
    expect(fill('{usuario} e {desconhecida}', { usuario: 'Ana' })).toBe('Ana e {desconhecida}');
  });

  it('o bot não entrega cargo acima do dele nem com permissões que ele não tem, e avisa no painel', async () => {
    await configure(dono, groupId, 'boas-vindas', { config: { cargosAutomaticos: [roles.Moderador, roles.Poderoso, roles.Membro] } });
    const novo = await person('novo');
    await w.join(dono, groupId, novo);
    await w.bots.idle();
    // Com um cargo impossível na lista, o servidor recusa o pedido inteiro: nada é entregue pela metade.
    expect(await rolesOf(novo)).toEqual([]);
    const status = (await installed(dono, groupId, 'boas-vindas')).status;
    expect(status.state).toBe('aviso');
    expect(status.text).toMatch(/“Moderador”: está acima/);
    expect(status.text).toMatch(/“Poderoso”: tem permissões que o bot não tem/);
    expect((await logs(dono, groupId)).find((entry) => entry.action === 'ação recusada')).toBeDefined();
    await configure(dono, groupId, 'boas-vindas', { config: { cargosAutomaticos: [roles.Membro] } });
    expect((await installed(dono, groupId, 'boas-vindas')).status.state).toBe('ativo');
  });

  it('verificação: o cargo só vem depois de a pessoa confirmar', async () => {
    await configure(dono, groupId, 'boas-vindas', { config: { verificacao: true } });
    const novata = await person('novata');
    await w.join(dono, groupId, novata);
    await w.bots.idle();
    const welcome = ((await w.ok('GET', `/api/channels/${geral}/messages`, dono.token)).messages as any[]).at(-1);
    expect(welcome.content).toMatch(/toque em Verificar/);
    expect(welcome.meta.buttons).toEqual([{ label: 'Verificar', command: '/verificar', style: 'primario' }]);
    expect(await rolesOf(novata)).toEqual([]);
    await w.say(novata, geral, '/verificar');
    expect(await rolesOf(novata)).toEqual(['Membro']);
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/verificação concluída\. Você recebeu: Membro\./);
    await configure(dono, groupId, 'boas-vindas', { config: { verificacao: false } });
  });

  it('menu de cargos: pegar e largar; cargo fora do menu não', async () => {
    await configure(dono, groupId, 'boas-vindas', { config: { cargosDoMenu: [roles.Jogador] } });
    const membro = await person('membro');
    await w.join(dono, groupId, membro);
    await w.say(membro, geral, '/cargos');
    const menu = ((await w.ok('GET', `/api/channels/${geral}/messages`, dono.token)).messages as any[]).at(-1);
    expect(menu.meta.buttons).toEqual([{ label: 'Jogador', command: '/cargo Jogador' }]);
    await w.say(membro, geral, '/cargo jogador');
    expect(await rolesOf(membro)).toEqual(expect.arrayContaining(['Jogador']));
    await w.say(membro, geral, '/cargo Jogador');
    expect(await rolesOf(membro)).not.toContain('Jogador');
    await w.say(membro, geral, '/cargo Administrador');
    expect((await w.texts(dono, geral)).at(-1)).toBe('Esse cargo não está no menu. Veja a lista em /cargos.');
    expect(await rolesOf(membro)).not.toContain('Administrador');
  });

  // Canais de boas-vindas e de saída costumam ser só de leitura (@everyone sem "Enviar mensagens"). Escolher o
  // canal na Central de Bots libera o cargo do bot nele, em nome de quem configurou e com registro na auditoria.
  describe('canais só de leitura', () => {
    let bemVindos: string, saida: string, everyone: string;
    const readOnly = async (name: string) => {
      const channelId = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'texto', name })).id as string;
      await w.ok('PUT', `/api/channels/${channelId}/overrides/cargo/${everyone}`, dono.token, { allow: '0', deny: P.SEND_MESSAGES.toString() });
      return channelId;
    };

    beforeAll(async () => {
      everyone = ((await w.view(dono, groupId)).roles as any[]).find((role) => role.isEveryone).id;
      bemVindos = await readOnly('bem-vindos');
      saida = await readOnly('saida');
      await configure(dono, groupId, 'boas-vindas', { config: { cargosAutomaticos: [], cargosDoMenu: [], verificacao: false } });
    });

    it('ao salvar, o bot ganha permissão para escrever nos canais escolhidos; entrada e saída chegam', async () => {
      const saved = await configure(dono, groupId, 'boas-vindas', { config: { canalEntrada: bemVindos, canalSaida: saida, avisarSaida: true } });
      expect(saved.permissoes).toEqual({ liberados: ['#bem-vindos', '#saida'], falhas: [] });

      const chegou = await person('chegou');
      await w.join(dono, groupId, chegou);
      await w.bots.idle();
      expect((await w.texts(dono, bemVindos)).at(-1)).toMatch(/^Boas-vindas, Chegou\d+! /);
      await w.ok('POST', `/api/groups/${groupId}/leave`, chegou.token, {});
      await w.bots.idle();
      expect((await w.texts(dono, saida)).at(-1)).toMatch(/^Chegou\d+ saiu de Clube\.$/);

      // Só o cargo do bot foi liberado: os outros membros continuam sem escrever ali.
      const outro = await person('outro');
      await w.join(dono, groupId, outro);
      expect((await w.api('POST', `/api/channels/${bemVindos}/messages`, outro.token, { content: 'oi' })).status).toBe(403);
      const audit = (await w.ok('GET', `/api/groups/${groupId}/audit`, dono.token)).entries as any[];
      const grant = audit.find((entry) => entry.action === 'canal.permissoes' && entry.detail.alvo === 'cargo Boas-vindas e Cargos');
      expect(grant).toMatchObject({ actorId: dono.id });
      expect((await installed(dono, groupId, 'boas-vindas')).status.state).toBe('ativo');
      // Salvar de novo não mexe em nada: o bot já pode escrever.
      expect((await configure(dono, groupId, 'boas-vindas', { config: { canalEntrada: bemVindos } })).permissoes).toEqual({ liberados: [], falhas: [] });
    });

    it('quem configura sem poder mexer nas permissões do canal não libera nada, e o painel avisa', async () => {
      const fechado = await readOnly('fechado');
      const configurador = await person('configurador');
      await w.join(dono, groupId, configurador);
      const cargo = await w.role(dono, groupId, 'Configurador', DEFAULT_EVERYONE | P.CONFIGURE_BOTS);
      await w.give(dono, groupId, configurador, [cargo]);

      const saved = await configure(configurador, groupId, 'boas-vindas', { config: { canalEntrada: fechado } });
      expect(saved.permissoes.liberados).toEqual([]);
      expect(saved.permissoes.falhas).toEqual([{ canal: '#fechado', motivo: expect.any(String) }]);
      const status = (await installed(dono, groupId, 'boas-vindas')).status;
      expect(status.state).toBe('aviso');
      expect(status.text).toMatch(/Não consigo escrever em #fechado/);
      await configure(dono, groupId, 'boas-vindas', { config: { canalEntrada: bemVindos } });
    });

    it('canal de saída escolhido com o aviso desligado: o painel avisa', async () => {
      await configure(dono, groupId, 'boas-vindas', { config: { canalSaida: saida, avisarSaida: false } });
      const status = (await installed(dono, groupId, 'boas-vindas')).status;
      expect(status.state).toBe('aviso');
      expect(status.text).toMatch(/“Avisar quando alguém sai” está desligado/);
      await configure(dono, groupId, 'boas-vindas', { config: { avisarSaida: true } });
      expect((await installed(dono, groupId, 'boas-vindas')).status.state).toBe('ativo');
    });
  });
});

describe('Destaques Cósmicos (ações de bot com Cosmic Points)', () => {
  let dono: Person, membro: Person;
  let groupId: string, geral: string;
  const points = async (who: Person) => (await w.ok('GET', '/api/me/points', who.token)).points as number;
  const last = async () => ((await w.ok('GET', `/api/channels/${geral}/messages`, dono.token)).messages as any[]).at(-1);

  beforeAll(async () => {
    dono = await person('dono');
    membro = await person('membro');
    groupId = await w.group(dono, 'Destaques');
    geral = (await w.channelByName(dono, groupId, 'geral'))!;
    await w.join(dono, groupId, membro);
    await install(dono, groupId, 'destaques');
    await configure(dono, groupId, 'destaques', { config: { custoDestaque: 30, custoEfeito: 0 } });
  });

  it('sem saldo, o destaque não sai e nada é cobrado', async () => {
    await w.say(membro, geral, '/destaque olá a todos');
    expect((await last()).content).toMatch(/precisa de 30 Cosmic Points/);
    expect(await points(membro)).toBe(0);
  });

  it('com saldo: cobra o custo configurado e publica a mensagem em destaque, em nome de quem pediu', async () => {
    await w.economy.earn(membro.id, 100, 'teste', 'saldo de teste', 'teste:destaque', { ignoreCaps: true });
    await w.say(membro, geral, '/destaque olá a todos');
    const message = await last();
    expect(message.content).toBe('olá a todos');
    expect(message.meta).toMatchObject({ style: 'destaque', highlightOf: expect.stringMatching(/^Membro/) });
    expect(await points(membro)).toBe(70);
    const history = (await w.ok('GET', '/api/me/points', membro.token)).history as any[];
    expect(history[0]).toMatchObject({ delta: -30, reason: 'bot' });
  });

  it('ação gratuita (custo 0) não mexe no saldo; efeito desconhecido é recusado', async () => {
    await w.say(membro, geral, '/efeito confete');
    expect((await last()).meta).toMatchObject({ effect: 'confete' });
    expect(await points(membro)).toBe(70);
    await w.say(membro, geral, '/efeito fogos-de-verdade');
    expect((await last()).content).toMatch(/Efeitos: confete, estrelas, aurora/);
  });

  it('pessoas não conseguem forjar o estilo: só mensagens do bot carregam destaque', async () => {
    await w.ok('POST', `/api/channels/${geral}/messages`, membro.token, { content: 'tentando', meta: { style: 'destaque' } });
    expect((await last()).meta).toBeNull();
  });
});

describe('Lembretes e a fila de tarefas', () => {
  let shared: World;
  let dono: Person, comum: Person, mod: Person;
  let groupId: string, geral: string;
  const advance = async (minutes: number) => {
    w.clock.now = new Date(w.clock.now.getTime() + minutes * 60_000);
    return w.bots.tick();
  };

  beforeAll(async () => {
    // Mundo próprio: o relógio simulado começa numa segunda-feira ao meio-dia (horário de São Paulo).
    shared = w;
    w = await createWorld();
    [dono, comum, mod] = [await w.signup('dono'), await w.signup('comum'), await w.signup('mod')];
    groupId = await w.group(dono);
    await w.join(dono, groupId, comum, mod);
    const state = await w.view(dono, groupId);
    await w.give(dono, groupId, mod, [state.roles.find((role: any) => role.name === 'Moderador').id]);
    geral = (await w.channelByName(dono, groupId, 'geral'))!;
    await install(dono, groupId, 'lembretes');
  }, 60_000);

  afterAll(() => {
    w = shared;
  });

  it('entende datas em português, no fuso do grupo', () => {
    const now = new Date('2026-11-16T15:00:00.000Z'); // segunda-feira, 12:00 em São Paulo
    const at = (text: string, zone = 'America/Sao_Paulo') => parseWhen(text, now, zone);
    expect(at('em 20m tirar a pizza')).toEqual({ at: new Date('2026-11-16T15:20:00.000Z'), rest: 'tirar a pizza' });
    expect(at('em 2 horas x')?.at.toISOString()).toBe('2026-11-16T17:00:00.000Z');
    expect(at('em 3 dias x')?.at.toISOString()).toBe('2026-11-19T15:00:00.000Z');
    expect(at('hoje 21:00 jogo')?.at.toISOString()).toBe('2026-11-17T00:00:00.000Z');
    expect(at('hoje 9:00 já passou')).toBeNull();
    expect(at('amanhã 8h30 academia')).toEqual({ at: new Date('2026-11-17T11:30:00.000Z'), rest: 'academia' });
    expect(at('sexta 20:00 campeonato')?.at.toISOString()).toBe('2026-11-20T23:00:00.000Z');
    expect(at('segunda 10:00 x')?.at.toISOString(), 'segunda às 10h já passou: vale a da semana que vem').toBe('2026-11-23T13:00:00.000Z');
    expect(at('25/12 09:00 natal')?.at.toISOString()).toBe('2026-12-25T12:00:00.000Z');
    expect(at('01/02 09:00 x')?.at.toISOString(), 'data que já passou neste ano vai para o próximo').toBe('2027-02-01T12:00:00.000Z');
    expect(at('21:30 novela')?.at.toISOString()).toBe('2026-11-17T00:30:00.000Z');
    expect(at('todo dia 21:00 ronda')).toEqual({ at: new Date('2026-11-17T00:00:00.000Z'), everySeconds: 86_400, rest: 'ronda' });
    expect(at('toda segunda 20:00 reunião')).toMatchObject({ everySeconds: 604_800, rest: 'reunião' });
    expect(at('hoje 21:00 jogo', 'Europe/Lisbon')?.at.toISOString(), 'outro fuso, outro instante').toBe('2026-11-16T21:00:00.000Z');
    for (const bad of ['', 'depois eu vejo', 'em 0m x', 'hoje 25:00 x', '32/13 10:00 x', '10 comprar pão']) expect(at(bad), bad).toBeNull();
  });

  it('lembrete individual: chega na hora, uma vez só', async () => {
    await w.say(comum, geral, '/lembrete em 20m tirar a pizza do forno');
    const confirmation = ((await w.ok('GET', `/api/channels/${geral}/messages`, dono.token)).messages as any[]).at(-1);
    expect(confirmation.content).toMatch(/lembrete agendado para .*12:20/);
    expect(confirmation.meta.buttons.map((button: any) => button.label)).toEqual(['Cancelar']);

    expect(await advance(19)).toBe(0);
    expect((await w.texts(dono, geral)).some((text) => text.startsWith('⏰'))).toBe(false);
    expect(await advance(2)).toBe(1);
    expect((await w.texts(dono, geral)).at(-1)).toBe('⏰ Comum, lembrete: tirar a pizza do forno');
    expect(await advance(60)).toBe(0);
    expect((await w.texts(dono, geral)).filter((text) => text.startsWith('⏰'))).toHaveLength(1);
    expect((await w.db.query('SELECT 1 FROM bot_data WHERE group_id = $1', [groupId])).length, 'lembrete entregue sai da lista').toBe(0);
  });

  it('data inválida, texto faltando, limite por pessoa e cancelamento', async () => {
    await w.say(comum, geral, '/lembrete sei lá quando');
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/Não entendi a data/);
    await w.say(comum, geral, '/lembrete em 5m');
    expect((await w.texts(dono, geral)).at(-1)).toBe('Faltou dizer o texto depois da data.');

    await w.ok('PATCH', `/api/groups/${groupId}/bots/lembretes`, dono.token, { config: { maxPorPessoa: 2 } });
    await w.say(comum, geral, '/lembrete em 30m um');
    await w.say(comum, geral, '/lembrete em 40m dois');
    await w.say(comum, geral, '/lembrete em 50m três');
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/você já tem 2 lembretes agendados/);

    await w.say(comum, geral, '/lembretes');
    const list = (await w.texts(dono, geral)).at(-1)!;
    const [first, second] = [...list.matchAll(/• (\w+) \(seu\)/g)].map((match) => match[1]!);
    expect(list).toMatch(/: um\n.*: dois$/s);
    // Outra pessoa não cancela; a moderação e o dono do lembrete, sim.
    await w.say(dono, geral, '/lembretes');
    expect((await w.texts(dono, geral)).at(-1), 'os lembretes individuais dos outros não aparecem').toBe('Nenhum lembrete agendado.');
    const outro = await w.signup('outro');
    await w.join(dono, groupId, outro);
    await w.say(outro, geral, `/lembrete-cancelar ${first}`);
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/Só quem criou o lembrete, ou a moderação/);
    await w.say(mod, geral, `/lembrete-cancelar ${first}`);
    await w.say(comum, geral, `/lembrete-cancelar ${second}`);
    await w.say(comum, geral, '/lembrete-cancelar zzzzz');
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/Não achei esse lembrete/);
    expect(await advance(120), 'cancelados não disparam').toBe(0);
    await w.ok('PATCH', `/api/groups/${groupId}/bots/lembretes`, dono.token, { config: { maxPorPessoa: 10 } });
  });

  it('lembrete do grupo com inscrição; mensagem agendada que se repete todo dia', async () => {
    await w.say(comum, geral, '/lembrete-grupo em 30m partida ranqueada');
    const created = ((await w.ok('GET', `/api/channels/${geral}/messages`, dono.token)).messages as any[]).at(-1);
    const join = created.meta.buttons.find((button: any) => button.label === 'Quero ser avisado').command as string;
    await w.say(mod, geral, join);
    await w.say(mod, geral, join);
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/você já está na lista/);
    await w.say(dono, geral, join);
    await advance(31);
    const delivered = (await w.texts(dono, geral)).at(-1)!;
    expect(delivered).toBe('⏰ Lembrete do grupo: partida ranqueada\nAvisando: Mod, Dono.');

    await w.say(comum, geral, '/agendar todo dia 21:00 Hora da ronda!');
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/exige a permissão “Utilizar ferramentas administrativas”/);
    await w.say(mod, geral, '/agendar todo dia 21:00 Hora da ronda!');
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/Mensagem agendada para .*21:00, todos os dias/);
    const count = async () => (await w.texts(dono, geral)).filter((text) => text === 'Hora da ronda!').length;
    w.clock.now = new Date('2026-11-17T00:00:30.000Z'); // 21:00:30 em São Paulo
    await w.bots.tick();
    expect(await count()).toBe(1);
    await w.bots.tick();
    expect(await count(), 'a mesma ocorrência não sai duas vezes').toBe(1);
    // O backend ficou três dias fora do ar: ao voltar manda uma vez, não três.
    w.clock.now = new Date('2026-11-20T00:05:00.000Z');
    await w.bots.tick();
    await w.bots.tick();
    expect(await count()).toBe(2);
    w.clock.now = new Date('2026-11-21T00:00:10.000Z');
    await w.bots.tick();
    expect(await count()).toBe(3);
  });

  it('a mesma tarefa não roda duas vezes ao mesmo tempo, e uma que falha é tentada de novo até desistir', async () => {
    await w.say(comum, geral, '/lembrete em 10m só uma vez');
    w.clock.now = new Date(w.clock.now.getTime() + 11 * 60_000);
    // Duas "instâncias" pegando tarefas no mesmo instante: a trava do banco deixa só uma executar.
    // A segunda instância compartilha o banco, mas recebe seus próprios eventos de comunidade.
    const otherCommunity = new Community(w.db, new Hub(), w.sfu, { livekitUrl: config.livekitUrl, tokenTtlSeconds: 600 }, new Unlimited());
    const other = new (await import('../src/bots/runtime.ts')).BotRuntime(w.db, otherCommunity, officialBots(), { now: () => w.clock.now });
    const [a, b] = await Promise.all([w.bots.tick(), other.tick()]);
    expect(a + b).toBe(1);
    expect((await w.texts(dono, geral)).filter((text) => text.endsWith('lembrete: só uma vez'))).toHaveLength(1);

    // Tarefa que ficou "pega" por um processo que caiu: só volta depois que a trava vence.
    await w.say(comum, geral, '/lembrete em 10m depois da queda');
    w.clock.now = new Date(w.clock.now.getTime() + 11 * 60_000);
    await w.db.query(`UPDATE bot_jobs SET locked_until = $1::timestamptz + interval '60 seconds', attempts = 1 WHERE done_at IS NULL AND group_id = $2`, [w.clock.now.toISOString(), groupId]);
    expect(await w.bots.tick(), 'trava ainda vale').toBe(0);
    w.clock.now = new Date(w.clock.now.getTime() + 61_000);
    expect(await w.bots.tick()).toBe(1);
    expect((await w.texts(dono, geral)).at(-1)).toMatch(/lembrete: depois da queda$/);

    // Depois de 5 tentativas a tarefa é abandonada, em vez de ficar tentando para sempre.
    await w.say(comum, geral, '/lembrete em 10m nunca chega');
    await w.db.query(`UPDATE bot_jobs SET attempts = 5 WHERE done_at IS NULL AND group_id = $1`, [groupId]);
    w.clock.now = new Date(w.clock.now.getTime() + 3_600_000);
    expect(await w.bots.tick()).toBe(0);
  });
});
