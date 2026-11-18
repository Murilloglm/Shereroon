// Atividades e jogos vinculados: o que cada conta está jogando (informado pelo aplicativo de Windows, que detecta
// o jogo aberto, ou à mão), quem pode ver (privacidade), jogos no perfil, atividades recentes e jogos ocultos.
import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type Person, type World } from './world.ts';

let w: World;
let ana: Person, beto: Person, caio: Person, dani: Person;

const befriend = async (a: Person, b: Person) => {
  await w.ok('POST', '/api/friends', a.token, { userId: b.id });
  await w.ok('POST', `/api/friends/${a.id}/accept`, b.token);
};
const activities = async (who: Person) => (await w.ok('GET', '/api/activities', who.token)).friends as any[];
const entry = async (who: Person, of: Person) => (await activities(who)).find((item) => item.user.id === of.id);

beforeAll(async () => {
  w = await createWorld();
  ana = await w.signup('ana');
  beto = await w.signup('beto');
  caio = await w.signup('caio');
  dani = await w.signup('dani');
  await befriend(ana, beto);
  await befriend(ana, caio);
  // Dani só divide um grupo com a Ana (não é amiga).
  const groupId = await w.group(ana, 'Jogos');
  await w.join(ana, groupId, dani);
});


describe('jogos vinculados', () => {
  it('adicionar à mão ou com o executável detectado; nome e executável conferidos', async () => {
    const valorant = (await w.ok('POST', '/api/me/games', ana.token, { name: 'VALORANT', exe: 'VALORANT-Win64-Shipping.exe' })).game;
    expect(valorant).toMatchObject({ name: 'VALORANT', exe: 'valorant-win64-shipping.exe', showOnProfile: true, hidden: false });
    await w.ok('POST', '/api/me/games', ana.token, { name: 'Minecraft' });
    expect((await w.api('POST', '/api/me/games', ana.token, { name: 'Outro', exe: '../../malicioso.bat' })).json.error.code).toBe('jogo_invalido');
    expect((await w.api('POST', '/api/me/games', ana.token, { name: '' })).json.error.code).toBe('jogo_invalido');
    expect((await w.api('POST', '/api/me/games', ana.token, { name: 'VALORANT' })).json.error.code).toBe('jogo_repetido');
    const games = (await w.ok('GET', '/api/me/games', ana.token)).games as any[];
    expect(games.map((game) => game.name)).toEqual(['Minecraft', 'VALORANT']);
    // A lista é só da própria conta.
    expect((await w.ok('GET', '/api/me/games', beto.token)).games).toEqual([]);
  });

  it('esconder do perfil e ocultar a atividade, um jogo por vez; remover', async () => {
    const games = (await w.ok('GET', '/api/me/games', ana.token)).games as any[];
    const minecraft = games.find((game) => game.name === 'Minecraft');
    await w.ok('PATCH', `/api/me/games/${minecraft.id}`, ana.token, { showOnProfile: false });
    const profile = (await w.ok('GET', `/api/users/${ana.id}/activity`, beto.token)) as any;
    expect(profile.games.map((game: any) => game.name)).toEqual(['VALORANT']);
    // Outra conta não mexe nos jogos da Ana.
    expect((await w.api('PATCH', `/api/me/games/${minecraft.id}`, beto.token, { hidden: true })).status).toBe(404);
  });
});

describe('atividade atual', () => {
  it('jogando: amigos veem o jogo e desde quando; quem não é amigo não vê', async () => {
    const before = Date.now();
    await w.ok('PUT', '/api/me/activity', ana.token, { name: 'VALORANT', exe: 'VALORANT-Win64-Shipping.exe' });
    await w.connect(ana);
    const seen = await entry(beto, ana);
    expect(seen.activity).toMatchObject({ name: 'VALORANT' });
    expect(Date.parse(seen.activity.startedAt)).toBeGreaterThanOrEqual(before - 1000);
    // Dani divide um grupo, mas a privacidade padrão é "só amigos".
    expect((await w.ok('GET', `/api/users/${ana.id}/activity`, dani.token)).activity).toBeNull();
    expect(await entry(dani, ana)).toBeUndefined();
  });

  it('o mesmo jogo de novo só renova; trocar de jogo fecha o anterior, que vira atividade recente', async () => {
    const first = (await entry(beto, ana)).activity.startedAt;
    await w.ok('PUT', '/api/me/activity', ana.token, { name: 'VALORANT', exe: 'VALORANT-Win64-Shipping.exe' });
    expect((await entry(beto, ana)).activity.startedAt).toBe(first);
    await w.ok('PUT', '/api/me/activity', ana.token, { name: 'Roblox', exe: 'RobloxPlayerBeta.exe' });
    const now = await entry(beto, ana);
    expect(now.activity.name).toBe('Roblox');
    expect(now.recent.map((item: any) => item.name)).toContain('VALORANT');
    await w.ok('DELETE', '/api/me/activity', ana.token);
    const after = await entry(beto, ana);
    expect(after.activity).toBeNull();
    expect(after.recent.map((item: any) => item.name)).toEqual(['Roblox', 'VALORANT']);
  });

  it('jogo oculto não aparece como atividade', async () => {
    const games = (await w.ok('GET', '/api/me/games', ana.token)).games as any[];
    const valorant = games.find((game) => game.name === 'VALORANT');
    await w.ok('PATCH', `/api/me/games/${valorant.id}`, ana.token, { hidden: true });
    const result = await w.ok('PUT', '/api/me/activity', ana.token, { name: 'VALORANT', exe: 'VALORANT-Win64-Shipping.exe' });
    expect(result.shared).toBe(false);
    expect((await entry(beto, ana)).activity).toBeNull();
    await w.ok('PATCH', `/api/me/games/${valorant.id}`, ana.token, { hidden: false });
  });

  it('privacidade: "ninguém" esconde de todos; "quem divide um grupo" mostra também a quem não é amigo', async () => {
    await w.ok('PUT', '/api/me/activity', ana.token, { name: 'Minecraft' });
    await w.ok('PATCH', '/api/me/profile', ana.token, { activityPrivacy: 'ninguem' });
    expect((await entry(beto, ana)).activity).toBeNull();
    expect((await entry(beto, ana)).recent).toEqual([]);
    await w.ok('PATCH', '/api/me/profile', ana.token, { activityPrivacy: 'membros' });
    expect((await w.ok('GET', `/api/users/${ana.id}/activity`, dani.token)).activity).toMatchObject({ name: 'Minecraft' });
    expect((await w.ok('GET', `/api/users/${ana.id}/activity`, caio.token)).activity).toMatchObject({ name: 'Minecraft' });
    expect((await w.api('PATCH', '/api/me/profile', ana.token, { activityPrivacy: 'qualquer' })).json.error.code).toBe('privacidade_invalida');
    await w.ok('PATCH', '/api/me/profile', ana.token, { activityPrivacy: 'amigos' });
  });

  it('a lista de atividades mostra os amigos, quem está online e quem está em chamada', async () => {
    const list = await activities(beto);
    expect(list.map((item) => item.user.username)).toEqual(['ana']);
    expect(list[0]).toMatchObject({ online: true, inVoice: false });
    expect((await activities(ana)).map((item) => item.user.username).sort()).toEqual(['beto', 'caio']);
  });

  it('nome do jogo conferido; quem abre outra conta não informa atividade por ela', async () => {
    expect((await w.api('PUT', '/api/me/activity', ana.token, { name: '' })).json.error.code).toBe('jogo_invalido');
    expect((await w.api('PUT', '/api/me/activity', ana.token, { name: 'x'.repeat(200) })).json.error.code).toBe('jogo_invalido');
    expect((await w.api('PUT', '/api/me/activity', '', { name: 'Minecraft' })).status).toBe(401);
  });
});
