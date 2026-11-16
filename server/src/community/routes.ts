/**
 * Rotas HTTP dos grupos. Aqui só há tradução: ler a requisição, descobrir quem é a pessoa pela sessão e
 * chamar o serviço (core.ts), que é quem aplica as permissões.
 */
import type { Context, Hono } from 'hono';
import { ApiError } from '../errors.ts';
import type { RateLimiter } from '../ratelimit.ts';
import type { BotRuntime } from '../bots/runtime.ts';
import type { Accounts, User } from './auth.ts';
import type { Community } from './core.ts';

export interface CommunityDeps {
  accounts: Accounts;
  community: Community;
  /** Central de Bots. Sem ela, as rotas de bots não existem. */
  bots?: BotRuntime;
  limiter: RateLimiter;
  clientIp: (c: Context) => string;
}

const SMALL = 8_192;
const MESSAGE = 24_000;
const WITH_ICON = 200_000;

export function mountCommunity(app: Hono, { accounts, community, bots, limiter, clientIp }: CommunityDeps): void {
  const body = async (c: Context, maxBytes = SMALL): Promise<Record<string, unknown>> => {
    if (Number(c.req.header('content-length') ?? 0) > maxBytes) throw new ApiError(413, 'corpo_grande', 'Requisição grande demais.');
    let text: string;
    try {
      text = await c.req.text();
    } catch {
      throw new ApiError(400, 'json_invalido', 'O corpo da requisição precisa ser um objeto JSON.');
    }
    if (text.length > maxBytes) throw new ApiError(413, 'corpo_grande', 'Requisição grande demais.');
    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // cai no erro abaixo
    }
    throw new ApiError(400, 'json_invalido', 'O corpo da requisição precisa ser um objeto JSON.');
  };

  const tokenOf = (c: Context): string | null => {
    const header = c.req.header('authorization') ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  };

  const who = async (c: Context): Promise<User> => {
    const user = await accounts.authenticate(tokenOf(c));
    if (!user) throw new ApiError(401, 'sessao_invalida', 'Sua sessão terminou. Entre de novo.');
    return user;
  };

  const id = (c: Context, name: string): string => {
    const value = c.req.param(name) ?? '';
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(value)) throw new ApiError(404, 'rota_inexistente', 'Rota não encontrada.');
    return value;
  };

  /** Corpo binário (arquivo), lido aos pedaços para parar assim que passar do limite. */
  const bytes = async (c: Context, maxBytes: number): Promise<Uint8Array> => {
    if (Number(c.req.header('content-length') ?? 0) > maxBytes) throw community.fileTooBig();
    const reader = c.req.raw.body?.getReader();
    if (!reader) return new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw community.fileTooBig();
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return all;
  };

  app.get('/api/features', (c) => c.json({ groups: true, maxFileBytes: community.limits.fileBytes }));

  // --- Contas ---------------------------------------------------------------------------

  app.post('/api/auth/register', async (c) => {
    if (!limiter.take(`registro:${clientIp(c)}`, 10, 60 * 60_000)) {
      throw new ApiError(429, 'muitas_contas', 'Muitas contas criadas a partir deste endereço. Tente de novo mais tarde.');
    }
    const input = await body(c);
    return c.json(await accounts.register({ username: input.username, displayName: input.displayName, password: input.password }));
  });

  app.post('/api/auth/login', async (c) => {
    const input = await body(c);
    const account = typeof input.username === 'string' ? input.username.trim().toLowerCase().slice(0, 40) : '';
    // Limite por endereço e por conta: chutar senhas fica lento dos dois jeitos.
    if (!limiter.take(`login:${clientIp(c)}`, 20, 10 * 60_000) || !limiter.take(`login-conta:${account}`, 10, 10 * 60_000)) {
      throw new ApiError(429, 'muitas_tentativas', 'Muitas tentativas de entrar. Espere alguns minutos.');
    }
    return c.json(await accounts.login({ username: input.username, password: input.password }));
  });

  app.post('/api/auth/logout', async (c) => {
    const token = tokenOf(c);
    if (token) await accounts.logout(token);
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout-all', async (c) => {
    const user = await who(c);
    await accounts.logoutEverywhere(user.id);
    community.hub.kick(user.id);
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', async (c) => c.json({ user: await who(c) }));

  app.patch('/api/auth/me', async (c) => {
    const user = await who(c);
    const input = await body(c);
    return c.json({ user: await accounts.updateProfile(user.id, input.displayName) });
  });

  app.post('/api/auth/password', async (c) => {
    const user = await who(c);
    if (!limiter.take(`senha:${user.id}`, 8, 10 * 60_000)) throw new ApiError(429, 'muitas_tentativas', 'Muitas tentativas. Espere alguns minutos.');
    const input = await body(c);
    const token = await accounts.changePassword(user.id, input.current, input.next);
    community.hub.kick(user.id);
    return c.json({ token });
  });

  // --- Grupos ---------------------------------------------------------------------------

  app.get('/api/groups', async (c) => c.json({ groups: await community.myGroups(await who(c)) }));
  app.get('/api/groups/public', async (c) => c.json({ groups: await community.publicGroups(await who(c), c.req.query('q') ?? '') }));

  app.post('/api/groups', async (c) => {
    const user = await who(c);
    if (!limiter.take(`criar-grupo:${user.id}`, 10, 60 * 60_000)) throw new ApiError(429, 'muitos_grupos', 'Você criou grupos demais em pouco tempo.');
    return c.json({ group: await community.createGroup(user, await body(c, WITH_ICON)) });
  });

  app.get('/api/groups/:groupId', async (c) => c.json(await community.viewGroup(await who(c), id(c, 'groupId'))));
  app.patch('/api/groups/:groupId', async (c) => c.json({ group: await community.updateGroup(await who(c), id(c, 'groupId'), await body(c, WITH_ICON)) }));

  app.delete('/api/groups/:groupId', async (c) => {
    await community.deleteGroup(await who(c), id(c, 'groupId'));
    return c.json({ ok: true });
  });

  app.post('/api/groups/:groupId/join', async (c) => c.json({ group: await community.joinPublic(await who(c), id(c, 'groupId')) }));

  app.post('/api/groups/:groupId/leave', async (c) => {
    await community.leave(await who(c), id(c, 'groupId'));
    return c.json({ ok: true });
  });

  app.post('/api/groups/:groupId/transfer', async (c) => {
    const user = await who(c);
    await community.transferOwnership(user, id(c, 'groupId'), (await body(c)).userId);
    return c.json({ ok: true });
  });

  app.get('/api/groups/:groupId/audit', async (c) => c.json({ entries: await community.auditLog(await who(c), id(c, 'groupId'), c.req.query('before')) }));

  // --- Convites -------------------------------------------------------------------------

  app.get('/api/groups/:groupId/invites', async (c) => c.json({ invites: await community.listInvites(await who(c), id(c, 'groupId')) }));
  app.post('/api/groups/:groupId/invites', async (c) => c.json({ invite: await community.createInvite(await who(c), id(c, 'groupId'), await body(c)) }));
  app.get('/api/invites/:code', async (c) => c.json(await community.previewInvite(await who(c), id(c, 'code'))));
  app.post('/api/invites/:code/accept', async (c) => {
    const user = await who(c);
    if (!limiter.take(`convite:${user.id}`, 30, 10 * 60_000)) throw new ApiError(429, 'muitas_tentativas', 'Muitas tentativas. Espere alguns minutos.');
    return c.json({ group: await community.acceptInvite(user, id(c, 'code')) });
  });
  app.delete('/api/invites/:code', async (c) => {
    await community.revokeInvite(await who(c), id(c, 'code'));
    return c.json({ ok: true });
  });

  // --- Membros --------------------------------------------------------------------------

  app.patch('/api/groups/:groupId/members/:userId', async (c) => {
    const user = await who(c);
    const groupId = id(c, 'groupId');
    const targetId = id(c, 'userId');
    const input = await body(c);
    if (input.nickname !== undefined) {
      if (targetId !== user.id) throw new ApiError(403, 'so_o_proprio', 'Cada pessoa escolhe o próprio apelido.');
      await community.setNickname(user, groupId, input.nickname);
    }
    if (input.roleIds !== undefined) await community.setMemberRoles(user, groupId, targetId, input.roleIds);
    return c.json({ ok: true });
  });

  app.get('/api/groups/:groupId/members/:userId/permissions', async (c) =>
    c.json(await community.effectivePermissions(await who(c), id(c, 'groupId'), id(c, 'userId'))),
  );

  app.post('/api/groups/:groupId/members/:userId/kick', async (c) => {
    await community.kick(await who(c), id(c, 'groupId'), id(c, 'userId'), (await body(c)).reason);
    return c.json({ ok: true });
  });

  app.post('/api/groups/:groupId/members/:userId/ban', async (c) => {
    await community.ban(await who(c), id(c, 'groupId'), id(c, 'userId'), (await body(c)).reason);
    return c.json({ ok: true });
  });

  app.post('/api/groups/:groupId/members/:userId/timeout', async (c) => {
    await community.timeout(await who(c), id(c, 'groupId'), id(c, 'userId'), (await body(c)).minutes);
    return c.json({ ok: true });
  });

  app.get('/api/groups/:groupId/bans', async (c) => c.json({ bans: await community.listBans(await who(c), id(c, 'groupId')) }));
  app.delete('/api/groups/:groupId/bans/:userId', async (c) => {
    await community.unban(await who(c), id(c, 'groupId'), id(c, 'userId'));
    return c.json({ ok: true });
  });

  // --- Cargos ---------------------------------------------------------------------------

  app.post('/api/groups/:groupId/roles', async (c) => c.json({ id: await community.createRole(await who(c), id(c, 'groupId'), await body(c)) }));

  app.put('/api/groups/:groupId/roles/order', async (c) => {
    await community.reorderRoles(await who(c), id(c, 'groupId'), (await body(c, 32_000)).order);
    return c.json({ ok: true });
  });

  app.patch('/api/roles/:roleId', async (c) => {
    await community.updateRole(await who(c), id(c, 'roleId'), await body(c));
    return c.json({ ok: true });
  });

  app.delete('/api/roles/:roleId', async (c) => {
    await community.deleteRole(await who(c), id(c, 'roleId'));
    return c.json({ ok: true });
  });

  // --- Canais ---------------------------------------------------------------------------

  app.post('/api/groups/:groupId/channels', async (c) => c.json({ id: await community.createChannel(await who(c), id(c, 'groupId'), await body(c)) }));

  app.put('/api/groups/:groupId/channels/order', async (c) => {
    await community.reorderChannels(await who(c), id(c, 'groupId'), (await body(c, 64_000)).items);
    return c.json({ ok: true });
  });

  app.patch('/api/channels/:channelId', async (c) => {
    await community.updateChannel(await who(c), id(c, 'channelId'), await body(c));
    return c.json({ ok: true });
  });

  app.delete('/api/channels/:channelId', async (c) => {
    await community.deleteChannel(await who(c), id(c, 'channelId'));
    return c.json({ ok: true });
  });

  app.get('/api/channels/:channelId/overrides', async (c) => c.json({ overrides: await community.listOverrides(await who(c), id(c, 'channelId')) }));

  app.put('/api/channels/:channelId/overrides/:kind/:targetId', async (c) => {
    await community.setOverride(await who(c), id(c, 'channelId'), c.req.param('kind'), id(c, 'targetId'), await body(c));
    return c.json({ ok: true });
  });

  // --- Mensagens ------------------------------------------------------------------------

  app.get('/api/channels/:channelId/messages', async (c) =>
    c.json({
      messages: await community.listMessages(await who(c), id(c, 'channelId'), {
        before: c.req.query('before'),
        limit: c.req.query('limit'),
        pinned: c.req.query('pinned') === '1',
      }),
    }),
  );

  app.post('/api/channels/:channelId/messages', async (c) => {
    const user = await who(c);
    const input = await body(c, MESSAGE);
    return c.json({ message: await community.sendMessage(user, id(c, 'channelId'), input.content, { replyTo: input.replyTo, attachments: input.attachments }) });
  });

  app.post('/api/channels/:channelId/read', async (c) => {
    await community.markRead(await who(c), id(c, 'channelId'), (await body(c)).messageId);
    return c.json({ ok: true });
  });

  // O arquivo sobe antes da mensagem e é anexado quando ela é enviada.
  app.post('/api/channels/:channelId/files', async (c) => {
    const user = await who(c);
    const channelId = id(c, 'channelId');
    const data = await bytes(c, community.limits.fileBytes);
    return c.json({
      file: await community.uploadFile(user, channelId, { name: c.req.query('name'), mime: c.req.header('content-type'), bytes: data, width: c.req.query('w'), height: c.req.query('h') }),
    });
  });

  app.get('/api/files/:fileId', async (c) => {
    const file = await community.readFile(await who(c), id(c, 'fileId'));
    return c.body(file.data as Uint8Array<ArrayBuffer>, 200, {
      // Só imagem, vídeo e áudio saem com o tipo real; o resto é sempre download, nunca página.
      'content-type': file.inline ? file.mime : 'application/octet-stream',
      'content-disposition': `${file.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=31536000, immutable',
    });
  });

  const reaction = async (c: Context, on: boolean) => {
    const user = await who(c);
    return c.json({ message: await community.react(user, id(c, 'messageId'), c.req.param('emoji') ?? '', on) });
  };
  app.put('/api/messages/:messageId/reactions/:emoji', (c) => reaction(c, true));
  app.delete('/api/messages/:messageId/reactions/:emoji', (c) => reaction(c, false));

  app.put('/api/groups/:groupId/notify', async (c) => {
    await community.setNotify(await who(c), id(c, 'groupId'), await body(c));
    return c.json({ ok: true });
  });

  app.patch('/api/messages/:messageId', async (c) =>
    c.json({ message: await community.editMessage(await who(c), id(c, 'messageId'), (await body(c, MESSAGE)).content) }),
  );

  app.delete('/api/messages/:messageId', async (c) => {
    await community.deleteMessage(await who(c), id(c, 'messageId'));
    return c.json({ ok: true });
  });

  app.post('/api/messages/:messageId/pin', async (c) =>
    c.json({ message: await community.pinMessage(await who(c), id(c, 'messageId'), (await body(c)).pinned) }),
  );

  // --- Voz ------------------------------------------------------------------------------

  app.post('/api/channels/:channelId/voice', async (c) => {
    const user = await who(c);
    if (!limiter.take(`voz:${user.id}`, 30, 60_000)) throw new ApiError(429, 'devagar', 'Muitas entradas em canais de voz. Espere um instante.');
    return c.json(await community.joinVoice(user, id(c, 'channelId')));
  });

  app.post('/api/voice/leave', async (c) => {
    await community.leaveVoice(await who(c));
    return c.json({ ok: true });
  });

  app.post('/api/channels/:channelId/voice/moderate', async (c) => {
    await community.moderateVoice(await who(c), id(c, 'channelId'), await body(c));
    return c.json({ ok: true });
  });

  // --- Central de Bots ------------------------------------------------------------------

  if (!bots) return;

  app.get('/api/bots', async (c) => {
    await who(c);
    return c.json({ bots: bots.catalog() });
  });

  app.get('/api/groups/:groupId/bots', async (c) => c.json({ installed: await bots.list(await who(c), id(c, 'groupId')) }));

  app.post('/api/groups/:groupId/bots', async (c) => {
    await bots.install(await who(c), id(c, 'groupId'), (await body(c)).botId);
    return c.json({ ok: true });
  });

  app.get('/api/groups/:groupId/bots/logs', async (c) =>
    c.json({ entries: await bots.logs(await who(c), id(c, 'groupId'), { bot: c.req.query('bot'), before: c.req.query('before') }) }),
  );

  app.patch('/api/groups/:groupId/bots/:botId', async (c) => {
    await bots.update(await who(c), id(c, 'groupId'), id(c, 'botId'), await body(c, 64_000));
    return c.json({ ok: true });
  });

  app.delete('/api/groups/:groupId/bots/:botId', async (c) => {
    await bots.uninstall(await who(c), id(c, 'groupId'), id(c, 'botId'));
    return c.json({ ok: true });
  });

  app.get('/api/groups/:groupId/commands', async (c) => c.json({ commands: await bots.commandsFor(await who(c), id(c, 'groupId')) }));
}
