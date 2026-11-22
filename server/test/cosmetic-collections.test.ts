import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CATALOG, COLLECTIONS, COLLECTION_SLOTS } from '../../shared/cosmetics.ts';
import { P } from '../../shared/permissions.ts';
import { createWorld, type Person, type World } from './world.ts';

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await w.db.close(); });
let ordinal = 0;
const person = () => w.signup(`cosmetico${++ordinal}`);
const points = async (p: Person) => (await w.ok('GET', '/api/me/points', p.token)).points as number;
const fund = (p: Person, amount = 100_000) => w.economy.earn(p.id, amount, 'teste', 'Coleções', randomUUID(), { ignoreCaps: true });
const inventory = (p: Person) => w.ok('GET', '/api/me/inventory', p.token);
const quote = (p: Person, id: string) => w.ok('GET', `/api/shop/collections/${id}/quote`, p.token);
const purchase = (p: Person, q: any) => w.api('POST', `/api/shop/collections/${q.collectionId}/buy`, p.token, { expectedPrice: q.price, expectedItemIds: q.itemIds });
const equip = (p: Person, kind: string, itemId: string | null) => w.ok('PUT', '/api/me/equipped', p.token, { slot: kind, itemId, variant: 'original' });
const friends = async (a: Person, b: Person) => { await w.ok('POST', '/api/friends', a.token, { userId: b.id }); await w.ok('POST', `/api/friends/${a.id}/accept`, b.token); };

describe('coleções com arte original e cinco espaços independentes', () => {
  it('oferece 14 coleções e 70 itens, preservando os 14 itens anteriores e seus preços', async () => {
    expect(COLLECTIONS).toHaveLength(14);
    expect(CATALOG.filter((item) => item.collectionId)).toHaveLength(70);
    expect(CATALOG.filter((item) => !item.collectionId && !item.pack)).toHaveLength(14);
    for (const collection of COLLECTIONS) {
      expect(CATALOG.filter((item) => item.collectionId === collection.id).map((item) => item.kind)).toEqual(COLLECTION_SLOTS);
    }
    const a = await person();
    const items = (await w.ok('GET', '/api/shop', a.token)).items;
    expect(items.find((item: any) => item.id === 'anel-aurora')).toMatchObject({ price: 150, kind: 'decoracao' });
    expect(items.find((item: any) => item.id === 'night-fury-efeito-nome')).toMatchObject({ price: 250, kind: 'efeito-nome' });
    expect((await w.api('PUT', '/api/me/equipped', a.token, { slot: 'efeito-nome', itemId: 'night-fury-efeito-nome' })).status).toBe(403);
  });

  it('cobra só os itens que faltam e serializa duas compras da coleção', async () => {
    const a = await person(); await fund(a);
    await w.ok('POST', '/api/shop/buy', a.token, { itemId: 'neon-decoracao', expectedPrice: 150 });
    const q = await quote(a, 'neon');
    expect(q.ownedIds).toEqual(['neon-decoracao']);
    expect(q.itemIds).toHaveLength(4);
    expect(q.price).toBe(120 + 200 + 250 + 250);
    const before = await points(a);
    expect((await Promise.all([purchase(a, q), purchase(a, q)])).map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await points(a)).toBe(before - q.price);
    expect((await inventory(a)).items).toHaveLength(5);
  });

  it('recusa cotação antiga, item indisponível e saldo insuficiente sem aquisição parcial', async () => {
    const a = await person(); await fund(a);
    const q = await quote(a, 'jett');
    await w.db.query("INSERT INTO shop_settings(item_id,price) VALUES ('jett-fundo',321)");
    expect((await purchase(a, q)).json.error.code).toBe('preco_alterado');
    expect((await inventory(a)).items).toEqual([]);
    expect(await points(a)).toBe(100_000);
    await w.db.query("UPDATE shop_settings SET active=false WHERE item_id='jett-fundo'");
    expect((await purchase(a, await quote(a, 'jett'))).json.error.code).toBe('item_indisponivel');
    await w.db.query("DELETE FROM shop_settings WHERE item_id='jett-fundo'");
    const poor = await person();
    expect((await purchase(poor, await quote(poor, 'jett'))).json.error.code).toBe('pontos_insuficientes');
    expect((await inventory(poor)).items).toEqual([]);
  });

  it('adquire todas as coleções, equipa e desequipa cada peça, sem remover cosméticos anteriores', async () => {
    const a = await person(); await fund(a);
    await w.ok('POST', '/api/shop/buy', a.token, { itemId: 'anel-aurora', expectedPrice: 150 });
    for (const collection of COLLECTIONS) expect((await purchase(a, await quote(a, collection.id))).status).toBe(200);
    for (const item of CATALOG.filter((entry) => entry.collectionId)) {
      expect((await equip(a, item.kind, item.id)).equipped[item.kind]).toEqual({ item: item.id, variant: 'original' });
      expect((await equip(a, item.kind, null)).equipped[item.kind]).toBeUndefined();
    }
    expect((await inventory(a)).items).toHaveLength(COLLECTIONS.length * COLLECTION_SLOTS.length + 1);
  }, 30_000);

  it('combina cinco coleções e sincroniza equipar/desequipar com observadores em dois servidores', async () => {
    const a = await person(), b = await person(); await fund(a);
    const g1 = await w.group(a), g2 = await w.group(b);
    await w.join(a, g1, b); await w.join(b, g2, a);
    const observer = await w.connect(b);
    const ids = ['neon-decoracao', 'omen-moldura', 'madu-kaiden-fundo', 'clove-cor-nome', 'night-fury-efeito-nome'];
    for (const id of ids) {
      const item = CATALOG.find((entry) => entry.id === id)!;
      await w.ok('POST', '/api/shop/buy', a.token, { itemId: id, expectedPrice: item.price });
      await equip(a, item.kind, id);
    }
    const role = await w.role(a, g1, 'Moderador', P.MANAGE_MESSAGES);
    await w.give(a, g1, a, [role]);
    await w.ok('PATCH', `/api/groups/${g1}/members/${a.id}`, a.token, { nickname: 'Outro apelido' });
    const seen = (await w.ok('GET', `/api/cosmetics?ids=${a.id}`, b.token)).cosmetics[a.id];
    expect(Object.values(seen).map((entry: any) => entry.item).sort()).toEqual(ids.sort());
    expect(observer.of('profile.changed').some((event: any) => event.userId === a.id)).toBe(true);
    observer.events.length = 0;
    await equip(a, 'efeito-nome', null);
    expect(observer.of('profile.changed').some((event: any) => event.userId === a.id)).toBe(true);
    expect((await w.ok('GET', `/api/cosmetics?ids=${a.id}`, b.token)).cosmetics[a.id]['efeito-nome']).toBeUndefined();
    observer.close();
  });

  it('presenteia um efeito individual e transfere o efeito equipado com sincronização', async () => {
    const a = await person(), b = await person(); await friends(a, b); await fund(a);
    const itemId = 'clove-efeito-nome';
    const input = { recipientId: b.id, itemId, kind: 'purchase', confirm: true, expectedPrice: 250, requestId: randomUUID() };
    const sent = await w.ok('POST', '/api/shop/gifts', a.token, input);
    expect(await w.ok('POST', '/api/shop/gifts', a.token, input)).toMatchObject({ id: sent.id, replay: true });
    await equip(b, 'efeito-nome', itemId);
    await w.db.query('INSERT INTO shop_settings(item_id,transferable) VALUES ($1,true)', [itemId]);
    await w.ok('POST', '/api/shop/gifts', b.token, { recipientId: a.id, itemId, kind: 'transfer', confirm: true, expectedPrice: 250, requestId: randomUUID() });
    expect((await inventory(b)).equipped['efeito-nome']).toBeUndefined();
    expect((await inventory(a)).items.some((item: any) => item.id === itemId)).toBe(true);
    await w.db.query('DELETE FROM shop_settings WHERE item_id=$1', [itemId]);
  });

  it('presente da coleção entrega somente itens faltantes, com uma transação e replay idempotente', async () => {
    const a = await person(), b = await person(); await friends(a, b); await fund(a); await fund(b);
    await w.ok('POST', '/api/shop/buy', b.token, { itemId: 'raze-fundo', expectedPrice: 200 });
    const q = await w.ok('GET', `/api/shop/collections/raze/quote?recipientId=${b.id}`, a.token);
    expect(q.itemIds).toHaveLength(4);
    const before = await points(a);
    const input = { recipientId: b.id, expectedPrice: q.price, expectedItemIds: q.itemIds, confirm: true, requestId: randomUUID(), message: 'Uma coleção!' };
    const results = await Promise.all([w.ok('POST', '/api/shop/collections/raze/gift', a.token, input), w.ok('POST', '/api/shop/collections/raze/gift', a.token, input)]);
    expect(results[0].id).toBe(results[1].id);
    expect(await points(a)).toBe(before - q.price);
    expect((await inventory(b)).items).toHaveLength(5);
    expect((await w.ok('GET', '/api/me/gifts', b.token)).gifts[0]).toMatchObject({ itemId: 'collection:raze', price: q.price });
  });

  it('arte definitiva do Kayden equipa, persiste e sincroniza sem nova compra', async () => {
    const a = await person(), b = await person(); await fund(a);
    const group = await w.group(a); await w.join(a, group, b);
    await w.ok('POST', '/api/shop/buy', a.token, { itemId: 'madu-kaiden-fundo', expectedPrice: 200 });
    const before = await points(a), observer = await w.connect(b);
    const saved = await w.ok('PUT', '/api/me/equipped', a.token, { slot: 'fundo', itemId: 'madu-kaiden-fundo', variant: 'original' });
    expect(saved.equipped.fundo).toEqual({ item: 'madu-kaiden-fundo', variant: 'original' });
    expect((await inventory(a)).items).toHaveLength(1);
    expect(await points(a)).toBe(before);
    expect((await w.ok('GET', `/api/cosmetics?ids=${a.id}`, b.token)).cosmetics[a.id].fundo).toEqual(saved.equipped.fundo);
    expect(observer.of('profile.changed').some((event: any) => event.userId === a.id)).toBe(true);
    expect((await w.api('PUT', '/api/me/equipped', a.token, { slot: 'fundo', itemId: 'madu-kaiden-fundo', variant: 'nao-existe' })).status).toBe(400);
    expect((await inventory(a)).equipped.fundo.variant).toBe('original');
    expect((await equip(a, 'fundo', 'madu-kaiden-fundo')).equipped.fundo.variant).toBe('original');
    observer.close();
  });

  it('administrador adquire e equipa efeito sem vínculo com cargos locais nem débito', async () => {
    const admin = await person();
    await w.db.query('INSERT INTO global_permissions(user_id) VALUES ($1)', [admin.id]);
    expect((await purchase(admin, await quote(admin, 'tejo'))).json.error.code).toBe('mfa_necessario');
    await w.db.query("UPDATE sessions SET admin_verified_until=now()+interval '10 minutes' WHERE user_id=$1", [admin.id]);
    expect((await purchase(admin, await quote(admin, 'tejo'))).status).toBe(200);
    expect(await points(admin)).toBe(0);
    expect((await inventory(admin)).items.every((item: any) => item.adminGrant)).toBe(true);
    expect((await equip(admin, 'efeito-nome', 'tejo-efeito-nome')).equipped['efeito-nome'].item).toBe('tejo-efeito-nome');
  });

  it('preserva os 69 IDs publicados e mantém o enfeite antigo ao equipar o novo efeito', async () => {
    const legacy = CATALOG.filter((item) => !item.collectionId);
    expect(legacy).toHaveLength(69);
    const a = await person(); await fund(a);
    await w.ok('POST', '/api/shop/buy-pack', a.token, { packId: 'gato-trovao', expectedPrice: 1425 });
    await w.ok('PUT', '/api/me/equipped/pack', a.token, { packId: 'gato-trovao' });
    const oldEquipment = (await inventory(a)).equipped;
    await w.ok('POST', '/api/shop/buy', a.token, { itemId: 'night-fury-efeito-nome', expectedPrice: 250 });
    expect((await equip(a, 'efeito-nome', 'night-fury-efeito-nome')).equipped).toEqual({ ...oldEquipment, 'efeito-nome': { item: 'night-fury-efeito-nome', variant: 'original' } });
    await w.ok('PUT', '/api/me/equipped/pack', a.token, { packId: 'gato-trovao' });
    expect((await inventory(a)).equipped['efeito-nome'].item).toBe('night-fury-efeito-nome');
    expect((await equip(a, 'efeito-nome', null)).equipped).toEqual(oldEquipment);
  });
});
