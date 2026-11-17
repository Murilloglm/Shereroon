import { canActOnMember, has, P } from '../../../../shared/permissions.ts';
import type { Member, Snapshot } from '../../community/core.ts';
import type { BotContext, BotModule } from '../types.ts';
import { normalize } from '../util.ts';

type Action = 'apagar' | 'advertir' | 'castigo' | 'expulsar' | 'banir';

const ACTIONS = [
  { value: 'apagar', label: 'Só apagar a mensagem' },
  { value: 'advertir', label: 'Apagar e advertir' },
  { value: 'castigo', label: 'Apagar e pôr de castigo' },
  { value: 'expulsar', label: 'Apagar e expulsar' },
  { value: 'banir', label: 'Apagar e banir' },
];

interface Warning {
  at: string;
  reason: string;
}

const URLS = /\b(?:https?:\/\/|www\.)([a-z0-9.-]+\.[a-z]{2,})(\/[^\s]*)?/gi;
const INVITE = /#\/convite\/|discord\.gg\/|discord(?:app)?\.com\/invite\//i;

/** Acha um membro pelo nome de usuário (com ou sem @), pelo apelido ou pelo nome. */
export function findMember(snap: Snapshot, text: string): Member | null {
  const wanted = text.trim().replace(/^@/, '').toLowerCase();
  if (!wanted) return null;
  const people = [...snap.members.values()].filter((member) => !member.bot);
  return (
    people.find((member) => member.username.toLowerCase() === wanted) ??
    people.find((member) => (member.nickname ?? '').toLowerCase() === wanted || member.displayName.toLowerCase() === wanted) ??
    people.find((member) => member.displayName.toLowerCase().startsWith(wanted)) ??
    null
  );
}

export function createAutomod(): BotModule {
  // Memória curta para detectar enxurrada e repetição. Vive no processo: reiniciar o backend zera a contagem.
  const recent = new Map<string, { times: number[]; last: string; repeats: number }>();

  const warningsOf = async (ctx: BotContext, userId: string): Promise<Warning[]> => {
    const days = Number(ctx.install.config.validadeAdvertenciasDias) || 30;
    const limit = ctx.now().getTime() - days * 86_400_000;
    return ((await ctx.data.get<Warning[]>('advertencias', userId)) ?? []).filter((item) => Date.parse(item.at) > limit);
  };

  /** Registra uma advertência e aplica o que a configuração manda quando o número é atingido. */
  const warn = async (ctx: BotContext, member: Member, channelId: string | null, reason: string): Promise<string> => {
    const config = ctx.install.config;
    const list = [...(await warningsOf(ctx, member.userId)), { at: ctx.now().toISOString(), reason }];
    await ctx.data.set('advertencias', member.userId, list);
    const name = member.nickname ?? member.displayName;
    const count = list.length;
    let outcome = `advertência ${count}`;
    const reached = (key: string) => Number(config[key]) > 0 && count >= Number(config[key]);
    if (reached('advertenciasParaBanir')) {
      if (await ctx.attempt(`banir ${name}`, () => ctx.community.ban(ctx.bot, ctx.groupId, member.userId, `AutoMod: ${count} advertências`))) outcome = `banido com ${count} advertências`;
    } else if (reached('advertenciasParaExpulsar')) {
      if (await ctx.attempt(`expulsar ${name}`, () => ctx.community.kick(ctx.bot, ctx.groupId, member.userId, `AutoMod: ${count} advertências`))) outcome = `expulso com ${count} advertências`;
    } else if (reached('advertenciasParaCastigo')) {
      const minutes = Number(config.castigoMinutos) || 10;
      if (await ctx.attempt(`castigar ${name}`, () => ctx.community.timeout(ctx.bot, ctx.groupId, member.userId, minutes))) outcome = `castigo de ${minutes} min com ${count} advertências`;
    }
    await ctx.log('advertência', { membro: name, motivo: reason, total: count, resultado: outcome });
    if (channelId) await ctx.say(channelId, `⚠ ${name}: ${reason}. (${outcome})`);
    return outcome;
  };

  const punish = async (ctx: BotContext, member: Member, channelId: string, action: Action, reason: string): Promise<void> => {
    const name = member.nickname ?? member.displayName;
    if (action === 'apagar') {
      await ctx.log('mensagem removida', { membro: name, motivo: reason });
    } else if (action === 'advertir') {
      await warn(ctx, member, channelId, reason);
    } else {
      const minutes = Number(ctx.install.config.castigoMinutos) || 10;
      const done =
        action === 'castigo'
          ? await ctx.attempt(`castigar ${name}`, () => ctx.community.timeout(ctx.bot, ctx.groupId, member.userId, minutes))
          : action === 'expulsar'
            ? await ctx.attempt(`expulsar ${name}`, () => ctx.community.kick(ctx.bot, ctx.groupId, member.userId, `AutoMod: ${reason}`))
            : await ctx.attempt(`banir ${name}`, () => ctx.community.ban(ctx.bot, ctx.groupId, member.userId, `AutoMod: ${reason}`));
      const what = action === 'castigo' ? `castigo de ${minutes} min` : action === 'expulsar' ? 'expulsão' : 'banimento';
      await ctx.log(done ? what : 'mensagem removida', { membro: name, motivo: reason, ...(done ? {} : { observacao: `não foi possível aplicar ${what}` }) });
      await ctx.say(channelId, done ? `⚠ ${name}: ${reason}. (${what})` : `⚠ ${name}: ${reason}. Mensagem removida.`);
    }
    const logChannel = String(ctx.install.config.canalDeRegistro ?? '');
    if (logChannel && logChannel !== channelId) await ctx.say(logChannel, `AutoMod: mensagem de ${name} removida. Motivo: ${reason}.`);
  };

  /** Devolve o motivo e a ação se a mensagem quebra alguma regra. */
  const check = (ctx: BotContext, userId: string, content: string): { reason: string; action: Action } | null => {
    const config = ctx.install.config;
    const text = normalize(content);
    for (const word of (config.palavras as string[]) ?? []) {
      const needle = normalize(word).trim();
      // Palavra inteira: "bobo" não pega "bobagem"; frases valem como estão.
      if (needle && new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text)) {
        return { reason: 'palavra proibida', action: config.palavrasAcao as Action };
      }
    }
    if (config.bloquearConvites === true && INVITE.test(content)) return { reason: 'convite não autorizado', action: config.linksAcao as Action };
    const allowed = ((config.dominiosPermitidos as string[]) ?? []).map((domain) => domain.toLowerCase().replace(/^www\./, ''));
    const extensions = ((config.extensoesBloqueadas as string[]) ?? []).map((item) => item.toLowerCase().replace(/^\./, ''));
    for (const match of content.matchAll(URLS)) {
      const domain = match[1]!.toLowerCase().replace(/^www\./, '');
      const extension = /\.([a-z0-9]{1,6})(?:[?#].*)?$/i.exec(match[2] ?? '')?.[1]?.toLowerCase();
      if (extension && extensions.includes(extension)) return { reason: `link para arquivo .${extension}`, action: config.linksAcao as Action };
      if (config.bloquearLinks === true && !allowed.some((item) => domain === item || domain.endsWith(`.${item}`))) {
        return { reason: 'link não autorizado', action: config.linksAcao as Action };
      }
    }
    const letters = content.replace(/[^\p{L}]/gu, '');
    if (config.maiusculas === true && letters.length >= 20 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.8) {
      return { reason: 'mensagem toda em maiúsculas', action: 'apagar' };
    }
    // Enxurrada e repetição.
    const key = `${ctx.groupId}:${userId}`;
    const now = ctx.now().getTime();
    const state = recent.get(key) ?? { times: [], last: '', repeats: 0 };
    const windowMs = (Number(config.spamSegundos) || 8) * 1000;
    state.times = [...state.times.filter((time) => now - time < Math.max(windowMs, 60_000)), now];
    state.repeats = state.last === text ? state.repeats + 1 : 1;
    state.last = text;
    recent.set(key, state);
    if (recent.size > 5000) for (const [id, item] of recent) if (now - (item.times.at(-1) ?? 0) > 300_000) recent.delete(id);
    const burst = Number(config.spamMensagens);
    if (burst > 0 && state.times.filter((time) => now - time < windowMs).length > burst) return { reason: 'mensagens demais em pouco tempo', action: config.spamAcao as Action };
    const repeated = Number(config.repetidas);
    if (repeated > 0 && state.repeats >= repeated) return { reason: 'mensagem repetida', action: config.spamAcao as Action };
    return null;
  };

  return {
    id: 'automod',
    name: 'AutoMod',
    about: 'Modera os canais de texto sozinho: palavras proibidas, links e convites, enxurrada e repetição, com advertência, castigo, expulsão ou banimento.',
    category: 'Moderação',
    icon: 'shield',
    features: [
      'Apaga mensagens com palavras proibidas',
      'Bloqueia links e convites não autorizados',
      'Detecta enxurrada e mensagens repetidas',
      'Bloqueia links para tipos de arquivo',
      'Adverte, castiga, expulsa ou bane conforme a configuração',
      'Exceções por cargo, pessoa e canal',
      'Registra cada ação',
    ],
    permissions: P.VIEW_CHANNEL | P.SEND_MESSAGES | P.DELETE_MESSAGES | P.KICK_MEMBERS | P.BAN_MEMBERS,
    defaultConfig: {
      palavras: [],
      palavrasAcao: 'advertir',
      bloquearLinks: false,
      dominiosPermitidos: [],
      bloquearConvites: false,
      extensoesBloqueadas: [],
      linksAcao: 'apagar',
      spamMensagens: 6,
      spamSegundos: 8,
      repetidas: 3,
      maiusculas: false,
      spamAcao: 'castigo',
      castigoMinutos: 10,
      advertenciasParaCastigo: 3,
      advertenciasParaExpulsar: 0,
      advertenciasParaBanir: 0,
      validadeAdvertenciasDias: 30,
      cargosIsentos: [],
      membrosIsentos: [],
      canaisIsentos: [],
      canalDeRegistro: '',
    },
    fields: [
      { key: 'palavras', type: 'list', label: 'Palavras e frases proibidas', section: 'Palavras', about: 'Uma por linha. Acentos e maiúsculas não importam; vale a palavra inteira.' },
      { key: 'palavrasAcao', type: 'select', label: 'O que fazer', section: 'Palavras', options: ACTIONS },
      { key: 'bloquearLinks', type: 'toggle', label: 'Bloquear links', section: 'Links e convites', about: 'Apaga mensagens com endereços de sites, menos os dos domínios permitidos.' },
      { key: 'dominiosPermitidos', type: 'list', label: 'Domínios permitidos', section: 'Links e convites', placeholder: 'youtube.com' },
      { key: 'bloquearConvites', type: 'toggle', label: 'Bloquear convites', section: 'Links e convites', about: 'Convites de outros grupos do Cosmic Night e de servidores do Discord.' },
      { key: 'extensoesBloqueadas', type: 'list', label: 'Tipos de arquivo bloqueados em links', section: 'Links e convites', placeholder: 'exe', about: 'O Cosmic Night ainda não tem anexos; isto vale para links que apontam para esses arquivos.' },
      { key: 'linksAcao', type: 'select', label: 'O que fazer', section: 'Links e convites', options: ACTIONS },
      { key: 'spamMensagens', type: 'number', label: 'Mensagens permitidas no intervalo', section: 'Enxurrada e repetição', min: 0, max: 60, about: '0 desliga.' },
      { key: 'spamSegundos', type: 'number', label: 'Intervalo, em segundos', section: 'Enxurrada e repetição', min: 2, max: 120 },
      { key: 'repetidas', type: 'number', label: 'Mesma mensagem seguida quantas vezes', section: 'Enxurrada e repetição', min: 0, max: 20, about: '0 desliga.' },
      { key: 'maiusculas', type: 'toggle', label: 'Apagar mensagens todas em maiúsculas', section: 'Enxurrada e repetição' },
      { key: 'spamAcao', type: 'select', label: 'O que fazer', section: 'Enxurrada e repetição', options: ACTIONS },
      { key: 'castigoMinutos', type: 'number', label: 'Duração do castigo, em minutos', section: 'Punições', min: 1, max: 40_320 },
      { key: 'advertenciasParaCastigo', type: 'number', label: 'Advertências para castigo', section: 'Punições', min: 0, max: 50, about: '0 = nunca.' },
      { key: 'advertenciasParaExpulsar', type: 'number', label: 'Advertências para expulsão', section: 'Punições', min: 0, max: 50 },
      { key: 'advertenciasParaBanir', type: 'number', label: 'Advertências para banimento', section: 'Punições', min: 0, max: 50 },
      { key: 'validadeAdvertenciasDias', type: 'number', label: 'Advertências valem por quantos dias', section: 'Punições', min: 1, max: 365 },
      { key: 'cargosIsentos', type: 'roles', label: 'Cargos que o AutoMod ignora', section: 'Exceções' },
      { key: 'membrosIsentos', type: 'members', label: 'Pessoas que o AutoMod ignora', section: 'Exceções' },
      { key: 'canaisIsentos', type: 'channels', label: 'Canais que o AutoMod ignora', section: 'Exceções', channelKind: 'texto' },
      { key: 'canalDeRegistro', type: 'channel', label: 'Canal para avisar a moderação', section: 'Exceções', channelKind: 'texto', posts: true, about: 'Ao salvar, o bot ganha permissão para escrever neste canal.' },
    ],

    async onEvent(ctx, event) {
      if (event.type !== 'message') return;
      const config = ctx.install.config;
      const snap = await ctx.snapshot();
      const member = snap.members.get(event.author.id);
      if (!member || member.bot) return;
      const subject = ctx.community.subjectOf(snap, member);
      const perms = ctx.community.permissionsIn(snap, subject, event.channel);
      // O dono, administradores e quem modera mensagens naquele canal ficam de fora.
      if (subject.isOwner || has(perms, P.ADMINISTRATOR) || has(perms, P.MANAGE_MESSAGES)) return;
      if ((config.canaisIsentos as string[]).includes(event.channel.id) || (config.membrosIsentos as string[]).includes(member.userId)) return;
      if ((config.cargosIsentos as string[]).some((id) => member.roleIds.has(id))) return;

      const hit = check(ctx, member.userId, event.message.content);
      if (!hit) return;
      const removed = await ctx.attempt('apagar mensagem', () => ctx.community.deleteMessage(ctx.bot, event.message.id));
      await punish(ctx, member, event.channel.id, hit.action ?? 'apagar', hit.reason);
      return removed ? 'apagada' : undefined;
    },

    commands: [
      {
        name: 'advertir',
        usage: 'advertir <pessoa> <motivo>',
        about: 'Adverte um membro. Conta para o castigo automático.',
        permission: P.USE_ADMIN_TOOLS,
        async run(ctx, call) {
          const snap = await ctx.snapshot();
          const target = findMember(snap, call.argv[0] ?? '');
          if (!target) return 'Não achei essa pessoa. Use o nome de usuário, por exemplo: /advertir ana motivo.';
          // Quem adverte precisa estar acima do alvo, como em qualquer punição.
          const { subject } = await ctx.community.access(call.user, ctx.groupId);

          if (!canActOnMember(subject, ctx.community.subjectOf(snap, target), snap.roles)) return 'Você só pode advertir quem está abaixo do seu cargo mais alto.';
          const reason = call.argv.slice(1).join(' ') || 'sem motivo informado';
          await warn(ctx, target, call.channel.id, `advertido por ${call.member.nickname ?? call.member.displayName}: ${reason}`);
        },
      },
      {
        name: 'advertencias',
        usage: 'advertencias <pessoa>',
        about: 'Mostra as advertências válidas de um membro.',
        permission: P.USE_ADMIN_TOOLS,
        async run(ctx, call) {
          const target = findMember(await ctx.snapshot(), call.argv[0] ?? '');
          if (!target) return 'Não achei essa pessoa.';
          const list = await warningsOf(ctx, target.userId);
          const name = target.nickname ?? target.displayName;
          if (list.length === 0) return `${name} não tem advertências válidas.`;
          return `${name} tem ${list.length} ${list.length === 1 ? 'advertência' : 'advertências'}:\n${list.map((item) => `• ${new Date(item.at).toLocaleDateString('pt-BR')}: ${item.reason}`).join('\n')}`;
        },
      },
      {
        name: 'perdoar',
        usage: 'perdoar <pessoa>',
        about: 'Apaga as advertências de um membro.',
        permission: P.USE_ADMIN_TOOLS,
        async run(ctx, call) {
          const target = findMember(await ctx.snapshot(), call.argv[0] ?? '');
          if (!target) return 'Não achei essa pessoa.';
          await ctx.data.delete('advertencias', target.userId);
          await ctx.log('advertências apagadas', { membro: target.displayName, por: call.user.displayName });
          return `As advertências de ${target.nickname ?? target.displayName} foram apagadas.`;
        },
      },
    ],

    async status(ctx) {
      const snap = await ctx.snapshot();
      const role = snap.roles.find((item) => item.id === ctx.install.roleId);
      const above = snap.roles.filter((item) => !item.isEveryone && !item.botId && role && item.position > role.position).length;
      return above > 0 && role
        ? [`O cargo do AutoMod está abaixo de ${above} ${above === 1 ? 'cargo' : 'cargos'}: ele apaga mensagens, mas não consegue castigar, expulsar nem banir quem tem esses cargos. Suba o cargo “${role.name}” em Cargos.`]
        : [];
    },
  };
}
