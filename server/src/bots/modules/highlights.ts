import { P } from '../../../../shared/permissions.ts';
import type { BotContext, BotModule, CommandCall } from '../types.ts';

export const EFFECTS = { confete: 'confete', estrelas: 'uma chuva de estrelas', aurora: 'uma aurora' } as const;
type Effect = keyof typeof EFFECTS;

const nameOf = (call: CommandCall) => call.member.nickname ?? call.member.displayName;

/**
 * Cobra o custo configurado em Cosmic Points de quem chamou o comando. A chave é a própria mensagem do comando:
 * nunca cobra duas vezes. Devolve true ou o texto de resposta explicando por que não deu.
 */
async function pay(ctx: BotContext, call: CommandCall, cost: number, what: string): Promise<true | string> {
  if (cost <= 0) return true;
  if (!ctx.spendPoints) return 'Os Cosmic Points não estão disponíveis neste servidor.';
  const result = await ctx.spendPoints(call.user.id, cost, `${what} (Destaques Cósmicos)`, `bot:${ctx.groupId}:${call.message.id}`);
  if (result === 'ok') return true;
  if (result === 'sem-saldo') return `${nameOf(call)}, você precisa de ${cost} Cosmic Points para isso. Eles são ganhos participando das chamadas e conversas.`;
  return 'Os Cosmic Points não estão disponíveis agora.';
}

/**
 * Ações recreativas com Cosmic Points: mensagem em destaque e efeitos visuais. A administração escolhe quanto cada
 * uma custa (0 = grátis). O bot só publica mensagens decoradas: não dá cargo, permissão nem acesso a nada.
 */
export const highlights: BotModule = {
  id: 'destaques',
  name: 'Destaques Cósmicos',
  about: 'Mensagens em destaque e efeitos visuais que os membros ativam com Cosmic Points (ou de graça, se a administração quiser).',
  category: 'Diversão',
  icon: 'sparkles',
  features: ['/destaque: sua mensagem em destaque no canal', '/efeito: confete, estrelas ou aurora', 'Custo de cada ação escolhido pela administração (0 = grátis)', 'Só cosmético: não dá cargos nem permissões'],
  permissions: P.VIEW_CHANNEL | P.SEND_MESSAGES,
  defaultConfig: { custoDestaque: 30, custoEfeito: 15 },
  fields: [
    { key: 'custoDestaque', type: 'number', label: 'Custo de /destaque (Cosmic Points)', min: 0, max: 500, section: 'Custos', about: '0 = grátis para todos.' },
    { key: 'custoEfeito', type: 'number', label: 'Custo de /efeito (Cosmic Points)', min: 0, max: 500, section: 'Custos', about: '0 = grátis para todos.' },
  ],

  commands: [
    {
      name: 'destaque',
      usage: 'destaque <mensagem>',
      about: 'Publica a sua mensagem em destaque no canal.',
      async run(ctx, call) {
        const text = call.args.trim().slice(0, 300);
        if (!text) return 'Escreva a mensagem: /destaque <mensagem>';
        const cost = Math.max(0, Number(ctx.install.config.custoDestaque) || 0);
        const paid = await pay(ctx, call, cost, 'Mensagem em destaque');
        if (paid !== true) return paid;
        await ctx.say(call.channel.id, text, { style: 'destaque', highlightOf: nameOf(call) });
        await ctx.log('destaque', { membro: nameOf(call), custo: cost });
      },
    },
    {
      name: 'efeito',
      usage: 'efeito <confete|estrelas|aurora>',
      about: 'Solta um efeito visual no canal.',
      async run(ctx, call) {
        const wanted = call.args.trim().toLowerCase() as Effect;
        if (!(wanted in EFFECTS)) return `Efeitos: ${Object.keys(EFFECTS).join(', ')}. Exemplo: /efeito confete`;
        const cost = Math.max(0, Number(ctx.install.config.custoEfeito) || 0);
        const paid = await pay(ctx, call, cost, `Efeito ${wanted}`);
        if (paid !== true) return paid;
        await ctx.say(call.channel.id, `${nameOf(call)} soltou ${EFFECTS[wanted]}!`, { effect: wanted });
        await ctx.log('efeito', { membro: nameOf(call), efeito: wanted, custo: cost });
      },
    },
  ],
};
