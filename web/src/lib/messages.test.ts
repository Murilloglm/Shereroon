import { describe, expect, it } from 'vitest';
import { messageLayout, mergeMessages, type Delivery } from './messages.ts';
type Message = Delivery & { id: string; createdAt: string; author: { id: string }; text: string };
const make = (id: string, clientId?: string, delivery?: Delivery['delivery']): Message => ({ id, clientId, delivery, createdAt: '2026-11-18T12:00:00Z', author: { id: 'ana' }, text: 'oi' });
describe('confirmação e ordem do chat', () => {
  it('eco do gateway e resposta HTTP em qualquer ordem substituem a linha otimista uma vez', () => {
    for (const status of ['sending', 'failed'] as const) {
      const local = make('local-abc', 'request', status);
      const echo = make('123', 'request');
      const first = mergeMessages([local], [echo]);
      const second = mergeMessages(first, [structuredClone(echo)]);
      expect(second).toHaveLength(1);
      expect(second[0]).toMatchObject({ id: '123', delivery: 'sent', clientId: 'request' });
      expect(second[0]).toBe(first[0]);
    }
  });
  it('ordena IDs maiores que Number.MAX_SAFE_INTEGER e preserva referências das outras mensagens', () => {
    const old = make('9007199254740992');
    const result = mergeMessages([make('local', 'r', 'sending'), make('9007199254740994'), old], [make('9007199254740993')]);
    expect(result.map(x => x.id)).toEqual(['9007199254740992', '9007199254740993', '9007199254740994', 'local']);
    expect(result[0]).toBe(old);
  });
  it('a mesma chave de duas contas não une mensagens distintas', () => {
    const a = make('local', 'r', 'sending');
    const b = { ...make('12', 'r'), author: { id: 'beto' } };
    expect(mergeMessages([a], [b])).toHaveLength(2);
  });
});

describe('agrupamento visual em canais e DMs', () => {
  const at = (seconds: number, user = 'ana', context = 'geral') => ({
    channelId: context, author: { id: user }, createdAt: new Date(2026, 10, 20, 12, 0, seconds).toISOString(),
  });
  it.each([[10, true], [119, true], [120, false], [121, false], [-1, false]] as const)('intervalo de %i segundos', (seconds, eligible) => {
    expect(messageLayout(at(0), at(seconds)).grouped).toBe(eligible);
  });
  it('compara vizinhos ao receber e paginar, incluindo a virada de data', () => {
    const history = [at(0), at(110), at(220), at(225, 'beto'), at(230)];
    expect(history.map((m,i) => messageLayout(history[i-1],m).grouped)).toEqual([false,true,true,false,false]);
    expect(messageLayout(at(0), at(10,'ana','outro')).grouped).toBe(false);
    expect(messageLayout(at(0), { dmId:'geral', author:at(0).author, createdAt:at(1).createdAt }).grouped).toBe(false);
    const midnight = new Date(2026, 10, 21).getTime();
    expect(messageLayout({ ...at(0), createdAt:new Date(midnight-1000).toISOString() }, { ...at(1), createdAt:new Date(midnight).toISOString() })).toEqual({newDay:true,grouped:false});
  });
});
