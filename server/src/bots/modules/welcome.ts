import { canManageRole, DEFAULT_EVERYONE, P } from '../../../../shared/permissions.ts';
import type { Member, Role, Snapshot } from '../../community/core.ts';
import type { BotContext, BotModule } from '../types.ts';
import { fill } from '../util.ts';

const nameOf = (member: Member): string => member.nickname ?? member.displayName;

/** Cargos que o bot consegue entregar: abaixo do cargo dele e sem permissões que ele não tem. */
function blockedReason(ctx: BotContext, snap: Snapshot, role: Role): string | null {
  const bot = snap.members.get(ctx.install.userId);
  const mine = snap.roles.find((item) => item.id === ctx.install.roleId);
  if (!bot || !mine) return 'o bot não está mais no grupo';
  if (role.isEveryone || role.botId) return 'não é um cargo que se entrega';
  if (!canManageRole(ctx.community.subjectOf(snap, bot), snap.roles, role)) return `está acima (ou na mesma altura) do cargo “${mine.name}”`;
  if ((role.permissions & ~(mine.permissions | snap.everyone.permissions)) !== 0n) return 'tem permissões que o bot não tem';
  return null;
}

async function give(ctx: BotContext, member: Member, roleIds: string[]): Promise<string[]> {
  const snap = await ctx.snapshot();
  const fresh = snap.members.get(member.userId);
  if (!fresh) return [];
  const wanted = roleIds.filter((id) => !fresh.roleIds.has(id) && snap.roles.some((role) => role.id === id));
  if (wanted.length === 0) return [];
  const names = wanted.map((id) => snap.roles.find((role) => role.id === id)!.name);
  const done = await ctx.attempt(`entregar ${names.join(', ')} a ${nameOf(member)}`, () => ctx.community.setMemberRoles(ctx.bot, ctx.groupId, member.userId, [...fresh.roleIds, ...wanted]));
  if (done) await ctx.log('cargos entregues', { membro: nameOf(member), cargos: names });
  return done ? names : [];
}

export const welcome: BotModule = {
  id: 'boas-vindas',
  name: 'Boas-vindas e Cargos',
  about: 'Recebe quem entra, avisa quem sai, entrega cargos automáticos e deixa os membros escolherem cargos por um menu.',
  category: 'Comunidade',
  icon: 'hand',
  features: [
    'Mensagens de entrada e de saída com variáveis',
    'Cargos automáticos para quem entra',
    'Menu de cargos que cada um escolhe',
    'Verificação de novos membros antes de liberar cargos',
  ],
  // Gerencia cargos, mas só entrega os que cabem dentro destas permissões e ficam abaixo do cargo dele.
  permissions: DEFAULT_EVERYONE | P.MANAGE_ROLES,
  defaultConfig: {
    canalEntrada: '',
    mensagemEntrada: 'Boas-vindas, {usuario}! Você é o membro número {membros} de {grupo}.',
    avisarSaida: false,
    canalSaida: '',
    mensagemSaida: '{usuario} saiu de {grupo}.',
    cargosAutomaticos: [],
    cargosDoMenu: [],
    verificacao: false,
    mensagemVerificacao: '{usuario}, leia as regras e toque em Verificar para liberar o grupo.',
  },
  fields: [
    {
      key: 'canalEntrada',
      type: 'channel',
      label: 'Canal das boas-vindas',
      section: 'Entrada',
      channelKind: 'texto',
      posts: true,
      about: 'Vazio: não manda mensagem de entrada. Ao salvar, o bot ganha permissão para escrever neste canal.',
    },
    { key: 'mensagemEntrada', type: 'longtext', label: 'Mensagem de entrada', section: 'Entrada', about: 'Variáveis: {usuario}, {grupo}, {membros}.' },
    { key: 'cargosAutomaticos', type: 'roles', label: 'Cargos entregues a quem entra', section: 'Entrada' },
    { key: 'verificacao', type: 'toggle', label: 'Exigir verificação', section: 'Verificação', about: 'Com isto ligado, os cargos automáticos só são entregues depois que a pessoa toca em Verificar (ou digita /verificar).' },
    { key: 'mensagemVerificacao', type: 'longtext', label: 'Mensagem pedindo a verificação', section: 'Verificação', about: 'Variáveis: {usuario}, {grupo}.' },
    { key: 'avisarSaida', type: 'toggle', label: 'Avisar quando alguém sai', section: 'Saída' },
    {
      key: 'canalSaida',
      type: 'channel',
      label: 'Canal do aviso de saída',
      section: 'Saída',
      channelKind: 'texto',
      posts: true,
      turnsOn: 'avisarSaida',
      about: 'Vazio: usa o canal das boas-vindas. Escolher um canal liga o aviso de saída; ao salvar, o bot ganha permissão para escrever nele.',
    },
    { key: 'mensagemSaida', type: 'longtext', label: 'Mensagem de saída', section: 'Saída', about: 'Variáveis: {usuario}, {grupo}.' },
    { key: 'cargosDoMenu', type: 'roles', label: 'Cargos que os membros podem pegar sozinhos', section: 'Menu de cargos', about: 'Aparecem em /cargos como botões.' },
  ],

  async onEvent(ctx, event) {
    const config = ctx.install.config;
    const snap = await ctx.snapshot();
    if (event.type === 'member.join') {
      const member = snap.members.get(event.userId);
      if (!member) return;
      const values = { usuario: nameOf(member), grupo: snap.group.name, membros: [...snap.members.values()].filter((item) => !item.bot).length };
      const channelId = String(config.canalEntrada ?? '');
      if (config.verificacao === true) {
        if (channelId) {
          await ctx.say(channelId, `${fill(String(config.mensagemEntrada), values)}\n${fill(String(config.mensagemVerificacao), values)}`, {
            buttons: [{ label: 'Verificar', command: '/verificar', style: 'primario' }],
          });
        }
        await ctx.log('aguardando verificação', { membro: values.usuario });
        return;
      }
      await give(ctx, member, config.cargosAutomaticos as string[]);
      if (channelId) await ctx.say(channelId, fill(String(config.mensagemEntrada), values));
      await ctx.log('entrada', { membro: values.usuario });
    } else if (event.type === 'member.leave' && config.avisarSaida === true) {
      // Quem saiu não está mais na lista de membros: o nome vem da conta.
      const [row] = await ctx.db.query('SELECT display_name, is_bot FROM users WHERE id = $1', [event.userId]);
      if (!row || row.is_bot === true) return;
      const channelId = String(config.canalSaida || config.canalEntrada || '');
      if (channelId) await ctx.say(channelId, fill(String(config.mensagemSaida), { usuario: String(row.display_name), grupo: snap.group.name }));
      await ctx.log('saída', { membro: String(row.display_name), motivo: event.reason });
    }
  },

  commands: [
    {
      name: 'verificar',
      usage: 'verificar',
      about: 'Conclui a sua verificação e libera os cargos de quem entra.',
      async run(ctx, call) {
        const config = ctx.install.config;
        if (config.verificacao !== true) return 'Este grupo não pede verificação.';
        const given = await give(ctx, call.member, config.cargosAutomaticos as string[]);
        await ctx.log('verificado', { membro: nameOf(call.member) });
        return given.length > 0 ? `${nameOf(call.member)}, verificação concluída. Você recebeu: ${given.join(', ')}.` : `${nameOf(call.member)}, verificação concluída.`;
      },
    },
    {
      name: 'cargos',
      usage: 'cargos',
      about: 'Mostra o menu de cargos que você pode pegar ou largar.',
      async run(ctx) {
        const snap = await ctx.snapshot();
        const roles = (ctx.install.config.cargosDoMenu as string[]).map((id) => snap.roles.find((role) => role.id === id)).filter((role): role is Role => role !== undefined);
        if (roles.length === 0) return 'Nenhum cargo foi colocado no menu ainda.';
        return {
          content: 'Toque num cargo para pegar. Toque de novo para largar.',
          meta: { buttons: roles.slice(0, 20).map((role) => ({ label: role.name, command: `/cargo ${role.name}` })) },
        };
      },
    },
    {
      name: 'cargo',
      usage: 'cargo <nome>',
      about: 'Pega ou larga um cargo do menu.',
      async run(ctx, call) {
        const snap = await ctx.snapshot();
        const wanted = call.args.trim().toLowerCase();
        const role = (ctx.install.config.cargosDoMenu as string[]).map((id) => snap.roles.find((item) => item.id === id)).find((item) => item?.name.toLowerCase() === wanted);
        if (!role) return 'Esse cargo não está no menu. Veja a lista em /cargos.';
        const member = snap.members.get(call.user.id);
        if (!member) return;
        const has = member.roleIds.has(role.id);
        const next = has ? [...member.roleIds].filter((id) => id !== role.id) : [...member.roleIds, role.id];
        const done = await ctx.attempt(`${has ? 'tirar' : 'entregar'} ${role.name}`, () => ctx.community.setMemberRoles(ctx.bot, ctx.groupId, member.userId, next));
        if (!done) return `Não consegui mexer no cargo ${role.name}: ${blockedReason(ctx, snap, role) ?? 'o servidor recusou'}.`;
        await ctx.log(has ? 'cargo retirado pelo menu' : 'cargo entregue pelo menu', { membro: nameOf(member), cargo: role.name });
        return has ? `${nameOf(member)} largou o cargo ${role.name}.` : `${nameOf(member)} agora tem o cargo ${role.name}.`;
      },
    },
  ],

  async status(ctx) {
    const snap = await ctx.snapshot();
    const config = ctx.install.config;
    const warnings: string[] = [];
    for (const id of new Set([...(config.cargosAutomaticos as string[]), ...(config.cargosDoMenu as string[])])) {
      const role = snap.roles.find((item) => item.id === id);
      const why = role ? blockedReason(ctx, snap, role) : 'foi excluído';
      if (why) warnings.push(`Não consigo entregar o cargo “${role?.name ?? id}”: ${why}.`);
    }
    for (const key of ['canalEntrada', 'canalSaida']) {
      if (config[key] && !snap.channels.has(String(config[key]))) warnings.push('Um dos canais configurados foi excluído.');
    }
    const leaveChannel = config.canalSaida ? snap.channels.get(String(config.canalSaida)) : undefined;
    if (leaveChannel && config.avisarSaida !== true) {
      warnings.push(`O canal #${leaveChannel.name} está escolhido para o aviso de saída, mas “Avisar quando alguém sai” está desligado.`);
    }
    return warnings;
  },
};
