/**
 * Canal de tempo real (WebSocket) dos grupos, em /api/gateway. A primeira mensagem do cliente precisa ser a
 * sessão; só depois disso a conexão passa a receber eventos, e só dos grupos e canais que a pessoa pode ver.
 * O código de sessão vai dentro da conexão, e não no endereço, para não ficar em registros de acesso.
 */
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Accounts } from './auth.ts';
import type { Community } from './core.ts';
import type { Connection } from './hub.ts';

export interface GatewayDeps {
  accounts: Accounts;
  community: Community;
  allowedOrigins: readonly string[];
}

const AUTH_TIMEOUT_MS = 8000;
const HEARTBEAT_MS = 30_000;

export function attachGateway(server: Server, { accounts, community, allowedOrigins }: GatewayDeps): WebSocketServer {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192 });

  const refuse = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (request, socket, head) => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== '/api/gateway') return refuse(socket, '404 Not Found');
    // Navegadores sempre mandam a origem: páginas de outros sites não abrem este canal.
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) return refuse(socket, '403 Forbidden');
    sockets.handleUpgrade(request, socket, head, (ws) => accept(ws));
  });

  function accept(ws: WebSocket): void {
    let connection: Connection | null = null;
    let authenticating = false;
    let alive = true;

    const authTimer = setTimeout(() => {
      if (!connection) ws.close(4401, 'sem autenticação');
    }, AUTH_TIMEOUT_MS);
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);

    ws.on('pong', () => {
      alive = true;
    });
    ws.on('error', () => undefined);
    ws.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      if (connection) community.hub.close(connection);
      connection = null;
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(4400, 'mensagem inválida');
      let message: { t?: unknown; token?: unknown };
      try {
        message = JSON.parse(String(data)) as typeof message;
      } catch {
        return ws.close(4400, 'mensagem inválida');
      }
      if (connection) {
        if (message?.t === 'ping') ws.send('{"t":"pong"}');
        return;
      }
      if (authenticating) return;
      if (message?.t !== 'auth' || typeof message.token !== 'string') return ws.close(4401, 'sem autenticação');
      authenticating = true;
      void (async () => {
        try {
          const user = await accounts.authenticate(message.token as string);
          if (!user) return ws.close(4401, 'sessão inválida');
          const groupIds = await community.groupIdsOf(user.id);
          if (ws.readyState !== ws.OPEN) return;
          clearTimeout(authTimer);
          let delivery = Promise.resolve();
          connection = community.hub.open(user.id, groupIds, {
            send: (text) => {
              if (!user.cosmicAdmin) { if (ws.readyState === ws.OPEN) ws.send(text); return; }
              // A prova pertence a esta sessão. Outra sessão verificada não libera eventos de servidor aqui.
              delivery = delivery.then(async () => {
                const current = await accounts.authenticate(message.token as string);
                if (!current) { ws.close(4403, 'sessão encerrada'); return; }
                const event = JSON.parse(text) as { groupId?: unknown };
                if (current.cosmicAdmin && !current.adminVerified && typeof event.groupId === 'string') return;
                if (ws.readyState === ws.OPEN) ws.send(text);
              }).catch(() => { ws.close(1011, 'erro de autorização'); });
            },
            close: () => ws.close(4403, 'sessão encerrada'),
          });
          ws.send(JSON.stringify({ t: 'ready', userId: user.id }));
        } catch (error) {
          console.error('[gateway]', error);
          ws.close(1011, 'erro interno');
        }
      })();
    });
  }

  return sockets;
}
