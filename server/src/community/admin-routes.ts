import type { Context, Hono } from 'hono';
import type { Community } from './core.ts';
import type { Economy } from './economy.ts';
import type { User } from './auth.ts';
import type { RateLimiter } from '../ratelimit.ts';
import { ApiError } from '../errors.ts';
import { adminAudit, integer, requestId, requireReason, securityLimit } from './global-admin.ts';
import { postPoints } from './commerce.ts';

interface Deps {
  economy: Economy; community: Community; limiter: RateLimiter;
  who: (c: Context) => Promise<User>;
  tokenOf: (c: Context) => string | null;
  body: (c: Context) => Promise<Record<string, unknown>>;
  clientIp: (c: Context) => string;
}

export function mountAdmin(app: Hono, { economy, community, limiter, who, tokenOf, body, clientIp }: Deps): void {
  const { admin, commerce } = economy, db = commerce.db;
  const guard = async (c: Context) => {
    const user = await who(c);
    await admin.requireMfa(user, tokenOf(c));
    return user;
  };
  const mfaUser = async (c: Context) => {
    const user = await who(c);
    await admin.require(user);
    if (!limiter.take(`admin-mfa:${user.id}`, 8, 10 * 60_000) || !limiter.take(`admin-mfa-ip:${clientIp(c)}`, 20, 10 * 60_000) || !(await securityLimit(db, `admin-mfa:${user.id}`, 8)) || !(await securityLimit(db, `admin-mfa-ip:${clientIp(c)}`, 20))) throw new ApiError(429, 'muitas_tentativas', 'Muitas tentativas de MFA. Aguarde 10 minutos.');
    return user;
  };
  const page = (c: Context) => {
    const value = Number(c.req.query('page') ?? 0);
    return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 100_000) * 100 : 0;
  };
  const search = (c: Context) => `%${(c.req.query('q') ?? '').trim().slice(0, 64).replace(/[\\%_]/g, '\\$&')}%`;

  app.get('/api/admin/mfa', async (c) => c.json(await admin.status(await who(c), tokenOf(c))));
  app.post('/api/admin/mfa/enroll', async (c) => {
    const user = await mfaUser(c), input = await body(c);
    return c.json(await admin.enroll(user, input.password));
  });
  app.post('/api/admin/mfa/verify', async (c) => {
    const user = await mfaUser(c), input = await body(c);
    return c.json(await admin.verify(user, tokenOf(c), input.code));
  });
  app.post('/api/admin/mfa/recover', async (c) => {
    const user = await mfaUser(c), result = await admin.recover(user, await body(c));
    community.hub.kick(user.id);
    return c.json(result);
  });

  app.get('/api/admin/overview', async (c) => {
    await guard(c);
    const [summary] = await db.query(`SELECT (SELECT count(*) FROM users WHERE NOT is_bot) AS users,
      (SELECT count(*) FROM groups) AS servers, (SELECT count(*) FROM global_permissions) AS admins,
      (SELECT coalesce(sum(points::bigint),0) FROM users) AS points,
      (SELECT count(*) FROM promo_redemptions) AS redemptions, (SELECT count(*) FROM gifts) AS gifts`);
    return c.json({ summary });
  });
  app.get('/api/admin/users', async (c) => {
    await guard(c);
    return c.json({ rows: await db.query('SELECT u.id, u.username, u.display_name, u.points, u.created_at, EXISTS (SELECT 1 FROM global_permissions gp WHERE gp.user_id = u.id) AS cosmic_admin FROM users u WHERE NOT u.is_bot AND (u.username ILIKE $1 OR u.id = $3) ORDER BY u.created_at DESC LIMIT 100 OFFSET $2', [search(c), page(c), c.req.query('q') ?? '']) });
  });
  app.get('/api/admin/servers', async (c) => {
    await guard(c);
    return c.json({ rows: await db.query('SELECT g.id, g.name, g.owner_id, g.is_public, g.created_at, (SELECT count(*) FROM members m WHERE m.group_id = g.id) AS members FROM groups g WHERE g.name ILIKE $1 OR g.id = $3 ORDER BY g.created_at DESC LIMIT 100 OFFSET $2', [search(c), page(c), c.req.query('q') ?? '']) });
  });
  app.post('/api/admin/servers/:groupId/join', async (c) => {
    const user = await guard(c), input = await body(c), reason = requireReason(input);
    const group = await community.joinAsAdmin(user, c.req.param('groupId'), reason);
    return c.json({ group });
  });
  app.get('/api/admin/permissions', async (c) => {
    await guard(c);
    return c.json({ rows: await db.query('SELECT gp.user_id, u.username, gp.role, gp.unlimited_cosmetics, gp.is_primary, gp.mfa_secret IS NOT NULL AS mfa_enabled, gp.created_at FROM global_permissions gp JOIN users u ON u.id = gp.user_id ORDER BY gp.created_at') });
  });
  app.put('/api/admin/permissions/:userId', async (c) => {
    const actor = await guard(c), input = await body(c), reason = requireReason(input), target = c.req.param('userId');
    if (typeof input.active !== 'boolean' || (input.unlimited !== undefined && typeof input.unlimited !== 'boolean')) throw new ApiError(400, 'permissao_invalida', 'Informe o estado da permissão.');
    await db.tx(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(727274007)');
      const [account] = await tx.query('SELECT id, is_bot FROM users WHERE id = $1 FOR UPDATE', [target]);
      if (!account || account.is_bot) throw new ApiError(404, 'conta_inexistente', 'Conta não encontrada.');
      const [existing] = await tx.query('SELECT is_primary FROM global_permissions WHERE user_id = $1', [target]);
      if (existing?.is_primary) throw new ApiError(403, 'admin_principal', 'A conta principal é protegida. Use o procedimento local documentado para recuperação.');
      if (input.active) await tx.query('INSERT INTO global_permissions (user_id, unlimited_cosmetics) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET unlimited_cosmetics = EXCLUDED.unlimited_cosmetics', [target, input.unlimited !== false]);
      else await tx.query('DELETE FROM global_permissions WHERE user_id = $1', [target]);
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [target]);
      await adminAudit(tx, actor.id, input.active ? 'admin.permissao_concedida' : 'admin.permissao_revogada', target, reason, { unlimited: input.unlimited !== false });
    });
    for (const id of await community.groupIdsOf(target)) community.touch(id);
    community.hub.kick(target);
    return c.json({ ok: true });
  });

  app.get('/api/admin/codes', async (c) => { await guard(c); return c.json({ rows: await commerce.codes(search(c), page(c)) }); });
  app.post('/api/admin/codes', async (c) => {
    const user = await guard(c), input = await body(c); requireReason(input);
    return c.json(await commerce.createCode(user, input));
  });
  app.patch('/api/admin/codes/:codeId', async (c) => {
    const user = await guard(c), input = await body(c), reason = requireReason(input);
    await commerce.updateCode(user, c.req.param('codeId'), input.active, false, reason);
    return c.json({ ok: true });
  });
  app.delete('/api/admin/codes/:codeId', async (c) => {
    const user = await guard(c), reason = requireReason(await body(c));
    await commerce.updateCode(user, c.req.param('codeId'), false, true, reason);
    return c.json({ ok: true });
  });
  app.get('/api/admin/codes/:codeId/redemptions', async (c) => { await guard(c); return c.json({ rows: await commerce.redemptions(c.req.param('codeId'), page(c)) }); });

  app.get('/api/admin/points', async (c) => {
    await guard(c);
    return c.json({ rows: await db.query('SELECT l.id, l.user_id, u.username, l.delta, l.reason, l.detail, l.created_at FROM points_ledger l JOIN users u ON u.id = l.user_id WHERE u.username ILIKE $1 OR u.id = $3 ORDER BY l.seq DESC LIMIT 100 OFFSET $2', [search(c), page(c), c.req.query('q') ?? '']) });
  });
  app.post('/api/admin/points', async (c) => {
    const user = await guard(c), input = await body(c), reason = requireReason(input), key = requestId(input.requestId), target = String(input.userId ?? '');
    const delta = integer(input.delta, -1_000_000);
    if (delta === 0) throw new ApiError(400, 'numero_invalido', 'A quantidade não pode ser zero.');
    await db.tx(async (tx) => {
      const [account] = await tx.query('SELECT id FROM users WHERE id = $1 AND NOT is_bot FOR UPDATE', [target]);
      if (!account) throw new ApiError(404, 'conta_inexistente', 'Conta não encontrada.');
      const ref = `admin:${user.id}:${key}`;
      const [prior] = await tx.query('SELECT delta, detail FROM points_ledger WHERE user_id = $1 AND ref = $2', [target, ref]);
      if (prior) {
        if (Number(prior.delta) !== delta || prior.detail !== reason.slice(0, 120)) throw new ApiError(409, 'pedido_reutilizado', 'Esta chave já foi usada com outros dados.');
        return;
      }
      await postPoints(tx, target, delta, 'admin', reason, ref);
      await adminAudit(tx, user.id, 'pontos.ajuste', target, reason, { delta, requestId: key });
    });
    community.hub.toUser(target, { t: 'points.changed' });
    return c.json({ ok: true });
  });
  app.get('/api/admin/shop', async (c) => { await guard(c); return c.json({ rows: await commerce.catalog() }); });
  app.patch('/api/admin/shop/:itemId', async (c) => {
    const user = await guard(c), input = await body(c), reason = requireReason(input), item = await commerce.item(c.req.param('itemId'));
    const price = integer(input.price, 0);
    if (typeof input.active !== 'boolean' || typeof input.transferable !== 'boolean') throw new ApiError(400, 'estado_invalido', 'Informe disponibilidade e transferência.');
    await db.tx(async (tx) => {
      await tx.query('INSERT INTO shop_settings (item_id, price, active, transferable) VALUES ($1,$2,$3,$4) ON CONFLICT (item_id) DO UPDATE SET price = $2, active = $3, transferable = $4', [item.id, price, input.active, input.transferable]);
      await adminAudit(tx, user.id, 'loja.item_atualizado', item.id, reason, { price, active: input.active, transferable: input.transferable });
    });
    return c.json({ ok: true });
  });
  app.get('/api/admin/gifts', async (c) => {
    await guard(c);
    return c.json({ rows: await db.query('SELECT g.id, g.sender_id, s.username AS sender, g.recipient_id, r.username AS recipient, g.item_id, g.kind, g.price, g.created_at FROM gifts g JOIN users s ON s.id = g.sender_id JOIN users r ON r.id = g.recipient_id WHERE s.username ILIKE $1 OR r.username ILIKE $1 ORDER BY g.created_at DESC LIMIT 100 OFFSET $2', [search(c), page(c)]) });
  });
  app.get('/api/admin/audit', async (c) => {
    await guard(c);
    return c.json({ rows: await db.query('SELECT a.id::text, a.actor_id, u.username, a.action, a.target_id, a.reason, a.detail, a.created_at FROM admin_audit a LEFT JOIN users u ON u.id = a.actor_id WHERE a.action ILIKE $1 OR a.target_id = $3 ORDER BY a.id DESC LIMIT 100 OFFSET $2', [search(c), page(c), c.req.query('q') ?? '']) });
  });
  app.get('/api/admin/settings', async (c) => { await guard(c); return c.json({ rows: await db.query('SELECT key, value, updated_at FROM global_settings ORDER BY key') }); });
  app.patch('/api/admin/settings', async (c) => {
    const user = await guard(c), input = await body(c), reason = requireReason(input);
    if (!['promotions_enabled', 'gifts_enabled'].includes(String(input.key)) || typeof input.value !== 'boolean') throw new ApiError(400, 'configuracao_invalida', 'Configuração inválida.');
    await db.tx(async (tx) => {
      await tx.query('UPDATE global_settings SET value = $2::jsonb, updated_at = now() WHERE key = $1', [input.key, JSON.stringify(input.value)]);
      await adminAudit(tx, user.id, 'configuracao.alterada', String(input.key), reason, { value: input.value });
    });
    return c.json({ ok: true });
  });
}
