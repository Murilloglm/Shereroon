import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { randomBytes, toBase64Url } from './bytes.ts';
import type { BotRuntime } from './bots/runtime.ts';
import type { Accounts } from './community/auth.ts';
import type { Community } from './community/core.ts';
import { mountCommunity } from './community/routes.ts';
import type { Config } from './config.ts';
import { ApiError } from './errors.ts';
import {
  DEFAULT_CAPACITY,
  MAX_CAPACITY,
  MAX_NAME_CHARS,
  MAX_PASSWORD_CHARS,
  MIN_CAPACITY,
  checkPassword,
  decodeInvite,
  encodeInvite,
  hostKey,
  isHostKey,
  isSessionProof,
  newRoomId,
  passwordTag,
  sessionProof,
  sfuRoomName,
  type RoomDescriptor,
} from './invite.ts';
import { RateLimiter } from './ratelimit.ts';
import type { Sfu } from './sfu.ts';
import { checkSfu, sfuError, sfuFailureError, type SfuFailure } from './sfu-errors.ts';
import { Signer } from './signer.ts';

export interface AppDeps {
  config: Config;
  sfu: Sfu;
  /** IP da conexão direta, quando o runtime sabe informar. */
  remoteAddress?: (c: Context) => string | undefined;
  limiter?: RateLimiter;
  /** Contas e grupos. Só existem quando há banco de dados; sem ele, as salas por link seguem funcionando. */
  groups?: { accounts: Accounts; community: Community; bots?: BotRuntime };
}


/** Remove caracteres de controle, junta espaços e corta em MAX_NAME_CHARS (por caractere, não por byte). */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, MAX_NAME_CHARS).join('').trim();
}

function publicRoom(room: RoomDescriptor) {
  return {
    id: toBase64Url(room.id),
    name: room.name,
    capacity: room.capacity,
    hasPassword: room.passwordTag !== null,
  };
}

export function createApp({ config, sfu, remoteAddress, limiter = new RateLimiter(), groups }: AppDeps): Hono {
  const signer = new Signer(config.appSecret);
  const app = new Hono();

  const clientIp = (c: Context): string => {
    if (config.trustProxy) {
      const forwarded = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
    }
    return remoteAddress?.(c) ?? 'desconhecido';
  };

  const readBody = async (c: Context): Promise<Record<string, unknown>> => {
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > 8_192) throw new ApiError(400, 'corpo_grande', 'Requisição grande demais.');
    try {
      const body: unknown = await c.req.json();
      if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
    } catch {
      // cai no erro abaixo
    }
    throw new ApiError(400, 'json_invalido', 'O corpo da requisição precisa ser um objeto JSON.');
  };

  const requireRoom = async (code: unknown): Promise<RoomDescriptor> => {
    const room = await decodeInvite(signer, code);
    if (!room) throw new ApiError(404, 'convite_invalido', 'Este link de convite não é válido.');
    return room;
  };

  const requireHost = async (room: RoomDescriptor, key: unknown): Promise<void> => {
    if (!(await isHostKey(signer, room.id, key))) {
      throw new ApiError(403, 'nao_e_dono', 'Só quem criou a sala pode fazer isso.');
    }
  };

  /** Chamadas ao SFU viram 502 com mensagem clara, em vez de um 500 genérico. */
  const withSfu = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      throw sfuError(error);
    }
  };

  /** Resultado da última conferência das credenciais no LiveKit, reaproveitado por 30 s. */
  let sfuHealth: { at: number; result: Promise<SfuFailure | null> } | null = null;

  app.use(
    '/api/*',
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['content-type', 'authorization'],
      maxAge: 86_400,
    }),
  );

  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'OPTIONS' && !limiter.take(`geral:${clientIp(c)}`, groups ? 600 : 120, 60_000)) {
      throw new ApiError(429, 'muitas_requisicoes', 'Muitas requisições. Espere um minuto e tente de novo.');
    }
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  // O LiveKit aceita as credenciais deste servidor? Serve para conferir a configuração depois de um deploy.
  app.get('/api/health/livekit', async (c) => {
    if (!sfuHealth || Date.now() - sfuHealth.at > 30_000) sfuHealth = { at: Date.now(), result: checkSfu(sfu) };
    const failure = await sfuHealth.result;
    if (!failure) return c.json({ ok: true });
    const error = sfuFailureError(failure);
    return c.json({ ok: false, error: { code: error.code, message: error.message } }, 502);
  });

  app.post('/api/rooms', async (c) => {
    if (!limiter.take(`criar:${clientIp(c)}`, 20, 10 * 60_000)) {
      throw new ApiError(429, 'muitas_salas', 'Você criou salas demais em pouco tempo. Tente de novo em alguns minutos.');
    }
    const body = await readBody(c);

    const name = cleanName(body.name) || 'Sala sem nome';
    const capacity = body.capacity === undefined ? DEFAULT_CAPACITY : Number(body.capacity);
    if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
      throw new ApiError(400, 'lotacao_invalida', `A lotação deve ficar entre ${MIN_CAPACITY} e ${MAX_CAPACITY} pessoas.`);
    }
    let password: string | null = null;
    if (body.password !== undefined && body.password !== null && body.password !== '') {
      if (typeof body.password !== 'string' || Array.from(body.password).length > MAX_PASSWORD_CHARS) {
        throw new ApiError(400, 'senha_invalida', `A senha pode ter no máximo ${MAX_PASSWORD_CHARS} caracteres.`);
      }
      password = body.password;
    }

    const id = newRoomId();
    const room: RoomDescriptor = {
      id,
      name,
      capacity,
      passwordTag: password === null ? null : await passwordTag(signer, id, password),
    };
    return c.json({
      invite: await encodeInvite(signer, room),
      hostKey: await hostKey(signer, id),
      room: publicRoom(room),
    });
  });

  app.post('/api/rooms/info', async (c) => {
    const body = await readBody(c);
    const room = await requireRoom(body.invite);
    return c.json({ room: publicRoom(room) });
  });

  app.post('/api/rooms/join', async (c) => {
    const body = await readBody(c);
    const room = await requireRoom(body.invite);
    const roomName = sfuRoomName(room.id);
    const ip = clientIp(c);

    const name = cleanName(body.name);
    if (!name) throw new ApiError(400, 'nome_obrigatorio', 'Escolha um nome para entrar na sala.');

    const isHost = await isHostKey(signer, room.id, body.hostKey);

    // Sessão anterior: permite voltar com a mesma identidade depois de recarregar ou cair.
    const session = body.session as { identity?: unknown; proof?: unknown } | undefined;
    const returning =
      session !== undefined && session !== null && (await isSessionProof(signer, room.id, session.identity, session.proof));

    // Quem já passou pela senha (dono ou sessão válida) não precisa digitar de novo.
    if (room.passwordTag && !isHost && !returning) {
      const attemptsKey = `senha:${roomName}:${ip}`;
      if (limiter.remaining(attemptsKey, 8, 5 * 60_000) === 0) {
        throw new ApiError(429, 'muitas_tentativas', 'Muitas senhas erradas. Espere alguns minutos antes de tentar de novo.');
      }
      const password = typeof body.password === 'string' ? body.password : '';
      if (!password) throw new ApiError(401, 'senha_necessaria', 'Esta sala pede senha.');
      if (Array.from(password).length > MAX_PASSWORD_CHARS || !(await checkPassword(signer, room, password))) {
        limiter.take(attemptsKey, 8, 5 * 60_000);
        throw new ApiError(401, 'senha_incorreta', 'Senha incorreta.');
      }
    }

    const snapshot = await withSfu(() => sfu.snapshot(roomName));
    const identity = returning ? (session!.identity as string) : `u-${toBase64Url(randomBytes(9))}`;

    if (!isHost) {
      if (snapshot.state.banned.includes(identity)) {
        throw new ApiError(403, 'expulso', 'Você foi removido desta sala pelo dono.');
      }
      if (snapshot.state.locked && !returning) {
        throw new ApiError(403, 'sala_trancada', 'O dono trancou a sala. Ninguém novo pode entrar agora.');
      }
    }

    if (!snapshot.exists) await withSfu(() => sfu.ensureRoom(roomName, room.capacity));

    const token = await sfu.createToken({
      room: roomName,
      identity,
      name,
      host: isHost,
      ttlSeconds: config.tokenTtlSeconds,
    });

    return c.json({
      token,
      url: config.livekitUrl,
      identity,
      proof: await sessionProof(signer, room.id, identity),
      isHost,
      room: publicRoom(room),
    });
  });

  app.post('/api/rooms/kick', async (c) => {
    const body = await readBody(c);
    const room = await requireRoom(body.invite);
    await requireHost(room, body.hostKey);
    const identity = body.identity;
    if (typeof identity !== 'string' || !/^u-[A-Za-z0-9_-]{6,40}$/.test(identity)) {
      throw new ApiError(400, 'identidade_invalida', 'Participante inválido.');
    }
    const roomName = sfuRoomName(room.id);
    await withSfu(async () => {
      const snapshot = await sfu.snapshot(roomName);
      if (snapshot.exists && !snapshot.state.banned.includes(identity)) {
        await sfu.saveState(roomName, { ...snapshot.state, banned: [...snapshot.state.banned, identity] });
      }
      await sfu.removeParticipant(roomName, identity);
    });
    return c.json({ ok: true });
  });

  app.post('/api/rooms/lock', async (c) => {
    const body = await readBody(c);
    const room = await requireRoom(body.invite);
    await requireHost(room, body.hostKey);
    if (typeof body.locked !== 'boolean') {
      throw new ApiError(400, 'valor_invalido', 'Informe "locked" como verdadeiro ou falso.');
    }
    const locked = body.locked;
    const roomName = sfuRoomName(room.id);
    await withSfu(async () => {
      const snapshot = await sfu.snapshot(roomName);
      if (!snapshot.exists) await sfu.ensureRoom(roomName, room.capacity);
      await sfu.saveState(roomName, { ...snapshot.state, locked });
    });
    return c.json({ ok: true, locked });
  });

  app.post('/api/rooms/close', async (c) => {
    const body = await readBody(c);
    const room = await requireRoom(body.invite);
    await requireHost(room, body.hostKey);
    await withSfu(() => sfu.closeRoom(sfuRoomName(room.id)));
    return c.json({ ok: true });
  });

  if (groups) {
    mountCommunity(app, { ...groups, limiter, clientIp });
  } else {
    app.get('/api/features', (c) => c.json({ groups: false }));
    for (const path of ['/api/auth/*', '/api/groups/*', '/api/groups', '/api/channels/*', '/api/roles/*', '/api/messages/*', '/api/files/*', '/api/invites/*', '/api/voice/*', '/api/users/*', '/api/me/*', '/api/media/*', '/api/friends', '/api/friends/*', '/api/blocks', '/api/blocks/*', '/api/dms', '/api/dms/*', '/api/dm-messages/*', '/api/dm-files/*']) {
      app.all(path, () => {
        throw new ApiError(503, 'grupos_indisponiveis', 'Contas e grupos precisam de um banco de dados, que este servidor não tem configurado.');
      });
    }
  }

  app.all('/api/*', () => {
    throw new ApiError(404, 'rota_inexistente', 'Rota não encontrada.');
  });

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error('[api]', error);
    return c.json({ error: { code: 'erro_interno', message: 'Erro interno do servidor.' } }, 500);
  });

  return app;
}
