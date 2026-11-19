import { CATALOG, itemById, packById, packPrice, PACKS, SLOTS } from '../../../shared/cosmetics.ts';
import { iso, isoOrNull, type Db } from '../db/db.ts';
import { ApiError } from '../errors.ts';
import { cleanText, newId, type User } from './auth.ts';
import type { Community } from './core.ts';
import { adminAudit, integer, requestId, unlimitedCosmetics } from './global-admin.ts';

export async function postPoints(tx: Db, userId: string, delta: number, reason: string, detail: string, ref: string): Promise<void> {
  const updated = await tx.query('UPDATE users SET points = points + $2 WHERE id = $1 AND points::bigint + $2::bigint BETWEEN 0 AND 2147483647 RETURNING id', [userId, delta]);
  if (!updated.length) throw new ApiError(409, delta < 0 ? 'pontos_insuficientes' : 'limite_saldo', delta < 0 ? 'Você não tem Cosmic Points suficientes para isso.' : 'O limite de saldo desta conta foi excedido.');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await tx.query('INSERT INTO points_ledger (id, user_id, delta, reason, detail, ref, day) VALUES ($1,$2,$3,$4,$5,$6,$7)', [newId(14), userId, delta, reason, detail.slice(0, 120), ref, day]);
}

export class Commerce {
  readonly db: Db;
  readonly #community: Community;
  readonly #now: () => Date;
  constructor(db: Db, community: Community, now = () => new Date()) { this.db = db; this.#community = community; this.#now = now; }

  async enabled(key: string, db = this.db): Promise<boolean> {
    const [row] = await db.query('SELECT value FROM global_settings WHERE key = $1', [key]);
    return row?.value !== false;
  }
  async catalog(db = this.db) {
    const rows = await db.query('SELECT * FROM shop_settings');
    return CATALOG.map((item) => {
      const row = rows.find((entry) => entry.item_id === item.id);
      return { ...item, price: row?.price == null ? item.price : Number(row.price), active: row?.active !== false, transferable: row?.transferable === true };
    });
  }
  async item(itemId: unknown, db = this.db) {
    const base = typeof itemId === 'string' ? itemById(itemId) : undefined;
    if (!base) throw new ApiError(404, 'item_inexistente', 'Item não encontrado.');
    const [row] = await db.query('SELECT * FROM shop_settings WHERE item_id = $1 FOR SHARE', [base.id]);
    return { ...base, price: row?.price == null ? base.price : Number(row.price), active: row?.active !== false, transferable: row?.transferable === true };
  }
  async purchase(user: User, itemId: unknown, expectedPrice?: unknown): Promise<void> {
    await this.db.tx(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const item = await this.item(itemId, tx);
      if (!item.active) throw new ApiError(409, 'item_indisponivel', 'Este item está fora da loja.');
      if (expectedPrice !== undefined && expectedPrice !== item.price) throw new ApiError(409, 'preco_alterado', 'O preço mudou. Atualize a loja e confirme novamente.');
      if ((await tx.query('SELECT 1 FROM user_items WHERE user_id = $1 AND item_id = $2', [user.id, item.id])).length) throw new ApiError(409, 'item_repetido', 'Você já tem esse item.');
      const free = await unlimitedCosmetics(tx, user.id), acquisition = newId(18);
      await postPoints(tx, user.id, free ? 0 : -item.price, free ? 'compra_admin' : 'compra', item.name, `compra:${acquisition}`);
      await tx.query('INSERT INTO user_items (user_id, item_id, price, admin_grant, acquisition_id) VALUES ($1,$2,$3,$4,$5)', [user.id, item.id, free ? 0 : item.price, free, acquisition]);
      if (free) await adminAudit(tx, user.id, 'loja.compra_teste', item.id, 'Aquisição cosmética sem débito', { price: item.price });
    });
  }

  /**
   * Situação de cada pacote para a conta: o que ela já tem, o que falta e quanto custa levar o que falta de uma vez
   * (com os preços atuais da loja e o desconto do pacote). Um pacote só está à venda se todos os itens estiverem.
   */
  async packs(userId: string, db = this.db) {
    const owned = new Set((await db.query('SELECT item_id FROM user_items WHERE user_id = $1', [userId])).map((row) => String(row.item_id)));
    const catalog = await this.catalog(db);
    return PACKS.map((pack) => {
      const items = SLOTS.map((kind) => catalog.find((item) => item.id === pack.items[kind])!);
      const missing = items.filter((item) => !owned.has(item.id));
      return {
        id: pack.id,
        owned: items.filter((item) => owned.has(item.id)).map((item) => item.id),
        missing: missing.map((item) => item.id),
        price: packPrice(missing.map((item) => item.price)),
        fullPrice: items.reduce((total, item) => total + item.price, 0),
        active: items.every((item) => item.active),
      };
    });
  }

  /** Leva de uma vez o que falta de um pacote: um débito só (com desconto) e todos os itens na mesma transação. */
  async purchasePack(user: User, packId: unknown, expectedPrice?: unknown): Promise<void> {
    const pack = typeof packId === 'string' ? packById(packId) : undefined;
    if (!pack) throw new ApiError(404, 'pacote_inexistente', 'Pacote não encontrado.');
    await this.db.tx(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const items = [];
      for (const kind of SLOTS) items.push(await this.item(pack.items[kind], tx));
      if (items.some((item) => !item.active)) throw new ApiError(409, 'item_indisponivel', 'Uma peça deste pacote está fora da loja.');
      const owned = new Set((await tx.query('SELECT item_id FROM user_items WHERE user_id = $1', [user.id])).map((row) => String(row.item_id)));
      const missing = items.filter((item) => !owned.has(item.id));
      if (missing.length === 0) throw new ApiError(409, 'pacote_completo', 'Você já tem todas as peças deste pacote.');
      const price = packPrice(missing.map((item) => item.price));
      if (expectedPrice !== undefined && expectedPrice !== price) throw new ApiError(409, 'preco_alterado', 'O preço mudou. Atualize a loja e confirme novamente.');
      const free = await unlimitedCosmetics(tx, user.id), acquisition = newId(18);
      await postPoints(tx, user.id, free ? 0 : -price, free ? 'compra_admin' : 'compra', `Pacote: ${pack.name}`, `pacote:${acquisition}`);
      // O valor pago se divide entre as peças na proporção do preço de cada uma (a última fica com o resto).
      const total = missing.reduce((sum, item) => sum + item.price, 0);
      let left = free ? 0 : price;
      for (const [index, item] of missing.entries()) {
        const share = free ? 0 : index === missing.length - 1 ? left : Math.round((price * item.price) / Math.max(1, total));
        left -= share;
        await tx.query('INSERT INTO user_items (user_id, item_id, price, admin_grant, acquisition_id) VALUES ($1,$2,$3,$4,$5)', [user.id, item.id, share, free, acquisition]);
      }
      if (free) await adminAudit(tx, user.id, 'loja.compra_teste', pack.id, 'Aquisição cosmética de pacote sem débito', { price });
    });
  }

  async createCode(user: User, input: Record<string, unknown>) {
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(code)) throw new ApiError(400, 'codigo_invalido', 'Use de 3 a 64 letras, números, ponto, hífen ou sublinhado.');
    const rewardKind = input.rewardKind ?? 'points';
    if (rewardKind !== 'points' && rewardKind !== 'cosmetic') throw new ApiError(400, 'recompensa_invalida', 'Tipo de recompensa inválido.');
    const points = rewardKind === 'points' ? integer(input.points, 1) : 0;
    const item = rewardKind === 'cosmetic' ? await this.item(input.itemId) : null;
    const perUser = integer(input.perUser ?? 1, 1, 100);
    const maxUses = input.maxUses == null ? null : integer(input.maxUses, 1, 10_000_000);
    let expires: string | null = null;
    if (input.expiresAt != null && input.expiresAt !== '') {
      const date = new Date(String(input.expiresAt));
      if (!Number.isFinite(date.getTime()) || date <= this.#now()) throw new ApiError(400, 'validade_invalida', 'Escolha uma validade futura.');
      expires = date.toISOString();
    }
    const id = newId(16);
    return this.db.tx(async (tx) => {
      const inserted = await tx.query('INSERT INTO promo_codes (id, code, code_key, reward_kind, points, item_id, expires_at, max_uses, per_user, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (code_key) DO NOTHING RETURNING id', [id, code, code.toLowerCase(), rewardKind, points, item?.id ?? null, expires, maxUses, perUser, user.id]);
      if (!inserted.length) throw new ApiError(409, 'codigo_existente', 'Este código já foi utilizado. Crie outro nome.');
      await adminAudit(tx, user.id, 'codigo.criado', id, cleanText(input.reason, 300), { code, rewardKind, points, itemId: item?.id, expiresAt: expires, maxUses, perUser });
      return { id };
    });
  }
  async codes(pattern = '%', offset = 0) {
    const rows = await this.db.query('SELECT * FROM promo_codes WHERE code ILIKE $1 ORDER BY created_at DESC, id DESC LIMIT 100 OFFSET $2', [pattern, offset]);
    return rows.map((row) => ({ id: String(row.id), code: String(row.code), rewardKind: String(row.reward_kind), points: Number(row.points), itemId: row.item_id, expiresAt: isoOrNull(row.expires_at), maxUses: row.max_uses, perUser: Number(row.per_user), uses: Number(row.uses), active: row.active === true, revokedAt: isoOrNull(row.revoked_at) }));
  }
  async updateCode(user: User, id: string, active: unknown, revoke: boolean, reason: string) {
    if (!revoke && typeof active !== 'boolean') throw new ApiError(400, 'estado_invalido', 'Informe se o código fica ativo.');
    await this.db.tx(async (tx) => {
      const result = await tx.query(revoke ? 'UPDATE promo_codes SET revoked_at = now(), active = false WHERE id = $1 AND revoked_at IS NULL RETURNING id' : 'UPDATE promo_codes SET active = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id', revoke ? [id] : [id, active]);
      if (!result.length) throw new ApiError(404, 'codigo_inexistente', 'Código não encontrado ou já revogado.');
      await adminAudit(tx, user.id, revoke ? 'codigo.revogado' : 'codigo.estado', id, reason, { active: revoke ? false : active });
    });
  }
  async redemptions(codeId: string, offset = 0) {
    return this.db.query('SELECT r.id, r.user_id, u.username, r.reward, r.created_at FROM promo_redemptions r JOIN users u ON u.id = r.user_id WHERE r.code_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT 100 OFFSET $2', [codeId, offset]);
  }
  async redeem(user: User, input: Record<string, unknown>) {
    const key = requestId(input.requestId);
    const code = typeof input.code === 'string' ? input.code.trim().toLowerCase() : '';
    if (!/^[a-z0-9_.-]{3,64}$/.test(code)) throw new ApiError(400, 'codigo_invalido', 'Código inválido.');
    return this.db.tx(async (tx) => {
      if (!(await this.enabled('promotions_enabled', tx))) throw new ApiError(409, 'resgates_pausados', 'Os resgates estão temporariamente pausados.');
      const [promo] = await tx.query('SELECT * FROM promo_codes WHERE code_key = $1 FOR UPDATE', [code]);
      // O bloqueio da conta também serializa uma mesma chave usada em códigos diferentes.
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const [prior] = await tx.query('SELECT code_id, reward FROM promo_redemptions WHERE user_id = $1 AND request_id = $2', [user.id, key]);
      if (prior) {
        if (!promo || prior.code_id !== promo.id) throw new ApiError(409, 'pedido_reutilizado', 'Esta chave já foi usada em outra operação.');
        return { reward: prior.reward, replay: true };
      }
      if (!promo || !promo.active || promo.revoked_at || (promo.expires_at && new Date(String(promo.expires_at)) <= this.#now()) || (promo.max_uses != null && Number(promo.uses) >= Number(promo.max_uses))) throw new ApiError(409, 'codigo_indisponivel', 'Código inválido, expirado ou sem resgates disponíveis.');
      const [count] = await tx.query('SELECT count(*) AS n FROM promo_redemptions WHERE code_id = $1 AND user_id = $2', [promo.id, user.id]);
      const ordinal = Number(count!.n) + 1;
      if (ordinal > Number(promo.per_user)) throw new ApiError(409, 'codigo_ja_resgatado', 'Você já atingiu o limite de resgates deste código.');
      const id = newId(18);
      const reward = promo.reward_kind === 'points' ? { kind: 'points', points: Number(promo.points) } : { kind: 'cosmetic', itemId: String(promo.item_id) };
      if (reward.kind === 'points') await postPoints(tx, user.id, reward.points!, 'resgate', `Código ${promo.code}`, `resgate:${id}`);
      else {
        if (!itemById(reward.itemId!)) throw new ApiError(409, 'recompensa_indisponivel', 'A recompensa não está disponível.');
        const inserted = await tx.query('INSERT INTO user_items (user_id, item_id, price, acquisition_id) VALUES ($1,$2,0,$3) ON CONFLICT DO NOTHING RETURNING item_id', [user.id, reward.itemId, id]);
        if (!inserted.length) throw new ApiError(409, 'item_repetido', 'Você já possui o item deste código.');
      }
      await tx.query('INSERT INTO promo_redemptions (id, code_id, user_id, request_id, ordinal, reward) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [id, promo.id, user.id, key, ordinal, JSON.stringify(reward)]);
      await tx.query('UPDATE promo_codes SET uses = uses + 1 WHERE id = $1', [promo.id]);
      return { reward, replay: false };
    });
  }

  async gift(user: User, input: Record<string, unknown>) {
    const key = requestId(input.requestId), recipient = String(input.recipientId ?? '');
    if (recipient === user.id) throw new ApiError(400, 'presente_invalido', 'Escolha um amigo para presentear.');
    if (input.confirm !== true) throw new ApiError(400, 'confirmacao_necessaria', 'Confirme o envio do presente.');
    const kind = input.kind ?? 'purchase';
    if (kind !== 'purchase' && kind !== 'transfer') throw new ApiError(400, 'presente_invalido', 'Tipo de presente inválido.');
    const message = cleanText(input.message, 300, true);
    const result = await this.db.tx(async (tx) => {
      if (!(await this.enabled('gifts_enabled', tx))) throw new ApiError(409, 'presentes_pausados', 'Os presentes estão temporariamente pausados.');
      await tx.query('SELECT id FROM users WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE', [[user.id, recipient]]);
      const [prior] = await tx.query('SELECT * FROM gifts WHERE sender_id = $1 AND request_id = $2', [user.id, key]);
      if (prior) {
        if (prior.recipient_id !== recipient || prior.item_id !== input.itemId || prior.kind !== kind || prior.message !== message) throw new ApiError(409, 'pedido_reutilizado', 'Esta chave já foi usada em outro presente.');
        return { id: String(prior.id), replay: true };
      }
      const pair = [user.id, recipient].sort();
      const [friend] = await tx.query("SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2 AND status = 'amigos' FOR SHARE", pair);
      const [blocked] = await tx.query('SELECT 1 FROM user_blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1)', [user.id, recipient]);
      if (!friend || blocked) throw new ApiError(403, 'amigo_necessario', 'O destinatário precisa ser um amigo sem bloqueios.');
      const item = await this.item(input.itemId, tx);
      if (kind === 'purchase' && !item.active) throw new ApiError(409, 'item_indisponivel', 'Item indisponível na loja.');
      if (kind === 'purchase' && input.expectedPrice !== item.price) throw new ApiError(409, 'preco_alterado', 'Atualize o preço e confirme o presente novamente.');
      const [owned] = await tx.query('SELECT 1 FROM user_items WHERE user_id = $1 AND item_id = $2', [recipient, item.id]);
      if (owned) throw new ApiError(409, 'item_repetido', 'Seu amigo já possui este item.');
      const id = newId(18);
      // Presentes administrativos não debitam pontos e entregam itens de teste não transferíveis.
      const free = await unlimitedCosmetics(tx, user.id);
      let price = item.price;
      if (kind === 'transfer') {
        const [source] = await tx.query('SELECT * FROM user_items WHERE user_id = $1 AND item_id = $2 FOR UPDATE', [user.id, item.id]);
        if (!source || !item.transferable || source.admin_grant) throw new ApiError(409, 'item_intransferivel', 'Este item não permite transferência ou é uma aquisição administrativa.');
        price = 0;
        await tx.query('DELETE FROM user_equipped WHERE user_id = $1 AND item_id = $2', [user.id, item.id]);
        await tx.query('DELETE FROM user_items WHERE user_id = $1 AND item_id = $2', [user.id, item.id]);
      } else await postPoints(tx, user.id, free ? 0 : -price, free ? 'presente_admin' : 'presente', `Presente: ${item.name}`, `presente:${id}`);
      await tx.query('INSERT INTO user_items (user_id, item_id, price, acquisition_id, admin_grant) VALUES ($1,$2,$3,$4,$5)', [recipient, item.id, free && kind === 'purchase' ? 0 : price, id, free && kind === 'purchase']);
      if (free) await adminAudit(tx, user.id, 'presente.administrativo', recipient, 'Presente cosmético de teste, sem débito e sem transferência', { itemId: item.id, kind });
      await tx.query('INSERT INTO gifts (id, sender_id, recipient_id, item_id, kind, message, price, request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, user.id, recipient, item.id, kind, message, free && kind === 'purchase' ? 0 : price, key]);
      return { id, replay: false };
    });
    if (!result.replay) {
      this.#community.hub.toUser(recipient, { t: 'gift.received', giftId: result.id, senderName: user.displayName });
      this.#community.hub.toUser(user.id, { t: 'inventory.changed' });
      void this.#community.social.announceProfileChange(user.id);
    }
    return result;
  }
  async gifts(user: User, offset = 0) {
    const rows = await this.db.query('SELECT g.*, s.username AS sender_name, r.username AS recipient_name FROM gifts g JOIN users s ON s.id = g.sender_id JOIN users r ON r.id = g.recipient_id WHERE g.sender_id = $1 OR g.recipient_id = $1 ORDER BY g.created_at DESC, g.id DESC LIMIT 100 OFFSET $2', [user.id, offset]);
    return rows.map((row) => ({ id: String(row.id), senderId: String(row.sender_id), senderName: String(row.sender_name), recipientId: String(row.recipient_id), recipientName: String(row.recipient_name), itemId: String(row.item_id), kind: String(row.kind), message: String(row.message), price: Number(row.price), at: iso(row.created_at), unread: row.recipient_id === user.id && row.read_at == null }));
  }
  async readGift(user: User, id: string): Promise<void> {
    await this.db.query('UPDATE gifts SET read_at = coalesce(read_at, now()) WHERE id = $1 AND recipient_id = $2', [id, user.id]);
  }
}
