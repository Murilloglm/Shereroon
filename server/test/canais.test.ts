// Convites que se veem sem conta, canais de voz privados escolhendo quem entra e o chat temporário da chamada.
import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type Person, type World } from './world.ts';

let w: World;
let dono: Person, ana: Person, beto: Person, caio: Person;
let groupId: string;

const code = async (method: string, path: string, who: Person | null, body?: unknown) => {
  const result = await w.api(method, path, who?.token ?? null, body);
  return result.status === 200 ? 'ok' : (result.json.error.code as string);
};

beforeAll(async () => {
  w = await createWorld();
  [dono, ana, beto, caio] = (await Promise.all(['dono', 'ana', 'beto', 'caio'].map((name) => w.signup(name)))) as [Person, Person, Person, Person];
  groupId = await w.group(dono, 'Os Amigos', { description: 'Jogos e conversa' });
  await w.join(dono, groupId, ana, beto, caio);
});

describe('convites', () => {
  it('quem ainda não tem conta vê o grupo, a validade e os usos (e nada além disso)', async () => {
    const { invite } = await w.ok('POST', `/api/groups/${groupId}/invites`, dono.token, { maxUses: 5, expiresInHours: 24 });
    const preview = await w.ok('GET', `/api/invites/${invite.code}`, null);
    expect(preview.group).toMatchObject({ name: 'Os Amigos', description: 'Jogos e conversa', memberCount: 4 });
    expect(preview.joined).toBe(false);
    expect(preview.invite).toMatchObject({ maxUses: 5, uses: 0 });
    expect(new Date(preview.invite.expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(Object.keys(preview.group).sort()).toEqual(['description', 'icon', 'id', 'memberCount', 'name']);
    // Com conta, diz se a pessoa já é do grupo.
    expect((await w.ok('GET', `/api/invites/${invite.code}`, ana.token)).joined).toBe(true);
  });

  it('convite revogado ou inexistente é recusado', async () => {
    const { invite } = await w.ok('POST', `/api/groups/${groupId}/invites`, dono.token, {});
    await w.ok('DELETE', `/api/invites/${invite.code}`, dono.token);
    expect(await code('GET', `/api/invites/${invite.code}`, null)).toBe('convite_invalido');
    expect(await code('GET', '/api/invites/naoexiste123', null)).toBe('convite_invalido');
  });
});

describe('canal de voz privado', () => {
  let privado: string;

  it('só quem foi escolhido vê e entra; os outros nem enxergam', async () => {
    privado = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'voz', name: 'Call Privada', private: true, allowMembers: [ana.id, beto.id], userLimit: 3 })).id;
    const sees = async (who: Person) => ((await w.view(who, groupId)).channels as { id: string }[]).some((channel) => channel.id === privado);
    expect(await sees(dono)).toBe(true);
    expect(await sees(ana)).toBe(true);
    expect(await sees(beto)).toBe(true);
    expect(await sees(caio)).toBe(false);
    expect(await code('POST', `/api/channels/${privado}/voice`, ana, {})).toBe('ok');
    expect(await code('POST', `/api/channels/${privado}/voice`, caio, {})).not.toBe('ok');
    await w.ok('POST', '/api/voice/leave', ana.token, {});
  });

  it('ids de fora do grupo são ignorados na criação', async () => {
    const estranho = await w.signup('estranho');
    const id = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'voz', name: 'Outra privada', private: true, allowMembers: [estranho.id, 'inventado'] })).id;
    const audit = (await w.ok('GET', `/api/groups/${groupId}/audit`, dono.token)).entries as { action: string; targetId: string; detail: Record<string, unknown> }[];
    const created = audit.find((entry) => entry.action === 'canal.criado' && entry.targetId === id);
    expect(created?.detail.pessoas).toBeUndefined();
  });
});

describe('chat do canal de voz', () => {
  it('mensagens ficam guardadas; com chat temporário, somem quando o último sai', async () => {
    const fixa = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'voz', name: 'Fixa' })).id;
    const temp = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'voz', name: 'Rápida', temporaryChat: true })).id;
    const live = await w.connect(ana);
    for (const channel of [fixa, temp]) {
      await w.ok('POST', `/api/channels/${channel}/voice`, ana.token, {});
      await w.ok('POST', `/api/channels/${channel}/messages`, ana.token, { content: `oi em ${channel === temp ? 'temporário' : 'fixo'}` });
      await w.ok('POST', '/api/voice/leave', ana.token, {});
    }
    // O hub só registra a presença de quem tem conexão de tempo real; a saída esvazia o canal.
    await new Promise((done) => setTimeout(done, 50));
    expect(await w.texts(dono, fixa)).toEqual(['oi em fixo']);
    expect(await w.texts(dono, temp)).toEqual([]);
    expect(live.of('channel.cleared').map((event) => event.channelId)).toContain(temp);
    live.close();
  });

  it('não lidas também contam no chat de voz', async () => {
    const sala = (await w.channelByName(dono, groupId, 'Sala de voz'))!;
    await w.ok('POST', `/api/channels/${sala}/messages`, beto.token, { content: 'alguém na call?' });
    const unread = (await w.view(caio, groupId)).unread[sala];
    expect(Number(unread.last)).toBeGreaterThan(Number(unread.read ?? 0));
    expect(unread.count).toBe(1);
    // Quem escreveu não tem a própria mensagem como nova.
    expect((await w.view(beto, groupId)).unread[sala].count).toBe(0);
  });
});
