/**
 * Autenticação com o LiveKit — testes REAIS.
 * Rodam contra um livekit-server de verdade nesta máquina (o mesmo binário de `npm run livekit`, modo --dev,
 * chave "devkey" / segredo "secret"). Se ele não estiver no ar nem instalado em tools/livekit, são pulados.
 * Não usam o LiveKit Cloud: as credenciais de produção ficam só no Render. Para o Cloud, a conferência real
 * é GET /api/health/livekit no serviço publicado.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { loadConfig } from '../src/config.ts';
import { LiveKitSfu } from '../src/sfu.ts';
import { checkSfu } from '../src/sfu-errors.ts';

const HTTP = 'http://127.0.0.1:7880';
const WS = 'ws://127.0.0.1:7880';
const KEY = 'devkey';
const SECRET = 'secret';
const WRONG_SECRET = 'segredo-que-nao-e-o-do-servidor-000000';

const reachable = () => fetch(HTTP, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);

let child: ChildProcess | null = null;
let available = await reachable();
if (!available) {
  const binary = resolve(import.meta.dirname, '../../tools/livekit', process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server');
  if (existsSync(binary)) {
    child = spawn(binary, ['--dev', '--bind', '127.0.0.1'], { stdio: 'ignore' });
    for (let attempt = 0; attempt < 50 && !available; attempt++) {
      await new Promise((done) => setTimeout(done, 200));
      available = await reachable();
    }
  }
}
afterAll(() => void child?.kill());

const sfuWith = (key: string, secret: string) => new LiveKitSfu(loadConfig({ LIVEKIT_URL: WS, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret }));
const validate = (jwt: string) => fetch(`${HTTP}/rtc/validate?access_token=${jwt}`).then((response) => response.status);
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** JWT montado à mão, para controlar `exp` e `nbf` além do que a biblioteca permite. */
function handMadeJwt(secret: string, payload: Record<string, unknown>): string {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
const room = `teste-real-${Date.now().toString(36)}`;

describe.skipIf(!available)('LiveKit de verdade (livekit-server local)', () => {
  const good = () => sfuWith(KEY, SECRET);
  const joinToken = (identity: string, target = room) => good().createToken({ room: target, identity, name: identity, host: false, ttlSeconds: 600 });

  it('par correto: a API administrativa aceita e a sala é criada', async () => {
    expect(await checkSfu(good())).toBeNull();
    await good().ensureRoom(room, 4);
    expect(await good().snapshot(room)).toMatchObject({ exists: true, participants: 0 });
  });

  it('API Key desconhecida é recusada e identificada', async () => {
    expect(await checkSfu(sfuWith('APInaoexiste000', SECRET))).toBe('chave_desconhecida');
  });

  it('API Secret incompatível é recusado e identificado', async () => {
    expect(await checkSfu(sfuWith(KEY, WRONG_SECRET))).toBe('segredo_incorreto');
  });

  it('o token de entrada emitido pelo backend é aceito pelo LiveKit', async () => {
    expect(await validate(await joinToken('u-real-ana'))).toBe(200);
  });

  it('token assinado com outro segredo, ou por outra chave, é recusado', async () => {
    expect(await validate(await sfuWith(KEY, WRONG_SECRET).createToken({ room, identity: 'u-x', name: 'x', host: false, ttlSeconds: 600 }))).toBe(401);
    expect(await validate(await sfuWith('APInaoexiste000', SECRET).createToken({ room, identity: 'u-x', name: 'x', host: false, ttlSeconds: 600 }))).toBe(401);
  });

  it('token expirado é recusado', async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: KEY, sub: 'u-atrasado', nbf: now - 7200, video: { roomJoin: true, room } };
    expect(await validate(handMadeJwt(SECRET, { ...claims, exp: now + 600 }))).toBe(200);
    expect(await validate(handMadeJwt(SECRET, { ...claims, exp: now - 3600 }))).toBe(401);
  });

  it('token sem permissão de entrar em sala é recusado', async () => {
    const token = new AccessToken(KEY, SECRET, { identity: 'u-sem-sala', ttl: 600 });
    token.addGrant({ roomList: true });
    expect(await validate(await token.toJwt())).toBe(401);
  });

  it('várias pessoas entram na mesma sala, e o token de uma sala não abre outra', async () => {
    const identities = ['u-real-ana', 'u-real-bia', 'u-real-caio'];
    const sockets = await Promise.all(identities.map(async (identity) => {
      const socket = new WebSocket(`${WS}/rtc?access_token=${await joinToken(identity)}&auto_subscribe=1&protocol=15&sdk=js&version=2.24.0`);
      socket.binaryType = 'arraybuffer';
      // A primeira mensagem do servidor é a resposta de entrada: a pessoa foi aceita na sala.
      await new Promise<void>((done, fail) => {
        socket.addEventListener('message', () => done(), { once: true });
        socket.addEventListener('error', () => fail(new Error(`${identity} não conseguiu entrar`)), { once: true });
        socket.addEventListener('close', () => fail(new Error(`${identity} foi desconectado na entrada`)), { once: true });
      });
      return socket;
    }));
    try {
      const admin = new RoomServiceClient(HTTP, KEY, SECRET);
      const inside = (await admin.listParticipants(room)).map((participant) => participant.identity).sort();
      expect(inside).toEqual(identities);
      // Sala vizinha continua vazia: cada token só abre a sala para a qual foi emitido.
      expect((await good().snapshot(`${room}-vizinha`)).participants).toBe(0);
    } finally {
      for (const socket of sockets) socket.close();
      await good().closeRoom(room);
    }
  });
});
