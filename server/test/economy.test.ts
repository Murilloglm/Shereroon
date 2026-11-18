// Cosmic Points, loja e inventário: ganhos por participação real (com limites diários e sem farm), compras
// atômicas (sem saldo negativo, sem comprar duas vezes, nem com dois pedidos juntos), equipar só o que tem e o que
// os outros veem.
import { beforeAll, describe, expect, it } from 'vitest';
import { POINTS } from '../../shared/cosmetics.ts';
import { createWorld, type Person, type World } from './world.ts';

let w: World;
let ana: Person, beto: Person, caio: Person;
let groupId: string, geral: string, voz: string;

const balance = async (who: Person) => (await w.ok('GET', '/api/me/points', who.token)) as { points: number; earnedToday: number; history: any[] };
const minutes = (count: number) => {
  for (let i = 0; i < count; i++) {
    w.clock.now = new Date(w.clock.now.getTime() + 60_000);
    w.economy.tick();
  }
};

beforeAll(async () => {
  w = await createWorld();
  ana = await w.signup('ana');
  beto = await w.signup('beto');
  caio = await w.signup('caio');
  groupId = await w.group(ana, 'Jogatina');
  await w.join(ana, groupId, beto, caio);
  geral = (await w.channelByName(ana, groupId, 'geral'))!;
  voz = (await w.view(ana, groupId)).channels.find((channel: any) => channel.kind === 'voz').id;
});

describe('ganhar pontos', () => {
  it('começa com zero; entrar no dia dá o bônus uma vez só', async () => {
    expect((await balance(ana)).points).toBe(0);
    await w.ok('POST', '/api/me/active', ana.token);
    await w.ok('POST', '/api/me/active', ana.token);
    expect((await balance(ana)).points).toBe(POINTS.dailyLogin);
  });

  it('a primeira mensagem do dia num grupo vale pontos, uma vez por dia', async () => {
    await w.say(ana, geral, 'oi');
    await w.say(ana, geral, 'de novo');
    await w.economy.idle();
    const now = await balance(ana);
    expect(now.points).toBe(POINTS.dailyLogin + POINTS.dailyMessage);
    expect(now.history.map((entry) => entry.reason)).toEqual(['missao', 'missao']);
  });

  it('chamada com outra pessoa e usando o aplicativo: pontos a cada 5 minutos; sozinho ou parado, nada', async () => {
    const before = (await balance(beto)).points;
    const caioBefore = (await balance(caio)).points;
    await w.hub.setVoice(beto.id, { groupId, channelId: voz });
    await w.hub.setVoice(caio.id, { groupId, channelId: voz });
    await w.ok('POST', '/api/me/active', beto.token);
    // Caio entrou e não mexeu no aplicativo (só o bônus de entrada não vale aqui: ele nunca mandou "ativo").
    minutes(5);
    expect((await balance(beto)).points).toBe(before + POINTS.dailyLogin + POINTS.voicePointsPerBlock);
    expect((await balance(caio)).points).toBe(caioBefore);
    // Parado por mais de 10 minutos: para de contar.
    minutes(15);
    const idle = (await balance(beto)).points;
    minutes(10);
    expect((await balance(beto)).points).toBe(idle);
    // Sozinho no canal (o Caio saiu): não conta, mesmo ativo.
    await w.hub.setVoice(caio.id, null);
    await w.ok('POST', '/api/me/active', beto.token);
    minutes(10);
    expect((await balance(beto)).points).toBe(idle);
    await w.hub.setVoice(beto.id, null);
  });

  it('limite diário da chamada', async () => {
    await w.hub.setVoice(beto.id, { groupId, channelId: voz });
    await w.hub.setVoice(caio.id, { groupId, channelId: voz });
    for (let i = 0; i < 80; i++) {
      await w.ok('POST', '/api/me/active', beto.token);
      minutes(5);
    }
    const history = (await balance(beto)).history.filter((entry) => entry.reason === 'voz');
    const fromVoice = history.reduce((sum: number, entry: any) => sum + entry.delta, 0);
    expect(fromVoice).toBeLessThanOrEqual(POINTS.voiceDailyCap);
    expect(fromVoice).toBeGreaterThan(POINTS.voiceDailyCap - POINTS.voicePointsPerBlock);
    await w.hub.setVoice(beto.id, null);
    await w.hub.setVoice(caio.id, null);
  });
});

describe('loja e inventário', () => {
  it('a loja lista o catálogo; comprar sem saldo é recusado', async () => {
    const shop = (await w.ok('GET', '/api/shop', ana.token)).items as any[];
    expect(shop.find((item) => item.id === 'anel-aurora')).toMatchObject({ price: 150, kind: 'decoracao', owned: false });
    expect((await w.api('POST', '/api/shop/buy', ana.token, { itemId: 'guardiao-cosmico' })).json.error.code).toBe('pontos_insuficientes');
    expect((await w.api('POST', '/api/shop/buy', ana.token, { itemId: 'nao-existe' })).json.error.code).toBe('item_inexistente');
  });

  it('comprar desconta exatamente o preço, uma vez só, mesmo com dois pedidos juntos', async () => {
    await w.economy.earn(ana.id, 400, 'teste', 'saldo de teste', 'teste:1', { ignoreCaps: true });
    const before = (await balance(ana)).points;
    const results = await Promise.all([w.api('POST', '/api/shop/buy', ana.token, { itemId: 'anel-aurora' }), w.api('POST', '/api/shop/buy', ana.token, { itemId: 'anel-aurora' })]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const after = await balance(ana);
    expect(after.points).toBe(before - 150);
    expect(after.history[0]).toMatchObject({ delta: -150, reason: 'compra' });
    const inventory = (await w.ok('GET', '/api/me/inventory', ana.token)) as any;
    expect(inventory.items.map((item: any) => item.id)).toEqual(['anel-aurora']);
  });

  it('equipar só o que tem, no espaço certo e com uma cor que existe; os outros veem', async () => {
    expect((await w.api('PUT', '/api/me/equipped', ana.token, { slot: 'decoracao', itemId: 'chama-solar', variant: 'ouro' })).json.error.code).toBe('item_nao_adquirido');
    expect((await w.api('PUT', '/api/me/equipped', ana.token, { slot: 'moldura', itemId: 'anel-aurora', variant: 'neon' })).json.error.code).toBe('espaco_invalido');
    expect((await w.api('PUT', '/api/me/equipped', ana.token, { slot: 'decoracao', itemId: 'anel-aurora', variant: 'arco-iris' })).json.error.code).toBe('cor_invalida');
    await w.ok('PUT', '/api/me/equipped', ana.token, { slot: 'decoracao', itemId: 'anel-aurora', variant: 'rosa' });
    const seen = (await w.ok('GET', `/api/cosmetics?ids=${ana.id},${beto.id}`, beto.token)).cosmetics;
    expect(seen[ana.id]).toEqual({ decoracao: { item: 'anel-aurora', variant: 'rosa' } });
    expect(seen[beto.id]).toEqual({});
    await w.ok('PUT', '/api/me/equipped', ana.token, { slot: 'decoracao', itemId: null });
    expect((await w.ok('GET', `/api/cosmetics?ids=${ana.id}`, beto.token)).cosmetics[ana.id]).toEqual({});
  });

  it('não existe rota para dar pontos (a de desenvolvimento só liga com variável própria e fora de produção)', async () => {
    expect((await w.api('POST', '/api/dev/points', ana.token, { amount: 1000 })).status).toBe(404);
  });

  it('o saldo nunca fica negativo, nem por um gasto interno', async () => {
    await expect(w.economy.spend(caio.id, 10_000, 'teste', 'gasto alto demais', 'teste:gasto')).rejects.toThrow(/Cosmic Points suficientes/);
    expect((await balance(caio)).points).toBeGreaterThanOrEqual(0);
  });
});
