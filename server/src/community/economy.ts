/**
 * Cosmic Points, loja e inventário. Os pontos são gratuitos, ganhos por participação real; não há dinheiro, apostas
 * nem conversão em valores. Todas as regras ficam aqui, no servidor; a interface só mostra.
 *
 * Contra farm: a chamada só conta com pelo menos mais uma pessoa no canal e com a conta usando o aplicativo de
 * verdade (teclado, mouse ou voz nos últimos minutos, informado pelo próprio aplicativo); cada recompensa tem uma
 * chave única (não conta duas vezes, nem com pedidos simultâneos) e há limites por dia.
 */
import { itemById, packById, PACK_SLOTS, POINTS, SLOTS, type Equipped, type ItemKind } from '../../../shared/cosmetics.ts';
import { iso, type Db, type Row } from '../db/db.ts';
import { ApiError } from '../errors.ts';
import { CosmicAdmin, unlimitedCosmetics } from './global-admin.ts';
import { Commerce } from './commerce.ts';
import { newId, type User } from './auth.ts';
import type { Community, CommunityEvent } from './core.ts';

export interface EconomyOptions {
  now?: () => Date;
  adminSecret?: string;
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Dia no horário de Brasília (AAAA-MM-DD): os limites diários viram à meia-noite daqui. */
export function dayOf(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function minutesOfDay(date: Date): number {
  const [hours, minutes] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).split(':').map(Number);
  return hours! * 60 + minutes!;
}

export class Economy {
  readonly commerce: Commerce;
  readonly admin: CosmicAdmin;
  readonly #db: Db;
  readonly #community: Community;
  readonly #now: () => Date;
  /** Última vez que cada conta usou o aplicativo (teclado, mouse, voz), informada por ele. */
  readonly #active = new Map<string, number>();
  /** Minutos de chamada que já contam, desde o último bloco pago. */
  readonly #voiceMinutes = new Map<string, number>();
  #queue: Promise<unknown> = Promise.resolve();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(db: Db, community: Community, options: EconomyOptions = {}) {
    this.#db = db;
    this.#community = community;
    this.#now = options.now ?? (() => new Date());
    this.commerce = new Commerce(db, community, this.#now);
    this.admin = new CosmicAdmin(db, options.adminSecret);
    community.onEvent((event) => this.#enqueue(() => this.#onEvent(event)));
  }

  start(): void {
    this.#timer ??= setInterval(() => this.tick(), 60_000);
    this.#timer.unref?.();
  }

  /** Espera os eventos pendentes (testes). */
  idle(): Promise<unknown> {
    return this.#queue;
  }

  #enqueue(task: () => Promise<unknown>): void {
    this.#queue = this.#queue.then(task).catch(() => undefined);
  }

  // --- Saldo ---------------------------------------------------------------------------------

  /**
   * Lança no saldo, numa transação: o lançamento com a chave `ref` só entra uma vez, e o saldo nunca fica negativo.
   * Devolve false se essa chave já tinha sido usada.
   */
  async #post(userId: string, delta: number, reason: string, detail: string, ref: string, extra?: (tx: Db) => Promise<void>): Promise<boolean> {
    const day = dayOf(this.#now());
    return this.#db.tx(async (tx) => {
      const inserted = await tx.query(
        'INSERT INTO points_ledger (id, user_id, delta, reason, detail, ref, day, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, ref) DO NOTHING RETURNING id',
        [newId(14), userId, delta, reason, detail.slice(0, 120), ref, day, this.#now().toISOString()],
      );
      if (inserted.length === 0) return false;
      const updated = await tx.query('UPDATE users SET points = points + $2 WHERE id = $1 AND points + $2 >= 0 RETURNING points', [userId, delta]);
      if (updated.length === 0) throw new ApiError(409, 'pontos_insuficientes', 'Você não tem Cosmic Points suficientes para isso.');
      await extra?.(tx);
      return true;
    });
  }

  /** Ganho, respeitando os limites do dia (a não ser em lançamentos internos com `ignoreCaps`). Devolve o que entrou. */
  async earn(userId: string, amount: number, reason: string, detail: string, ref: string, options: { cap?: number; ignoreCaps?: boolean } = {}): Promise<number> {
    let value = Math.floor(amount);
    if (value <= 0) return 0;
    if (!options.ignoreCaps) {
      const day = dayOf(this.#now());
      const [totals] = await this.#db.query(
        "SELECT coalesce(sum(delta) FILTER (WHERE delta > 0 AND reason NOT IN ('teste', 'resgate', 'admin')), 0) AS earned, coalesce(sum(delta) FILTER (WHERE reason = $3), 0) AS kind FROM points_ledger WHERE user_id = $1 AND day = $2",
        [userId, day, reason],
      );
      value = Math.min(value, POINTS.dailyCap - Number(totals?.earned ?? 0));
      if (options.cap !== undefined) value = Math.min(value, options.cap - Number(totals?.kind ?? 0));
      if (value <= 0) return 0;
    }
    return (await this.#post(userId, value, reason, detail, ref)) ? value : 0;
  }

  /** Gasto (compra, ação de bot). Recusa sem saldo; a mesma chave não cobra duas vezes. */
  async spend(userId: string, amount: number, reason: string, detail: string, ref: string, extra?: (tx: Db) => Promise<void>): Promise<boolean> {
    const value = Math.floor(amount);
    if (value <= 0) {
      if (extra) await this.#db.tx(extra);
      return true;
    }
    return this.#post(userId, -value, reason, detail, ref, extra);
  }

  async points(user: User) {
    const [row] = await this.#db.query('SELECT points FROM users WHERE id = $1', [user.id]);
    const [today] = await this.#db.query("SELECT coalesce(sum(delta) FILTER (WHERE delta > 0 AND reason NOT IN ('teste', 'resgate', 'admin')), 0) AS earned FROM points_ledger WHERE user_id = $1 AND day = $2", [
      user.id,
      dayOf(this.#now()),
    ]);
    const history = await this.#db.query('SELECT delta, reason, detail, created_at FROM points_ledger WHERE user_id = $1 ORDER BY seq DESC LIMIT 50', [user.id]);
    return {
      points: Number(row?.points ?? 0),
      unlimited: await unlimitedCosmetics(this.#db, user.id),
      earnedToday: Number(today?.earned ?? 0),
      rules: POINTS,
      history: history.map((entry) => ({ delta: Number(entry.delta), reason: String(entry.reason), detail: String(entry.detail), at: iso(entry.created_at) })),
    };
  }

  // --- Recompensas ---------------------------------------------------------------------------

  /** O aplicativo avisa que a pessoa está usando (no máximo uma vez por minuto). Vale o bônus de entrada do dia. */
  async markActive(user: User): Promise<void> {
    this.#active.set(user.id, this.#now().getTime());
    const day = dayOf(this.#now());
    await this.earn(user.id, POINTS.dailyLogin, 'missao', 'Primeira vez no dia', `missao:entrada:${day}`);
  }

  async #onEvent(event: CommunityEvent): Promise<void> {
    // Comandos de bot ("/destaque", "/lembrar"...) não contam como conversa para a missão do dia.
    if (event.type === 'message' && !event.fromBot && !event.message.content.trimStart().startsWith('/')) {
      const day = dayOf(this.#now());
      await this.earn(event.author.id, POINTS.dailyMessage, 'missao', 'Primeira mensagem do dia', `missao:mensagem:${day}`);
    }
  }

  /**
   * A cada minuto: quem está numa chamada com mais alguém e usou o aplicativo há pouco ganha um minuto; a cada bloco
   * de minutos, os pontos (uma vez por bloco de relógio, com teto diário).
   */
  tick(): void {
    const now = this.#now();
    const byChannel = new Map<string, string[]>();
    for (const [userId, place] of this.#community.hub.voiceAll()) {
      const key = `${place.groupId}:${place.channelId}`;
      byChannel.set(key, [...(byChannel.get(key) ?? []), userId]);
    }
    const eligible = new Set<string>();
    for (const people of byChannel.values()) {
      if (people.length < 2) continue;
      for (const userId of people) {
        const active = this.#active.get(userId);
        if (active !== undefined && now.getTime() - active <= POINTS.idleAfterMinutes * 60_000) eligible.add(userId);
      }
    }
    for (const userId of [...this.#voiceMinutes.keys()]) if (!eligible.has(userId)) this.#voiceMinutes.delete(userId);
    for (const userId of eligible) {
      const minutes = (this.#voiceMinutes.get(userId) ?? 0) + 1;
      if (minutes < POINTS.voiceBlockMinutes) {
        this.#voiceMinutes.set(userId, minutes);
        continue;
      }
      this.#voiceMinutes.set(userId, 0);
      const block = Math.floor(minutesOfDay(now) / POINTS.voiceBlockMinutes);
      const ref = `voz:${dayOf(now)}:${block}`;
      this.#enqueue(() => this.earn(userId, POINTS.voicePointsPerBlock, 'voz', 'Em chamada com amigos', ref, { cap: POINTS.voiceDailyCap }));
    }
  }

  // --- Loja e inventário ---------------------------------------------------------------------

  async shop(user: User) {
    const owned = new Set((await this.#db.query('SELECT item_id FROM user_items WHERE user_id = $1', [user.id])).map((row) => String(row.item_id)));
    return (await this.commerce.catalog()).filter((item) => item.active).map((item) => ({ ...item, owned: owned.has(item.id) }));
  }

  async buy(user: User, itemId: unknown, expectedPrice?: unknown) {
    await this.commerce.purchase(user, itemId, expectedPrice);
    return this.inventory(user);
  }

  packs(user: User) {
    return this.commerce.packs(user.id);
  }

  async buyPack(user: User, packId: unknown, expectedPrice?: unknown) {
    await this.commerce.purchasePack(user, packId, expectedPrice);
    return this.inventory(user);
  }

  /** "Usar o pacote completo": equipa de uma vez, cada um no seu espaço, os itens do pacote que a conta tem. */
  async equipPack(user: User, packId: unknown) {
    const pack = typeof packId === 'string' ? packById(packId) : undefined;
    if (!pack) throw new ApiError(404, 'pacote_inexistente', 'Pacote não encontrado.');
    await this.#db.tx(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const ids = PACK_SLOTS.map((kind) => pack.items[kind]);
      const owned = new Set((await tx.query('SELECT item_id FROM user_items WHERE user_id = $1 AND item_id = ANY($2::text[])', [user.id, ids])).map((row) => String(row.item_id)));
      if (owned.size === 0) throw new ApiError(403, 'item_nao_adquirido', 'Adquira alguma peça deste pacote antes de usar.');
      for (const kind of PACK_SLOTS) {
        const item = itemById(pack.items[kind])!;
        if (!owned.has(item.id)) continue;
        await tx.query('INSERT INTO user_equipped (user_id, slot, item_id, variant) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, slot) DO UPDATE SET item_id = $3, variant = $4', [user.id, kind, item.id, item.variants[0]!.id]);
      }
    });
    void this.#community.social.announceProfileChange(user.id);
    return this.inventory(user);
  }

  async inventory(user: User) {
    const items = await this.#db.query('SELECT item_id, price, acquired_at, admin_grant FROM user_items WHERE user_id = $1 ORDER BY acquired_at', [user.id]);
    const catalog = await this.commerce.catalog();
    return {
      items: items.filter((row) => itemById(String(row.item_id))).map((row) => ({ id: String(row.item_id), price: Number(row.price), acquiredAt: iso(row.acquired_at), adminGrant: row.admin_grant === true, transferable: row.admin_grant !== true && catalog.find((item) => item.id === row.item_id)?.transferable === true })),
      equipped: (await this.equippedOf([user.id]))[user.id] ?? {},
    };
  }

  async equip(user: User, input: Record<string, unknown>) {
    const slot = input.slot as ItemKind;
    if (!SLOTS.includes(slot)) throw new ApiError(400, 'espaco_invalido', 'Espaço inválido.');
    if (input.itemId === null || input.itemId === undefined) {
      await this.#db.tx(async (tx) => {
        await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
        await tx.query('DELETE FROM user_equipped WHERE user_id = $1 AND slot = $2', [user.id, slot]);
      });
      await this.#community.social.announceProfileChange(user.id);
      this.#community.hub.toUser(user.id, { t: 'inventory.changed' });
      return this.inventory(user);
    }
    const item = typeof input.itemId === 'string' ? itemById(input.itemId) : undefined;
    if (!item) throw new ApiError(404, 'item_inexistente', 'Esse item não existe na loja.');
    if (item.kind !== slot) throw new ApiError(400, 'espaco_invalido', `“${item.name}” não vai nesse espaço.`);
    const variant = typeof input.variant === 'string' ? item.variants.find((option) => option.id === input.variant) : item.variants[0];
    if (!variant) throw new ApiError(400, 'cor_invalida', 'Essa cor não existe para esse item.');
    await this.#db.tx(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const [owned] = await tx.query('SELECT 1 FROM user_items WHERE user_id = $1 AND item_id = $2', [user.id, item.id]);
      if (!owned) throw new ApiError(403, 'item_nao_adquirido', 'Adquira o item na loja antes de equipar.');
      await tx.query('INSERT INTO user_equipped (user_id, slot, item_id, variant) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, slot) DO UPDATE SET item_id = $3, variant = $4', [user.id, slot, item.id, variant.id]);
    });
    await this.#community.social.announceProfileChange(user.id);
    this.#community.hub.toUser(user.id, { t: 'inventory.changed' });
    return this.inventory(user);
  }

  /** O que cada conta tem equipado (é o que aparece em volta do avatar, para quem vê a conta). */
  async equippedOf(ids: readonly string[]): Promise<Record<string, Partial<Record<ItemKind, Equipped>>>> {
    const clean = [...new Set(ids.filter((id) => ID.test(id)))].slice(0, 100);
    const out: Record<string, Partial<Record<ItemKind, Equipped>>> = Object.fromEntries(clean.map((id) => [id, {}]));
    if (clean.length === 0) return out;
    const marks = clean.map((_, index) => `$${index + 1}`).join(', ');
    const rows: Row[] = await this.#db.query(`SELECT user_id, slot, item_id, variant FROM user_equipped WHERE user_id IN (${marks})`, clean);
    for (const row of rows) {
      const item = itemById(String(row.item_id));
      if (!item) continue;
      out[String(row.user_id)]![row.slot as ItemKind] = { item: item.id, variant: String(row.variant) };
    }
    return out;
  }
}
