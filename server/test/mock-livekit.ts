import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TokenVerifier } from 'livekit-server-sdk';

export interface MockLivekit {
  url: string;
  /** Quantas chamadas chegaram (para conferir cache). */
  calls: () => number;
  /** Faz as próximas respostas saírem com este status HTTP (simula pane do LiveKit). */
  failWith: (status: number | null) => void;
  close: () => Promise<void>;
}

/**
 * LiveKit SIMULADO: fala o mesmo protocolo HTTP (Twirp) da API administrativa e confere o JWT de verdade.
 * As respostas de recusa copiam, palavra por palavra, as do servidor real (medidas no livekit-server 1.13 e
 * no LiveKit Cloud): chave desconhecida → 401 "invalid API key"; assinatura errada → 401 "invalid
 * authorization token: token signature is invalid: signature is invalid".
 */
export async function startMockLivekit(keys: Record<string, string>): Promise<MockLivekit> {
  const rooms = new Map<string, { name: string; maxParticipants: number; metadata: string }>();
  let calls = 0;
  let forced: number | null = null;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        calls += 1;
        const deny = (text: string) => res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }).end(text);
        if (forced !== null) return res.writeHead(forced, { 'content-type': 'text/plain' }).end('pane simulada');

        const jwt = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        let issuer: unknown;
        try {
          issuer = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')).iss;
        } catch {
          return deny('invalid authorization token');
        }
        const secret = typeof issuer === 'string' ? keys[issuer] : undefined;
        if (typeof issuer !== 'string' || secret === undefined) return deny('invalid API key');
        try {
          await new TokenVerifier(issuer, secret).verify(jwt);
        } catch {
          return deny('invalid authorization token: token signature is invalid: signature is invalid');
        }

        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { names?: string[]; name?: string; maxParticipants?: number };
        const json = (data: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
        const asRoom = (room: { name: string; maxParticipants: number; metadata: string }) => ({ sid: `RM_${room.name}`, numParticipants: 0, ...room });
        if (req.url === '/twirp/livekit.RoomService/ListRooms') {
          const wanted = body.names ?? [];
          return json({ rooms: [...rooms.values()].filter((room) => wanted.length === 0 || wanted.includes(room.name)).map(asRoom) });
        }
        if (req.url === '/twirp/livekit.RoomService/CreateRoom') {
          const room = { name: body.name ?? '', maxParticipants: body.maxParticipants ?? 0, metadata: '' };
          rooms.set(room.name, room);
          return json(asRoom(room));
        }
        return res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'bad_route', msg: 'rota inexistente' }));
      })();
    });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    calls: () => calls,
    failWith: (status) => {
      forced = status;
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
