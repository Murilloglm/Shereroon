import { has, P } from '../../../../shared/permissions.ts';
import type { BotContext, BotModule } from '../types.ts';
import { formatWhen, isTimeZone, parseWhen } from '../util.ts';

interface Reminder {
  id: string;
  kind: 'individual' | 'grupo' | 'mensagem';
  userId: string;
  userName: string;
  channelId: string;
  text: string;
  at: string;
  everySeconds: number | null;
  jobId: string;
  /** Lembrete coletivo: quem pediu para ser avisado. */
  subscribers: { id: string; name: string }[];
}

const zone = (ctx: BotContext): string => (isTimeZone(ctx.install.config.fuso) ? ctx.install.config.fuso : 'America/Sao_Paulo');
const HELP = 'Não entendi a data. Exemplos: “em 20m”, “hoje 21:00”, “amanhã 8h30”, “sexta 20:00”, “25/12 09:00”, “todo dia 21:00”, “toda segunda 20:00”.';

async function create(ctx: BotContext, kind: Reminder['kind'], call: { args: string; user: { id: string }; member: { nickname: string | null; displayName: string }; channel: { id: string } }) {
  const parsed = parseWhen(call.args, ctx.now(), zone(ctx));
  if (!parsed) return HELP;
  if (!parsed.rest) return 'Faltou dizer o texto depois da data.';
  const name = call.member.nickname ?? call.member.displayName;
  const mine = (await ctx.data.list<Reminder>('lembretes')).filter((item) => item.value.userId === call.user.id);
  const limit = Number(ctx.install.config.maxPorPessoa) || 10;
  if (mine.length >= limit) return `${name}, você já tem ${limit} lembretes agendados. Cancele algum em /lembretes.`;
  // Um identificador curto, fácil de digitar.
  const id = Math.random().toString(36).slice(2, 7);
  const jobId = await ctx.schedule('lembrete', { id }, parsed.at, parsed.everySeconds);
  const reminder: Reminder = {
    id,
    kind,
    userId: call.user.id,
    userName: name,
    channelId: call.channel.id,
    text: parsed.rest.slice(0, 1000),
    at: parsed.at.toISOString(),
    everySeconds: parsed.everySeconds ?? null,
    jobId,
    subscribers: [],
  };
  await ctx.data.set('lembretes', id, reminder);
  await ctx.log('agendado', { tipo: kind, por: name, quando: reminder.at, repete: reminder.everySeconds !== null });
  const when = `${formatWhen(parsed.at, zone(ctx))}${parsed.everySeconds ? (parsed.everySeconds === 86_400 ? ', todos os dias' : ', toda semana') : ''}`;
  const buttons = [
    ...(kind === 'grupo' ? [{ label: 'Quero ser avisado', command: `/lembrete-participar ${id}`, style: 'primario' as const }] : []),
    { label: 'Cancelar', command: `/lembrete-cancelar ${id}`, style: 'perigo' as const },
  ];
  const what = kind === 'mensagem' ? 'Mensagem agendada' : kind === 'grupo' ? 'Lembrete do grupo agendado' : `${name}, lembrete agendado`;
  return { content: `${what} para ${when} (código ${id}).`, meta: { buttons } };
}

export const reminders: BotModule = {
  id: 'lembretes',
  name: 'Lembretes',
  about: 'Agenda lembretes individuais e do grupo, mensagens programadas e avisos que se repetem, no fuso horário do grupo.',
  category: 'Utilidades',
  icon: 'alarm',
  features: ['Lembretes individuais', 'Lembretes do grupo com inscrição', 'Mensagens agendadas', 'Repetição diária ou semanal', 'Fuso horário configurável'],
  permissions: P.VIEW_CHANNEL | P.SEND_MESSAGES,
  defaultConfig: { fuso: 'America/Sao_Paulo', maxPorPessoa: 10 },
  fields: [
    { key: 'fuso', type: 'text', label: 'Fuso horário do grupo', about: 'No formato da lista da IANA, por exemplo America/Sao_Paulo, America/Manaus ou Europe/Lisbon.', placeholder: 'America/Sao_Paulo' },
    { key: 'maxPorPessoa', type: 'number', label: 'Lembretes agendados por pessoa', min: 1, max: 50 },
  ],

  commands: [
    {
      name: 'lembrete',
      usage: 'lembrete <quando> <texto>',
      about: 'Avisa você neste canal na hora marcada. Ex.: /lembrete em 20m tirar a pizza do forno',
      run: (ctx, call) => create(ctx, 'individual', call),
    },
    {
      name: 'lembrete-grupo',
      usage: 'lembrete-grupo <quando> <texto>',
      about: 'Lembrete para o grupo: quem quiser toca em “Quero ser avisado”.',
      run: (ctx, call) => create(ctx, 'grupo', call),
    },
    {
      name: 'agendar',
      usage: 'agendar <quando> <texto>',
      about: 'Programa uma mensagem do bot neste canal. Aceita repetição (“todo dia 21:00”).',
      permission: P.USE_ADMIN_TOOLS,
      run: (ctx, call) => create(ctx, 'mensagem', call),
    },
    {
      name: 'lembrete-participar',
      usage: 'lembrete-participar <código>',
      about: 'Entra na lista de um lembrete do grupo.',
      async run(ctx, call) {
        const id = call.argv[0] ?? '';
        const name = call.member.nickname ?? call.member.displayName;
        let outcome = 'Não achei esse lembrete do grupo.';
        await ctx.data.update<Reminder>('lembretes', id, (current) => {
          if (!current || current.kind !== 'grupo') return current;
          if (current.subscribers.some((item) => item.id === call.user.id)) {
            outcome = `${name}, você já está na lista.`;
            return current;
          }
          outcome = `${name} vai ser avisado: ${current.text}`;
          return { ...current, subscribers: [...current.subscribers, { id: call.user.id, name }].slice(0, 200) };
        });
        return outcome;
      },
    },
    {
      name: 'lembretes',
      usage: 'lembretes',
      about: 'Lista os seus lembretes e os lembretes do grupo.',
      async run(ctx, call) {
        const all = (await ctx.data.list<Reminder>('lembretes')).map((item) => item.value);
        const mine = all.filter((item) => item.userId === call.user.id || item.kind !== 'individual').sort((a, b) => a.at.localeCompare(b.at));
        if (mine.length === 0) return 'Nenhum lembrete agendado.';
        const label = { individual: 'seu', grupo: 'grupo', mensagem: 'mensagem' };
        return mine.map((item) => `• ${item.id} (${label[item.kind]}) ${formatWhen(new Date(item.at), zone(ctx))}${item.everySeconds ? ' ↻' : ''}: ${item.text}`).join('\n').slice(0, 3900);
      },
    },
    {
      name: 'lembrete-cancelar',
      usage: 'lembrete-cancelar <código>',
      about: 'Cancela um lembrete seu (ou qualquer um, com as ferramentas administrativas).',
      async run(ctx, call) {
        const reminder = await ctx.data.get<Reminder>('lembretes', call.argv[0] ?? '');
        if (!reminder) return 'Não achei esse lembrete. Veja os códigos em /lembretes.';
        if (reminder.userId !== call.user.id && !has(call.permissions, P.USE_ADMIN_TOOLS)) return 'Só quem criou o lembrete, ou a moderação, pode cancelar.';
        await ctx.cancel(reminder.jobId);
        await ctx.data.delete('lembretes', reminder.id);
        await ctx.log('cancelado', { codigo: reminder.id, por: call.user.displayName });
        return `Lembrete ${reminder.id} cancelado.`;
      },
    },
  ],

  async onJob(ctx, job) {
    if (job.kind !== 'lembrete') return;
    const id = String(job.payload.id);
    const reminder = await ctx.data.get<Reminder>('lembretes', id);
    // Cancelado entre o agendamento e a hora: nada a fazer.
    if (!reminder) return;
    const text =
      reminder.kind === 'mensagem'
        ? reminder.text
        : reminder.kind === 'grupo'
          ? `⏰ Lembrete do grupo: ${reminder.text}${reminder.subscribers.length > 0 ? `\nAvisando: ${reminder.subscribers.map((item) => item.name).join(', ')}.` : ''}`
          : `⏰ ${reminder.userName}, lembrete: ${reminder.text}`;
    const sent = await ctx.say(reminder.channelId, text);
    await ctx.log(sent ? 'entregue' : 'não entregue', { codigo: id, tipo: reminder.kind }, sent ? 'info' : 'aviso');
    if (reminder.everySeconds) {
      await ctx.data.set('lembretes', id, { ...reminder, at: new Date(Date.parse(reminder.at) + Math.max(1, Math.ceil((ctx.now().getTime() - Date.parse(reminder.at) + 1) / (reminder.everySeconds * 1000))) * reminder.everySeconds * 1000).toISOString() });
    } else {
      await ctx.data.delete('lembretes', id);
    }
  },

  async status(ctx) {
    return isTimeZone(ctx.install.config.fuso) ? [] : [`O fuso “${String(ctx.install.config.fuso)}” não existe; estou usando America/Sao_Paulo.`];
  },
};
