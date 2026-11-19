// Pacotes cosméticos: 5 itens comuns do catálogo (um por categoria, incluindo o "enfeite no nome do servidor").
// Comprar o pacote leva tudo o que falta numa transação só, com desconto; cada peça continua avulsa (compra,
// equipa e mistura com outras); "usar o pacote completo" equipa de uma vez o que a conta tem dele.
import { beforeAll, describe, expect, it } from 'vitest';
import { CATALOG, PACKS, packById, packPrice, PACK_SLOTS as SLOTS } from '../../shared/cosmetics.ts';
import { createWorld, type Person, type World } from './world.ts';

let w: World;
let ana: Person, beto: Person, caio: Person;

const balance = async (who: Person) => (await w.ok('GET', '/api/me/points', who.token)) as { points: number; history: any[] };
const give = (who: Person, amount: number, ref: string) => w.economy.earn(who.id, amount, 'teste', 'saldo de teste', ref, { ignoreCaps: true });
const owned = async (who: Person) => ((await w.ok('GET', '/api/me/inventory', who.token)) as any).items.map((item: any) => item.id).sort();
const gato = packById('gato-trovao')!;
const priceOf = (id: string) => CATALOG.find((item) => item.id === id)!.price;

beforeAll(async () => {
  w = await createWorld();
  ana = await w.signup('ana');
  beto = await w.signup('beto');
  caio = await w.signup('caio');
});

describe('catálogo de pacotes', () => {
  it('11 pacotes, cada um com um item de cada uma das 5 categorias, ids únicos', () => {
    expect(PACKS).toHaveLength(11);
    expect(SLOTS).toContain('enfeite');
    const ids = CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pack of PACKS) {
      expect(pack.rules.length).toBeGreaterThan(0);
      for (const kind of SLOTS) {
        const item = CATALOG.find((entry) => entry.id === pack.items[kind]);
        expect(item, `${pack.id}: ${kind}`).toMatchObject({ kind, pack: pack.id, rarity: pack.rarity });
      }
    }
  });

  it('o desconto vale para dois ou mais itens; um só sai pelo preço normal', () => {
    expect(packPrice([600, 300, 350, 300, 350])).toBe(1425);
    expect(packPrice([300])).toBe(300);
  });

  it('a loja mostra cada pacote com o preço do que falta', async () => {
    const shop = (await w.ok('GET', '/api/shop', ana.token)) as any;
    const pack = shop.packs.find((entry: any) => entry.id === 'gato-trovao');
    const full = SLOTS.map((kind) => priceOf(gato.items[kind]));
    expect(pack).toMatchObject({ missing: SLOTS.map((kind) => gato.items[kind]), price: packPrice(full), fullPrice: full.reduce((a, b) => a + b, 0), active: true });
    expect(shop.items.find((item: any) => item.id === gato.items.enfeite)).toMatchObject({ kind: 'enfeite', pack: 'gato-trovao' });
  });
});

describe('comprar o pacote', () => {
  it('sem saldo é recusado e nada é entregue', async () => {
    expect((await w.api('POST', '/api/shop/buy-pack', ana.token, { packId: 'gato-trovao' })).json.error.code).toBe('pontos_insuficientes');
    expect(await owned(ana)).toEqual([]);
    expect((await w.api('POST', '/api/shop/buy-pack', ana.token, { packId: 'nao-existe' })).json.error.code).toBe('pacote_inexistente');
  });

  it('leva os 5 itens de uma vez, cobrando o preço do pacote uma vez só, mesmo com dois pedidos juntos', async () => {
    await give(ana, 5000, 'teste:ana');
    const before = (await balance(ana)).points;
    const price = ((await w.ok('GET', '/api/shop', ana.token)) as any).packs.find((entry: any) => entry.id === 'gato-trovao').price;
    const results = await Promise.all([1, 2].map(() => w.api('POST', '/api/shop/buy-pack', ana.token, { packId: 'gato-trovao', expectedPrice: price })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const after = await balance(ana);
    expect(after.points).toBe(before - price);
    expect(after.history[0]).toMatchObject({ delta: -price, reason: 'compra', detail: 'Pacote: Gato Trovão' });
    expect(await owned(ana)).toEqual(Object.values(gato.items).sort());
    const pack = ((await w.ok('GET', '/api/shop', ana.token)) as any).packs.find((entry: any) => entry.id === 'gato-trovao');
    expect(pack).toMatchObject({ missing: [], price: 0 });
  });

  it('com parte do pacote, cobra só o que falta (com desconto); preço mudado pede nova confirmação', async () => {
    const slime = packById('slime-celeste')!;
    await give(beto, 5000, 'teste:beto');
    await w.ok('POST', '/api/shop/buy', beto.token, { itemId: slime.items.decoracao });
    const missing = SLOTS.filter((kind) => kind !== 'decoracao').map((kind) => slime.items[kind]);
    const expected = packPrice(missing.map(priceOf));
    expect((await w.api('POST', '/api/shop/buy-pack', beto.token, { packId: 'slime-celeste', expectedPrice: expected + 5 })).json.error.code).toBe('preco_alterado');
    const before = (await balance(beto)).points;
    await w.ok('POST', '/api/shop/buy-pack', beto.token, { packId: 'slime-celeste', expectedPrice: expected });
    expect((await balance(beto)).points).toBe(before - expected);
    expect(await owned(beto)).toEqual(Object.values(slime.items).sort());
    expect((await w.api('POST', '/api/shop/buy-pack', beto.token, { packId: 'slime-celeste' })).json.error.code).toBe('pacote_completo');
  });

  it('um item do pacote fora da loja impede a compra do pacote', async () => {
    await w.db.query('INSERT INTO shop_settings (item_id, active) VALUES ($1, false)', [packById('mira-tatica')!.items.fundo]);
    await give(caio, 5000, 'teste:caio');
    expect((await w.api('POST', '/api/shop/buy-pack', caio.token, { packId: 'mira-tatica' })).json.error.code).toBe('item_indisponivel');
    expect(await owned(caio)).toEqual([]);
  });
});

describe('equipar', () => {
  it('cada peça vai no seu espaço, inclusive o enfeite no nome; dá para misturar pacotes', async () => {
    const slime = packById('slime-celeste')!;
    await w.ok('PUT', '/api/me/equipped', beto.token, { slot: 'enfeite', itemId: slime.items.enfeite, variant: 'original' });
    expect((await w.api('PUT', '/api/me/equipped', beto.token, { slot: 'enfeite', itemId: slime.items.decoracao })).json.error.code).toBe('espaco_invalido');
    expect((await w.api('PUT', '/api/me/equipped', beto.token, { slot: 'enfeite', itemId: gato.items.enfeite })).json.error.code).toBe('item_nao_adquirido');
    const seen = (await w.ok('GET', `/api/cosmetics?ids=${beto.id}`, ana.token)).cosmetics[beto.id];
    expect(seen).toEqual({ enfeite: { item: slime.items.enfeite, variant: 'original' } });
  });

  it('"usar o pacote completo" equipa de uma vez tudo o que a conta tem do pacote, por cima do que estava', async () => {
    await w.ok('PUT', '/api/me/equipped', ana.token, { slot: 'decoracao', itemId: gato.items.decoracao });
    const inventory = (await w.ok('PUT', '/api/me/equipped/pack', ana.token, { packId: 'gato-trovao' })) as any;
    expect(inventory.equipped).toEqual(Object.fromEntries(SLOTS.map((kind) => [kind, { item: gato.items[kind], variant: 'original' }])));
    // Misturar: trocar só a decoração não mexe no resto.
    await w.ok('POST', '/api/shop/buy', ana.token, { itemId: 'anel-aurora' });
    await w.ok('PUT', '/api/me/equipped', ana.token, { slot: 'decoracao', itemId: 'anel-aurora', variant: 'rosa' });
    const seen = (await w.ok('GET', `/api/cosmetics?ids=${ana.id}`, beto.token)).cosmetics[ana.id];
    expect(seen.decoracao).toEqual({ item: 'anel-aurora', variant: 'rosa' });
    expect(seen.enfeite).toEqual({ item: gato.items.enfeite, variant: 'original' });
  });

  it('sem nenhum item do pacote, "usar o pacote completo" é recusado', async () => {
    expect((await w.api('PUT', '/api/me/equipped/pack', caio.token, { packId: 'asa-aurora' })).json.error.code).toBe('item_nao_adquirido');
  });
});
