/**
 * Rotas HTTP dos grupos. Aqui só há tradução: ler a requisição, descobrir quem é a pessoa pela sessão e
 * chamar o serviço (core.ts), que é quem aplica as permissões.
 */
import type { Context, Hono } from 'hono';
import { ApiError } from '../errors.ts';
import type { RateLimiter } from '../ratelimit.ts';
import type { BotRuntime } from '../bots/runtime.ts';
import { mountAdmin } from './admin-routes.ts';
import { securityLimit } from './global-admin.ts';
import type { Economy } from './economy.ts';
import type { Accounts, User } from './auth.ts';
import type { Community } from './core.ts';
import { timed } from '../timing.ts';

export interface CommunityDeps {
  accounts: Accounts;
  community: Community;
  /** Central de Bots. Sem ela, as rotas de bots não existem. */
  bots?: BotRuntime;
  /** Cosmic Points, loja e inventário. */
  economy?: Economy;
  /** Só em desenvolvimento e testes: rota para dar pontos à própria conta (nunca em produção). */
  devPoints?: boolean;
  limiter: RateLimiter;
  clientIp: (c: Context) => string;
}

const SMALL = 8_192;
const MESSAGE = 24_000;
const WITH_ICON = 200_000;

export function mountCommunity(app: Hono, { accounts, community, bots, economy, devPoints, limiter, clientIp }: CommunityDeps): void {
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

  const who = async (c: Context): Promise<User> => timed('auth', async () => {
    const user = await accounts.authenticate(tokenOf(c));
    if (!user) throw new ApiError(401, 'sessao_invalida', 'Sua sessão terminou. Entre de novo.');
    if (user.cosmicAdmin && economy && !['GET', 'HEAD'].includes(c.req.method) && (/^\/api\/(groups|channels|roles|messages|invites|bots)(\/|$)/.test(c.req.path) || ['/api/shop/buy', '/api/shop/gifts'].includes(c.req.path))) {
      await economy.admin.requireMfa(user, tokenOf(c));
    }
    return user;
  });

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

  if (economy) mountAdmin(app, { economy, community, limiter, who, tokenOf, body, clientIp });

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
  // Sem conta também: quem recebeu o link vê o grupo antes de entrar. Limitado por endereço contra quem tenta adivinhar códigos.
  app.get('/api/invites/:code', async (c) => {
    if (!limiter.take(`convite-ver:${clientIp(c)}`, 60, 10 * 60_000)) throw new ApiError(429, 'muitas_tentativas', 'Muitas consultas de convite. Espere alguns minutos.');
    return c.json(await community.previewInvite(await accounts.authenticate(tokenOf(c)), id(c, 'code')));
  });
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
    return c.json({ message: await community.sendMessage(user, id(c, 'channelId'), input.content, { replyTo: input.replyTo, attachments: input.attachments, clientId: input.clientId }) });
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

  app.post('/api/channels/:channelId/voice/sync', async (c) => {
    const user = await who(c);
    if (!limiter.take(`voz-sync:${user.id}`, 60, 60_000)) throw new ApiError(429, 'devagar', 'Espere um instante.');
    await community.syncVoice(user, id(c, 'channelId'));
    return c.json({ ok: true });
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

  if (economy) {
    // --- Cosmic Points, loja e inventário ------------------------------------------------------------
    app.get('/api/me/points', async (c) => c.json(await economy.points(await who(c))));
    app.post('/api/me/active', async (c) => {
      const user = await who(c);
      if (limiter.take(`ativo:${user.id}`, 3, 60_000)) await economy.markActive(user);
      return c.json({ ok: true });
    });
    app.post('/api/shop/redeem', async (c) => {
      const user = await who(c);
      if (!limiter.take(`resgate:${user.id}`, 8, 10 * 60_000) || !limiter.take(`resgate-ip:${clientIp(c)}`, 30, 10 * 60_000) || !(await securityLimit(economy.commerce.db, `resgate:${user.id}`, 8)) || !(await securityLimit(economy.commerce.db, `resgate-ip:${clientIp(c)}`, 30))) throw new ApiError(429, 'muitas_tentativas', 'Muitas tentativas de resgate. Aguarde alguns minutos.');
      return c.json(await economy.commerce.redeem(user, await body(c)));
    });
    app.get('/api/me/gifts', async (c) => {
      const page = Number(c.req.query('page') ?? 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 100_000) throw new ApiError(400, 'pagina_invalida', 'Página inválida.');
      return c.json({ gifts: await economy.commerce.gifts(await who(c), page * 100) });
    });
    app.post('/api/shop/gifts', async (c) => {
      const user = await who(c);
      if (!limiter.take(`presentes:${user.id}`, 20, 10 * 60_000)) throw new ApiError(429, 'muitas_tentativas', 'Aguarde antes de enviar mais presentes.');
      return c.json(await economy.commerce.gift(user, await body(c)));
    });
    app.post('/api/me/gifts/:giftId/read', async (c) => {
      await economy.commerce.readGift(await who(c), id(c, 'giftId'));
      return c.json({ ok: true });
    });
    app.get('/api/shop', async (c) => c.json({ items: await economy.shop(await who(c)) }));
    app.post('/api/shop/buy', async (c) => {
      const user = await who(c);
      if (!limiter.take(`compra:${user.id}`, 20, 60_000)) throw new ApiError(429, 'muitas_tentativas', 'Compras demais. Espere um pouco.');
      const input = await body(c);
      return c.json(await economy.buy(user, input.itemId, input.expectedPrice));
    });
    app.get('/api/me/inventory', async (c) => c.json(await economy.inventory(await who(c))));
    app.put('/api/me/equipped', async (c) => c.json(await economy.equip(await who(c), await body(c))));
    if (devPoints && process.env.NODE_ENV !== 'production') {
      app.post('/api/dev/points', async (c) => {
        const user = await who(c);
        const amount = Math.min(10_000, Math.max(0, Number((await body(c)).amount) || 0));
        await economy.earn(user.id, amount, 'teste', 'Pontos de desenvolvimento', `teste:${Date.now()}:${Math.random()}`, { ignoreCaps: true });
        return c.json(await economy.points(user));
      });
    }
    app.get('/api/cosmetics', async (c) => {
      await who(c);
      return c.json({ cosmetics: await economy.equippedOf(String(c.req.query('ids') ?? '').split(',')) });
    });
  }

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
    const result = await bots.update(await who(c), id(c, 'groupId'), id(c, 'botId'), await body(c, 64_000));
    return c.json({ ok: true, ...result });
  });

  app.delete('/api/groups/:groupId/bots/:botId', async (c) => {
    await bots.uninstall(await who(c), id(c, 'groupId'), id(c, 'botId'));
    return c.json({ ok: true });
  });

  app.get('/api/groups/:groupId/commands', async (c) => c.json({ commands: await bots.commandsFor(await who(c), id(c, 'groupId')) }));

  // --- Emojis do grupo -------------------------------------------------------------------------------
  app.post('/api/groups/:groupId/emojis', async (c) => {
    const user = await who(c);
    if (!limiter.take(`emoji:${user.id}`, 30, 60 * 60_000)) throw new ApiError(429, 'muitas_tentativas', 'Muitos emojis enviados. Espere um pouco.');
    return c.json({ emoji: await community.createEmoji(user, id(c, 'groupId'), c.req.query('name'), await bytes(c, 256 * 1024)) });
  });
  app.delete('/api/emojis/:emojiId', async (c) => {
    await community.deleteEmoji(await who(c), id(c, 'emojiId'));
    return c.json({ ok: true });
  });
  // Abre sem login, como as fotos de perfil: o id é aleatório.
  app.get('/api/emojis/:emojiId', async (c) => {
    const emoji = await community.readEmoji(id(c, 'emojiId'));
    return c.body(emoji.data as Uint8Array<ArrayBuffer>, 200, {
      'content-type': emoji.mime,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'public, max-age=31536000, immutable',
    });
  });

  // --- Moderação: painel de um membro ---------------------------------------------------------------
  app.get('/api/groups/:groupId/members/:userId/details', async (c) => c.json(await community.memberDetails(await who(c), id(c, 'groupId'), id(c, 'userId'))));

  // --- Perfis, notas, amizades e mensagens privadas ---------------------------------------------------
  const social = community.social;

  app.get('/api/users/:userId', async (c) => c.json({ profile: await social.profile(await who(c), id(c, 'userId')) }));
  app.patch('/api/me/profile', async (c) => c.json({ profile: await social.updateProfile(await who(c), await body(c)) }));
  app.post('/api/me/media/:kind', async (c) => {
    const user = await who(c);
    if (!limiter.take(`midia:${user.id}`, 20, 60 * 60_000)) throw new ApiError(429, 'muitas_tentativas', 'Muitas imagens enviadas. Espere um pouco.');
    return c.json({ profile: await social.uploadMedia(user, c.req.param('kind'), await bytes(c, 6 * 1024 * 1024)) });
  });
  // Fotos e banners abrem sem login (como num CDN): o id é aleatório e muda a cada envio.
  app.get('/api/media/:mediaId', async (c) => {
    const media = await social.media(id(c, 'mediaId'));
    return c.body(media.data as Uint8Array<ArrayBuffer>, 200, {
      'content-type': media.mime,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'public, max-age=31536000, immutable',
    });
  });

  // --- Atividades e jogos vinculados ---------------------------------------------------------------
  const activities = community.activities;
  app.get('/api/me/games', async (c) => c.json({ games: await activities.games(await who(c)) }));
  app.post('/api/me/games', async (c) => c.json({ game: await activities.addGame(await who(c), await body(c, 32_000)) }));
  app.patch('/api/me/games/:gameId', async (c) => c.json({ game: await activities.updateGame(await who(c), c.req.param('gameId'), await body(c)) }));
  app.delete('/api/me/games/:gameId', async (c) => (await activities.removeGame(await who(c), c.req.param('gameId')), c.json({ ok: true })));
  app.put('/api/me/activity', async (c) => {
    const user = await who(c);
    if (!limiter.take(`atividade:${user.id}`, 30, 60_000)) throw new ApiError(429, 'muitas_tentativas', 'Atualizações demais. Espere um pouco.');
    return c.json(await activities.setActivity(user, await body(c)));
  });
  app.delete('/api/me/activity', async (c) => (await activities.clearActivity(await who(c)), c.json({ ok: true })));
  app.get('/api/activities', async (c) => c.json({ friends: await activities.list(await who(c)) }));
  app.get('/api/users/:userId/activity', async (c) => c.json(await activities.forProfile(await who(c), c.req.param('userId'))));

  app.get('/api/me/notes', async (c) => c.json({ notes: await social.notes(await who(c)) }));
  app.put('/api/users/:userId/note', async (c) => c.json({ note: await social.setNote(await who(c), id(c, 'userId'), await body(c)) }));

  app.get('/api/friends', async (c) => c.json({ friends: await social.friends(await who(c)) }));
  app.post('/api/friends', async (c) => {
    const user = await who(c);
    if (!limiter.take(`amizade:${user.id}`, 30, 60 * 60_000)) throw new ApiError(429, 'muitas_tentativas', 'Muitos pedidos de amizade. Espere um pouco.');
    return c.json(await social.requestFriend(user, await body(c)));
  });
  app.post('/api/friends/:userId/accept', async (c) => c.json(await social.acceptFriend(await who(c), id(c, 'userId'))));
  app.delete('/api/friends/:userId', async (c) => c.json(await social.removeFriend(await who(c), id(c, 'userId'))));
  app.get('/api/blocks', async (c) => c.json({ blocks: await social.blocks(await who(c)) }));
  app.put('/api/blocks/:userId', async (c) => c.json(await social.block(await who(c), id(c, 'userId'))));
  app.delete('/api/blocks/:userId', async (c) => c.json(await social.unblock(await who(c), id(c, 'userId'))));

  app.get('/api/dms', async (c) => c.json({ conversations: await social.conversations(await who(c)) }));
  app.post('/api/dms', async (c) => c.json(await social.openDm(await who(c), String((await body(c)).userId ?? ''))));
  app.get('/api/dms/:dmId/messages', async (c) =>
    c.json({ messages: await social.messages(await who(c), id(c, 'dmId'), { before: c.req.query('before'), limit: c.req.query('limit') }) }),
  );
  app.post('/api/dms/:dmId/messages', async (c) => {
    const user = await who(c);
    if (!limiter.take(`dm:${user.id}`, 20, 10_000)) throw new ApiError(429, 'devagar', 'Calma: muitas mensagens em pouco tempo.');
    return c.json({ message: await social.send(user, id(c, 'dmId'), await body(c, MESSAGE)) });
  });
  app.patch('/api/dm-messages/:messageId', async (c) => c.json({ message: await social.edit(await who(c), id(c, 'messageId'), await body(c, MESSAGE)) }));
  app.delete('/api/dm-messages/:messageId', async (c) => {
    await social.remove(await who(c), id(c, 'messageId'));
    return c.json({ ok: true });
  });
  const dmReaction = async (c: Context, on: boolean) => c.json({ message: await social.react(await who(c), id(c, 'messageId'), c.req.param('emoji') ?? '', on) });
  app.put('/api/dm-messages/:messageId/reactions/:emoji', (c) => dmReaction(c, true));
  app.delete('/api/dm-messages/:messageId/reactions/:emoji', (c) => dmReaction(c, false));
  app.post('/api/dms/:dmId/read', async (c) => {
    await social.markRead(await who(c), id(c, 'dmId'), (await body(c)).messageId);
    return c.json({ ok: true });
  });
  app.put('/api/dms/:dmId/notify', async (c) => {
    await social.setNotify(await who(c), id(c, 'dmId'), (await body(c)).level);
    return c.json({ ok: true });
  });
  app.post('/api/dms/:dmId/files', async (c) => {
    const user = await who(c);
    const data = await bytes(c, community.limits.fileBytes);
    return c.json({ file: await social.uploadFile(user, id(c, 'dmId'), { name: c.req.query('name'), mime: c.req.header('content-type'), bytes: data }) });
  });
  app.get('/api/dm-files/:fileId', async (c) => {
    const file = await social.readFile(await who(c), id(c, 'fileId'));
    const inline = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/(mpeg|ogg|wav|webm|mp4))$/.test(file.mime);
    return c.body(file.data as Uint8Array<ArrayBuffer>, 200, {
      'content-type': inline ? file.mime : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=31536000, immutable',
    });
  });
}
