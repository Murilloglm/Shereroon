import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createWorld, type Person, type World } from './world.ts';
import { Hub } from '../src/community/hub.ts';

let w: World, a: Person, b: Person, channel: string, voice: string;
beforeAll(async () => {
  w = await createWorld();
  a = await w.signup('entrega_ana'); b = await w.signup('entrega_beto');
  const group = await w.group(a); await w.join(a, group, b);
  channel = (await w.channelByName(a, group, 'geral'))!;
  voice = (await w.channelByName(a, group, 'Sala de voz'))!;
}, 30_000);
afterAll(async () => { await w?.db.close(); });

it('duas contas: retries concorrentes gravam e publicam uma vez, com confirmação durável', async () => {
  const live = await w.connect(b);
  const body = { content: 'única', clientId: 'requisicao-unica-0001' };
  const results = await Promise.all(Array.from({ length: 5 }, () => w.ok('POST', `/api/channels/${channel}/messages`, a.token, body)));
  expect(new Set(results.map(r => r.message.id)).size).toBe(1);
  expect(results[0].message.clientId).toBe(body.clientId);
  expect(live.of('message.created')).toHaveLength(1);
  const retry = await w.ok('POST', `/api/channels/${channel}/messages`, a.token, body);
  expect(retry.message.id).toBe(results[0].message.id);
  expect(live.of('message.created')).toHaveLength(1);
  const changed = await w.api('POST', `/api/channels/${channel}/messages`, a.token, { ...body, content: 'outro conteúdo' });
  expect(changed.status).toBe(409);
  const other = await w.ok('POST', `/api/channels/${channel}/messages`, b.token, body);
  expect(other.message.id).not.toBe(retry.message.id);
  live.close();
});

it('mensagens privadas têm a mesma idempotência e só um evento por destinatário', async () => {
  const { id } = await w.ok('POST', '/api/dms', a.token, { userId: b.id });
  const live = await w.connect(b);
  const body = { content: 'privada única', clientId: 'requisicao-privada-0001' };
  const results = await Promise.all(Array.from({ length: 4 }, () => w.ok('POST', `/api/dms/${id}/messages`, a.token, body)));
  expect(new Set(results.map(r => r.message.id)).size).toBe(1);
  expect(live.of('dm.message')).toHaveLength(1);
  const history = await w.ok('GET', `/api/dms/${id}/messages`, b.token);
  expect(history.messages).toHaveLength(1);
  expect(history.messages[0].clientId).toBe(body.clientId);
  expect((await w.api('POST', `/api/dms/${id}/messages`, a.token, { ...body, content: 'mudou' })).status).toBe(409);
  live.close();
});

it('expõe tempo de API, banco e gravação sem registrar conteúdo nem SQL', async () => {
  const response = await w.app.request(`/api/channels/${channel}/messages`, { method: 'POST', headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json', origin: 'app://shareroom' }, body: JSON.stringify({ content: 'medir', clientId: 'requisicao-medicao-01' }) });
  expect(response.status).toBe(200);
  expect(response.headers.get('server-timing')).toMatch(/auth;dur=.*persist;dur=.*gateway;dur=.*total;dur=.*queries;/);
  expect(response.headers.get('access-control-expose-headers')).toContain('Server-Timing');
  expect(response.headers.get('server-timing')).not.toMatch(/SELECT|medir|Bearer/);
});

it('retries de mensagens da 0.3.4 sem hash devolvem a confirmação original', async () => {
  const input = { content: 'anterior ao upgrade', clientId: 'requisicao-legada-034' };
  const { message } = await w.ok('POST', `/api/channels/${channel}/messages`, a.token, input);
  await w.db.query('UPDATE messages SET client_hash = NULL WHERE id = $1', [message.id]);
  const repeated = await w.ok('POST', `/api/channels/${channel}/messages`, a.token, input);
  expect(repeated.message.id).toBe(message.id);
});

it('reutiliza criação da sala, continua emitindo token e verificando direitos em cada entrada', async () => {
  const ensure = vi.spyOn(w.sfu, 'ensureRoom');
  await w.ok('POST', `/api/channels/${voice}/voice`, a.token, {});
  await w.ok('POST', `/api/channels/${voice}/voice`, b.token, {});
  expect(ensure.mock.calls.filter(([, capacity]) => capacity === 100)).toHaveLength(1);
  expect(w.sfu.voiceTokens.slice(-2).map(t => t.identity)).toEqual([a.id, b.id]);
  ensure.mockRestore();
});

it('salas privadas vinculam foto e conta apenas pela autenticação do servidor', async () => {
  const { invite } = await w.ok('POST', '/api/rooms', a.token, { name: 'Privada', capacity: 4 });
  await w.ok('POST', '/api/rooms/join', a.token, { invite, name: 'Ana', accountId: b.id });
  expect(w.sfu.tokens.at(-1)?.accountId).toBe(a.id);
  await w.ok('POST', '/api/rooms/join', undefined, { invite, name: 'Visitante', accountId: a.id });
  expect(w.sfu.tokens.at(-1)?.accountId).toBeUndefined();
});

it('queda curta do gateway preserva a voz; reconectar cancela a expulsão e logout continua imediato', async () => {
  vi.useFakeTimers();
  try {
    const hub = new Hub(); hub.canSeeChannel = async () => true;
    const dropped = vi.fn(); hub.onVoiceDropped = dropped;
    const transport = { send: () => undefined, close: () => undefined };
    const first = hub.open('ana', ['grupo'], transport);
    await hub.setVoice('ana', { groupId: 'grupo', channelId: 'voz' });
    hub.close(first, 15_000);
    expect(hub.voiceOf('ana')?.channelId).toBe('voz');
    await vi.advanceTimersByTimeAsync(2000);
    const second = hub.open('ana', ['grupo'], transport);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(dropped).not.toHaveBeenCalled();
    hub.close(second, 15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(hub.voiceOf('ana')).toBeNull();
    hub.open('ana', ['grupo'], transport); await hub.setVoice('ana', { groupId: 'grupo', channelId: 'voz' });
    hub.kick('ana'); expect(hub.voiceOf('ana')).toBeNull();
  } finally { vi.useRealTimers(); }
});
