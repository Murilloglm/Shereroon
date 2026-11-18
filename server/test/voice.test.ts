// Canais de voz dos grupos e o canal de tempo real por WebSocket.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { DEFAULT_EVERYONE, P } from '../../shared/permissions.ts';
import { voiceRoom } from '../src/community/core.ts';
import { attachGateway } from '../src/community/gateway.ts';
import { FakeSfu } from './fake-sfu.ts';
import { config, createWorld, type Person, type World } from './world.ts';

let w: World;
let dono: Person, mod: Person, mod2: Person, ana: Person, beto: Person;
let groupId: string;
let sala: string, outra: string;
let roles: Record<string, string>;
const live: Record<string, Awaited<ReturnType<World['connect']>>> = {};

const code = async (method: string, path: string, who: Person, body?: unknown) => {
  const result = await w.api(method, path, who.token, body);
  return result.status === 200 ? 'ok' : (result.json.error.code as string);
};
const enter = (who: Person, channel = sala) => w.ok('POST', `/api/channels/${channel}/voice`, who.token, {});
const moderate = (who: Person, target: Person, action: string, extra: object = {}, channel = sala) =>
  code('POST', `/api/channels/${channel}/voice/moderate`, who, { userId: target.id, action, ...extra });
const rights = (who: Person, channel = sala) => w.sfu.publishing.get(FakeSfu.key(voiceRoom(channel), who.id));
const inside = async (channel = sala) => ((await w.view(dono, groupId)).voice[channel] ?? []) as string[];

beforeAll(async () => {
  w = await createWorld();
  [dono, mod, mod2, ana, beto] = (await Promise.all(['dono', 'mod', 'mod2', 'ana', 'beto'].map((name) => w.signup(name)))) as [Person, Person, Person, Person, Person];
  groupId = await w.group(dono, 'Voz');
  await w.join(dono, groupId, mod, mod2, ana, beto);
  roles = Object.fromEntries(((await w.view(dono, groupId)).roles as any[]).map((role) => [role.name, role.id]));
  await w.give(dono, groupId, mod, [roles.Moderador!]);
  await w.give(dono, groupId, mod2, [roles.Moderador!]);
  sala = (await w.channelByName(dono, groupId, 'Sala de voz'))!;
  outra = (await w.ok('POST', `/api/groups/${groupId}/channels`, dono.token, { kind: 'voz', name: 'Outra sala' })).id;
  for (const person of [dono, mod, mod2, ana, beto]) live[person.name] = await w.connect(person);
}, 60_000);

describe('SFU presence confirmation', () => {
  it('repairs a token issued before gateway authentication without admitting an absent identity', async () => {
    const late = await w.signup('latevoice');
    await w.join(dono, groupId, late);
    await enter(late);
    expect(await inside()).not.toContain(late.id);
    const connection = await w.connect(late);
    await w.ok('POST', `/api/channels/${sala}/voice/sync`, late.token, {});
    expect(await inside()).toContain(late.id);
    await w.ok('POST', `/api/channels/${sala}/voice/sync`, late.token, {});
    expect((await inside()).filter(id => id === late.id)).toHaveLength(1);
    await w.ok('POST', '/api/voice/leave', late.token, {});
    await w.ok('POST', `/api/channels/${sala}/voice/sync`, late.token, {});
    expect(await inside()).not.toContain(late.id);
    connection.close();
  });
});

describe('entrar em canal de voz', () => {
  it('o token do SFU sai limitado ao que a pessoa pode publicar naquele canal', async () => {
    const grant = await enter(ana);
    expect(grant).toMatchObject({ identity: ana.id, url: config.livekitUrl, speak: true, stream: true, streamAudio: true, canWatch: true, highQuality: true });
    expect(grant.room).toMatchObject({ id: sala, name: 'Sala de voz' });
    expect(w.sfu.voiceTokens.at(-1)).toMatchObject({ room: voiceRoom(sala), identity: ana.id, publish: { speak: true, stream: true, streamAudio: true } });
    expect(await inside()).toEqual([ana.id]);
    expect(live.dono!.of('voice').at(-1)).toMatchObject({ channelId: sala, userId: ana.id, joined: true });

    // Regra do canal: o Beto ouve, mas não fala nem transmite.
    await w.ok('PUT', `/api/channels/${sala}/overrides/membro/${beto.id}`, dono.token, { allow: '0', deny: (P.SPEAK | P.STREAM).toString() });
    expect(await enter(beto)).toMatchObject({ speak: false, stream: false, streamAudio: false });
    // Pode transmitir, mas sem o som.
    await w.ok('PUT', `/api/channels/${sala}/overrides/membro/${beto.id}`, dono.token, { allow: '0', deny: P.SHARE_AUDIO.toString() });
    expect(rights(beto), 'a mudança vale na hora para quem já está no canal').toEqual({ speak: true, stream: true, streamAudio: false });
    await w.ok('PUT', `/api/channels/${sala}/overrides/membro/${beto.id}`, dono.token, { allow: '0', deny: '0' });
    expect(rights(beto)).toEqual({ speak: true, stream: true, streamAudio: true });
  });

  it('sem a permissão “Conectar” não entra; canal de texto não é de voz', async () => {
    await w.ok('PUT', `/api/channels/${outra}/overrides/membro/${beto.id}`, dono.token, { allow: '0', deny: P.CONNECT.toString() });
    expect(await code('POST', `/api/channels/${outra}/voice`, beto, {})).toBe('sem_permissao');
    await w.ok('PUT', `/api/channels/${outra}/overrides/membro/${beto.id}`, dono.token, { allow: '0', deny: '0' });
    const geral = (await w.channelByName(dono, groupId, 'geral'))!;
    expect(await code('POST', `/api/channels/${geral}/voice`, beto, {})).toBe('nao_e_voz');
  });

  it('limite de pessoas; trocar de canal tira do anterior; sair e cair limpam o estado', async () => {
    await w.ok('PATCH', `/api/channels/${outra}`, dono.token, { userLimit: 1 });
    await enter(ana, outra);
    expect(await inside()).toEqual([beto.id]);
    expect(await inside(outra)).toEqual([ana.id]);
    expect(w.sfu.rooms.get(voiceRoom(sala))!.participants.has(ana.id), 'saiu do canal antigo no SFU').toBe(false);
    expect(await code('POST', `/api/channels/${outra}/voice`, beto, {})).toBe('canal_cheio');
    // Quem pode mover participantes entra mesmo com o canal cheio.
    expect(await code('POST', `/api/channels/${outra}/voice`, mod, {})).toBe('ok');

    await w.ok('POST', '/api/voice/leave', mod.token, {});
    expect(await inside(outra)).toEqual([ana.id]);
    live.ana!.close();
    expect(await inside(outra), 'a conexão caiu: a pessoa sai do canal').toEqual([]);
    expect(w.sfu.rooms.get(voiceRoom(outra))!.participants.has(ana.id)).toBe(false);
    live.ana = await w.connect(ana);
    await w.ok('PATCH', `/api/channels/${outra}`, dono.token, { userLimit: 0 });
  });
});

describe('moderação de voz', () => {
  beforeAll(async () => {
    for (const person of [ana, beto, mod2]) await enter(person);
    w.sfu.publish(voiceRoom(sala), ana.id, [
      { sid: 'mic-ana', source: 'microfone', muted: false },
      { sid: 'tela-ana', source: 'tela', muted: false },
      { sid: 'som-ana', source: 'audio_da_tela', muted: false },
    ]);
  });

  it('exige a permissão, a hierarquia e que o alvo esteja no canal', async () => {
    for (const action of ['mute', 'block', 'stop_stream', 'disconnect']) {
      expect(await moderate(beto, ana, action), `${action} sem permissão`).toBe('sem_permissao');
      expect(await moderate(mod, mod2, action), `${action} em cargo igual`).toBe('hierarquia');
      expect(await moderate(mod, dono, action), `${action} no dono`).toBe('hierarquia');
    }
    expect(await moderate(mod, dono, 'mute')).toBe('hierarquia');
    expect(await moderate(mod, mod, 'mute')).toBe('hierarquia');
    expect(await moderate(dono, mod, 'mute'), 'o mod não está no canal').toBe('fora_do_canal');
    expect(await moderate(mod, ana, 'explodir')).toBe('acao_invalida');
  });

  it('silenciar desliga o microfone no SFU e avisa a pessoa', async () => {
    expect(await moderate(mod, ana, 'mute')).toBe('ok');
    const tracks = await w.sfu.tracksOf(voiceRoom(sala), ana.id);
    expect(tracks!.find((track) => track.source === 'microfone')!.muted).toBe(true);
    expect(tracks!.find((track) => track.source === 'tela')!.muted, 'a tela continua').toBe(false);
    expect(live.ana!.of('voice.muted').at(-1)).toMatchObject({ channelId: sala, by: 'Mod' });
  });

  it('impedir de falar vale até ser desfeito, mesmo saindo e entrando de novo', async () => {
    expect(await moderate(mod, ana, 'block')).toBe('ok');
    expect(rights(ana)).toEqual({ speak: false, stream: true, streamAudio: true });
    expect((await w.sfu.tracksOf(voiceRoom(sala), ana.id))!.map((track) => track.source)).toEqual(['tela', 'audio_da_tela']);
    await w.ok('POST', '/api/voice/leave', ana.token, {});
    expect(await enter(ana)).toMatchObject({ speak: false, stream: true });
    // Vale só naquele canal.
    expect(await enter(ana, outra)).toMatchObject({ speak: true });
    await enter(ana);
    expect(await moderate(mod, ana, 'unblock')).toBe('ok');
    expect(rights(ana)).toEqual({ speak: true, stream: true, streamAudio: true });
  });

  it('encerrar a transmissão derruba a tela e devolve o direito de transmitir depois', async () => {
    w.sfu.publish(voiceRoom(sala), ana.id, [
      { sid: 'mic-ana', source: 'microfone', muted: false },
      { sid: 'tela-ana', source: 'tela', muted: false },
    ]);
    const before = w.sfu.publishingLog.length;
    expect(await moderate(mod, ana, 'stop_stream')).toBe('ok');
    expect(w.sfu.publishingLog.slice(before).map((entry) => entry.rights.stream)).toEqual([false, true]);
    expect((await w.sfu.tracksOf(voiceRoom(sala), ana.id))!.map((track) => track.source)).toEqual(['microfone']);
    expect(live.ana!.of('voice.stream_stopped')).toHaveLength(1);
  });

  it('mover: quem move precisa poder entrar no destino; quem não tem acesso só é movido com concessão explícita', async () => {
    await w.ok('PUT', `/api/channels/${outra}/overrides/cargo/${roles['@everyone']}`, dono.token, { allow: '0', deny: P.CONNECT.toString() });
    expect(await moderate(mod, ana, 'move', { toChannelId: outra }), 'o mod não pode entrar no destino').toBe('sem_permissao');
    expect(await moderate(dono, ana, 'move', { toChannelId: sala })).toBe('destino_invalido');
    // A Ana não pode conectar no destino: mover recusa em vez de passar por cima da permissão em silêncio.
    expect(await moderate(dono, ana, 'move', { toChannelId: outra })).toBe('sem_acesso_destino');
    expect(await inside()).toContain(ana.id);
    expect(await code('POST', `/api/channels/${outra}/voice`, ana, {}), 'nem entrando sozinha').toBe('sem_permissao');

    // Concessão explícita (exige poder mudar permissões do canal): libera a Ana, fica na auditoria e move.
    expect(await moderate(dono, ana, 'move', { toChannelId: outra, grantAccess: true })).toBe('ok');
    expect(await inside()).not.toContain(ana.id);
    expect(w.sfu.rooms.get(voiceRoom(sala))!.participants.has(ana.id)).toBe(false);
    expect(live.ana!.of('voice.move').at(-1)).toMatchObject({ channelId: outra });
    expect(await code('POST', `/api/channels/${outra}/voice`, ana, {}), 'entra porque agora tem acesso').toBe('ok');
    const audit = (await w.ok('GET', `/api/groups/${groupId}/audit`, dono.token)).entries as { action: string; detail: Record<string, unknown> }[];
    expect(audit.find((entry) => entry.action === 'canal.acesso_concedido')?.detail).toMatchObject({ motivo: 'mover para a chamada' });
    await w.ok('POST', '/api/voice/leave', ana.token, {});
    await w.ok('PUT', `/api/channels/${outra}/overrides/membro/${ana.id}`, dono.token, { allow: '0', deny: '0' });
    expect(await code('POST', `/api/channels/${outra}/voice`, ana, {}), 'tirando a liberação, volta a não entrar').toBe('sem_permissao');
    await w.ok('PUT', `/api/channels/${outra}/overrides/cargo/${roles['@everyone']}`, dono.token, { allow: '0', deny: '0' });

    await enter(ana);
    expect(await moderate(mod, ana, 'disconnect')).toBe('ok');
    expect(await inside()).not.toContain(ana.id);
    expect(live.ana!.of('voice.disconnected')).toHaveLength(1);
  });

  it('mudança de cargo, castigo ou perda de acesso valem na hora para quem está no canal', async () => {
    await enter(ana);
    await w.ok('PATCH', `/api/roles/${roles['@everyone']}`, dono.token, { permissions: (DEFAULT_EVERYONE & ~P.STREAM).toString() });
    expect(rights(ana)).toEqual({ speak: true, stream: false, streamAudio: false });
    expect(rights(mod2), 'o moderador tem a permissão pelo próprio cargo').toEqual({ speak: true, stream: true, streamAudio: true });
    await w.ok('PATCH', `/api/roles/${roles['@everyone']}`, dono.token, { permissions: DEFAULT_EVERYONE.toString() });

    await w.ok('POST', `/api/groups/${groupId}/members/${ana.id}/timeout`, dono.token, { minutes: 5 });
    expect(rights(ana)).toEqual({ speak: false, stream: false, streamAudio: false });
    await w.ok('POST', `/api/groups/${groupId}/members/${ana.id}/timeout`, dono.token, { minutes: 0 });
    expect(rights(ana)).toEqual({ speak: true, stream: true, streamAudio: true });

    await w.ok('PUT', `/api/channels/${sala}/overrides/membro/${ana.id}`, dono.token, { allow: '0', deny: P.CONNECT.toString() });
    expect(await inside(), 'perdeu o acesso: é tirada do canal').not.toContain(ana.id);
    expect(w.sfu.rooms.get(voiceRoom(sala))!.participants.has(ana.id)).toBe(false);
    await w.ok('PUT', `/api/channels/${sala}/overrides/membro/${ana.id}`, dono.token, { allow: '0', deny: '0' });

    await enter(beto);
    await w.ok('POST', `/api/groups/${groupId}/members/${beto.id}/kick`, dono.token, {});
    expect(await inside(), 'expulso do grupo sai da voz').not.toContain(beto.id);
    const actions = ((await w.ok('GET', `/api/groups/${groupId}/audit`, dono.token)).entries as any[]).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['voz.silenciado', 'voz.fala_bloqueada', 'voz.fala_liberada', 'voz.transmissao_encerrada', 'voz.movido', 'voz.desconectado']));
  });

  it('SFU fora do ar vira um erro claro, não um erro interno', async () => {
    w.sfu.failNext = true;
    const result = await w.api('POST', `/api/channels/${outra}/voice`, dono.token, {});
    expect(result.status).toBe(502);
    expect(result.json.error.code).toBe('sfu_indisponivel');
  });
});

describe('WebSocket de verdade', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = serve({ fetch: w.app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
    await new Promise((done) => server.once('listening', done));
    attachGateway(server, { accounts: w.accounts, community: w.community, allowedOrigins: config.allowedOrigins });
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/gateway`;
  });

  afterAll(
    () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );

  const open = (origin: string | null, path = url) =>
    new Promise<{ socket: WebSocket; messages: any[]; closed: Promise<number> }>((resolve) => {
      const socket = new WebSocket(path, origin ? { headers: { origin } } : undefined);
      const messages: any[] = [];
      const closed = new Promise<number>((done) => {
        socket.on('close', (code) => done(code));
        socket.on('unexpected-response', (_request, response) => done(response.statusCode ?? 0));
      });
      socket.on('message', (data) => messages.push(JSON.parse(String(data))));
      socket.on('error', () => undefined);
      socket.on('open', () => resolve({ socket, messages, closed }));
      void closed.then(() => resolve({ socket, messages, closed }));
    });
  const until = async (check: () => boolean) => {
    for (let attempt = 0; attempt < 100 && !check(); attempt++) await new Promise((done) => setTimeout(done, 20));
    expect(check()).toBe(true);
  };

  it('recusa outra origem, outro caminho, sessão inválida e mensagem que não é a sessão', async () => {
    expect(await (await open('https://site-desconhecido.example')).closed).toBe(403);
    expect(await (await open('https://fulano.github.io', url.replace('/api/gateway', '/api/outro'))).closed).toBe(404);
    const bad = await open('https://fulano.github.io');
    bad.socket.send(JSON.stringify({ t: 'auth', token: 'um-codigo-inventado-qualquer-000000' }));
    expect(await bad.closed).toBe(4401);
    const rude = await open('https://fulano.github.io');
    rude.socket.send(JSON.stringify({ t: 'ping' }));
    expect(await rude.closed).toBe(4401);
    const garbage = await open('https://fulano.github.io');
    garbage.socket.send('isto não é JSON');
    expect(await garbage.closed).toBe(4400);
    expect(garbage.messages).toEqual([]);
  });

  it('com a sessão certa recebe as mensagens do grupo em tempo real e aparece online', async () => {
    const novo = await w.signup('websocket');
    await w.join(dono, groupId, novo);
    const client = await open('https://fulano.github.io');
    client.socket.send(JSON.stringify({ t: 'auth', token: novo.token }));
    await until(() => client.messages.some((message) => message.t === 'ready'));
    expect(client.messages.find((message) => message.t === 'ready')).toEqual({ t: 'ready', userId: novo.id });
    expect((await w.view(dono, groupId)).members.find((member: any) => member.userId === novo.id).online).toBe(true);

    const geral = (await w.channelByName(dono, groupId, 'geral'))!;
    const sent = (await w.ok('POST', `/api/channels/${geral}/messages`, dono.token, { content: 'chegou?' })).message;
    await until(() => client.messages.some((message) => message.t === 'message.created'));
    expect(client.messages.find((message) => message.t === 'message.created').message).toMatchObject({ id: sent.id, content: 'chegou?' });

    // Encerrar todas as sessões derruba a conexão aberta.
    await w.ok('POST', '/api/auth/logout-all', novo.token, {});
    expect(await client.closed).toBe(4403);
    await until(() => (w.hub.isOnline(novo.id) === false));
  });
});
