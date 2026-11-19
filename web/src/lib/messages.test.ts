import { describe, expect, it } from 'vitest';
import { mergeMessages, type Delivery } from './messages.ts';
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
