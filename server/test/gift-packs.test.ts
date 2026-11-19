// Presentear um pacote: o amigo recebe só as peças que ainda não tem, pelo preço do pacote (com desconto quando são
// duas ou mais); um débito só, um presente só no histórico, mesmo com o pedido repetido; só entre amigos.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { CATALOG, packById, packPrice, SLOTS } from '../../shared/cosmetics.ts';
import { createWorld, type Person, type World } from './world.ts';

let w: World;
let ana: Person, beto: Person, caio: Person;
const gato = packById('gato-trovao')!;
const priceOf = (id: string) => CATALOG.find((item) => item.id === id)!.price;
const points = async (who: Person) => ((await w.ok('GET', '/api/me/points', who.token)) as any).points as number;
const owned = async (who: Person) => ((await w.ok('GET', '/api/me/inventory', who.token)) as any).items.map((item: any) => item.id).sort();
const quote = (from: Person, to: Person, packId = 'gato-trovao') => w.api('GET', `/api/shop/packs/${packId}/gift-quote?recipientId=${to.id}`, from.token);
const send = (from: Person, to: Person, extra: Record<string, unknown> = {}) =>
  w.api('POST', '/api/shop/gift-pack', from.token, { packId: 'gato-trovao', recipientId: to.id, message: 'Miau!', confirm: true, requestId: randomUUID(), ...extra });

beforeAll(async () => {
  w = await createWorld();
  ana = await w.signup('ana');
  beto = await w.signup('beto');
  caio = await w.signup('caio');
  await w.ok('POST', '/api/friends', ana.token, { userId: beto.id });
  await w.ok('POST', `/api/friends/${ana.id}/accept`, beto.token);
  await w.economy.earn(ana.id, 5000, 'teste', 'saldo de teste', 'teste:ana', { ignoreCaps: true });
  await w.economy.earn(caio.id, 5000, 'teste', 'saldo de teste', 'teste:caio', { ignoreCaps: true });
});

describe('presentear um pacote', () => {
  it('a cotação considera o que o amigo já tem: só as peças que faltam, com desconto', async () => {
    await w.economy.earn(beto.id, 500, 'teste', 'saldo de teste', 'teste:beto', { ignoreCaps: true });
    await w.ok('POST', '/api/shop/buy', beto.token, { itemId: gato.items.enfeite });
    const missing = SLOTS.filter((kind) => kind !== 'enfeite').map((kind) => gato.items[kind]);
    const { json } = await quote(ana, beto);
    expect(json).toMatchObject({ missing, price: packPrice(missing.map(priceOf)) });
    // A cotação é só entre amigos.
    expect((await quote(caio, beto)).status).toBe(403);
  });

  it('cobra uma vez só, entrega as peças que faltam e aparece como um presente só, com aviso ao amigo', async () => {
    const live = await w.connect(beto);
    const before = await points(ana);
    const { json: q } = await quote(ana, beto);
    const key = randomUUID();
    const results = await Promise.all([send(ana, beto, { requestId: key, expectedPrice: q.price }), send(ana, beto, { requestId: key, expectedPrice: q.price })]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.json.replay).sort()).toEqual([false, true]);
    expect(await points(ana)).toBe(before - q.price);
    expect(await owned(beto)).toEqual(Object.values(gato.items).sort());
    expect(await owned(ana)).toEqual([]);
    expect(live.of('gift.received')).toHaveLength(1);
    live.close();
    const [gift] = (await w.ok('GET', '/api/me/gifts', beto.token)).gifts;
    expect(gift).toMatchObject({ senderId: ana.id, packId: 'gato-trovao', items: q.missing, price: q.price, message: 'Miau!', unread: true });
    expect((await w.ok('GET', '/api/me/points', ana.token)).history[0]).toMatchObject({ delta: -q.price, reason: 'presente', detail: 'Presente: pacote Gato Trovão' });
  });

  it('se o amigo já tem tudo, recusa sem cobrar', async () => {
    const before = await points(ana);
    expect((await send(ana, beto)).json.error.code).toBe('pacote_completo');
    expect(await points(ana)).toBe(before);
  });

  it('recusa quem não é amigo, sem confirmação, preço mudado e saldo insuficiente, sem perda', async () => {
    const slime = { packId: 'slime-celeste' };
    expect((await send(caio, beto, slime)).status).toBe(403);
    expect((await send(ana, beto, { ...slime, confirm: false })).status).toBe(400);
    expect((await send(ana, beto, { ...slime, expectedPrice: 1 })).json.error.code).toBe('preco_alterado');
    expect((await send(beto, ana, { ...slime, expectedPrice: (await quote(beto, ana, 'slime-celeste')).json.price })).json.error.code).toBe('pontos_insuficientes');
    expect((await w.api('POST', '/api/shop/gift-pack', ana.token, { packId: 'nao-existe', recipientId: beto.id, confirm: true, requestId: randomUUID() })).json.error.code).toBe('pacote_inexistente');
    expect((await owned(beto)).some((id: string) => id.startsWith('slime-celeste'))).toBe(false);
  });
});
