// Cosmic Points e itens equipados, no navegador.
//  - O que cada pessoa tem equipado é buscado em lote (só de quem aparece na tela) e guardado; muda quando ela troca.
//  - A loja, o inventário e o saldo são da própria conta.
//  - "Usando o aplicativo": a cada minuto, se houve teclado, mouse ou toque, o servidor fica sabendo. É o que separa a
//    chamada de verdade de um aplicativo esquecido aberto (as recompensas de chamada só contam assim).
import type { CosmeticItem, Equipped, ItemKind } from '../../../shared/cosmetics.ts';
import { groups } from './groups/client.ts';
import { Store } from './store.ts';

export type UserCosmetics = Partial<Record<ItemKind, Equipped>>;

export interface PointsInfo {
  points: number;
  unlimited?: boolean;
  earnedToday: number;
  rules: Record<string, number>;
  history: { delta: number; reason: string; detail: string; at: string }[];
}

export interface ShopItem extends CosmeticItem {
  owned: boolean;
  active?: boolean;
  transferable?: boolean;
}

/** Situação de um pacote para a conta (o servidor calcula o preço do que falta, com desconto). */
export interface ShopPack {
  id: string;
  owned: string[];
  missing: string[];
  price: number;
  fullPrice: number;
  active: boolean;
}

export interface Inventory {
  items: { id: string; price: number; acquiredAt: string; adminGrant?: boolean; transferable?: boolean }[];
  equipped: UserCosmetics;
}

export interface CollectionQuote {
  collectionId: string;
  itemIds: string[];
  ownedIds: string[];
  price: number;
  available: boolean;
}

export interface Gift {
  id: string; senderId: string; senderName: string; recipientId: string; recipientName: string;
  itemId: string; kind: string; message: string; price: number; at: string; unread: boolean;
  /** Presente de pacote: o pacote e as peças entregues (só as que o amigo ainda não tinha). */
  packId?: string | null; items?: string[];
}

/** Quanto custa presentear um pacote a um amigo (só as peças que ele ainda não tem). */
export interface PackGiftQuote {
  packId: string;
  missing: string[];
  price: number;
  active: boolean;
}

interface CosmeticsState {
  gifts: Gift[] | null;
  giftsPage: number;
  giftsHasMore: boolean;
  byUser: Record<string, UserCosmetics>;
  points: PointsInfo | null;
  shop: ShopItem[] | null;
  packs: ShopPack[] | null;
  inventory: Inventory | null;
}

const ACTIVE_PING_MS = 60_000;

class CosmeticsClient {
  readonly store = new Store<CosmeticsState>({ byUser: {}, points: null, shop: null, packs: null, inventory: null, gifts: null, giftsPage: 0, giftsHasMore: false });
  readonly #wanted = new Set<string>();
  #batch: ReturnType<typeof setTimeout> | null = null;
  #lastInput = 0;
  #lastPing = 0;
  #generation = 0;
  readonly #versions = new Map<string, number>();
  readonly #observed = new Set<string>();

  constructor() {
    let accountId: string | null = null;
    groups.store.subscribe(() => {
      const next = groups.store.get().account?.id ?? null;
      if (next === accountId) return;
      accountId = next;
      this.#generation++;
      this.#wanted.clear();
      this.#versions.clear();
      this.#observed.clear();
      this.store.set({ byUser: {}, points: null, shop: null, packs: null, inventory: null, gifts: null, giftsPage: 0, giftsHasMore: false });
      if (next) void this.loadGifts().then(() => {
        const unread = this.store.get().gifts?.filter((gift) => gift.unread).length ?? 0;
        if (unread) groups.notify(`Você recebeu ${unread} presente(s). Abra Presentes nas configurações.`);
      }).catch(() => undefined);
    });
    groups.onEvent((event) => {
      if (event.t === 'gift.received') {
        groups.notify(`${String(event.senderName ?? 'Um amigo')} enviou um presente! Abra Presentes nas configurações.`);
        void Promise.all([this.loadGifts(), this.loadInventory(), this.loadShop()]).catch(() => undefined);
      }
      if (event.t === 'points.changed') void this.loadPoints().catch(() => undefined);
      if (event.t === 'inventory.changed') void Promise.all([this.loadInventory(), this.loadShop()]).catch(() => undefined);
      if (event.t === 'ready') {
        // Uma troca pode ter acontecido durante a desconexão, em qualquer servidor ou sessão.
        const known = [...this.#observed];
        this.#generation++;
        for (const id of known) this.request(id, true);
        void this.loadInventory().catch(() => undefined);
      }
      // Alguém trocou o que tem equipado: busca de novo só essa pessoa.
      if (event.t === 'profile.changed' && typeof event.userId === 'string') {
        this.#forget(event.userId);
        this.request(event.userId, true);
      }
    });
    if (typeof window !== 'undefined') {
      const mark = () => (this.#lastInput = Date.now());
      for (const name of ['pointerdown', 'keydown', 'pointermove', 'wheel'] as const) window.addEventListener(name, mark, { passive: true });
      setInterval(() => void this.#ping(), 15_000);
    }
  }

  /** Pede (em lote, logo depois) o que essa pessoa tem equipado, se ainda não sabe. */
  request(userId: string, refresh = false): void {
    if (userId) this.#observed.add(userId);
    if (!userId || (!refresh && userId in this.store.get().byUser) || this.#wanted.has(userId)) return;
    this.#wanted.add(userId);
    this.#batch ??= setTimeout(() => void this.#flush(), 40);
  }

  async #flush(): Promise<void> {
    this.#batch = null;
    const ids = [...this.#wanted].slice(0, 100);
    for (const id of ids) this.#wanted.delete(id);
    if (this.#wanted.size > 0) this.#batch = setTimeout(() => void this.#flush(), 40);
    if (ids.length === 0 || !groups.store.get().account) return;
    const generation = this.#generation;
    const versions = new Map(ids.map((id) => [id, this.#versions.get(id) ?? 0]));
    try {
      const { cosmetics } = await groups.call<{ cosmetics: Record<string, UserCosmetics> }>('GET', `/api/cosmetics?ids=${ids.join(',')}`);
      if (generation !== this.#generation) return;
      const fresh = Object.fromEntries(Object.entries(cosmetics).filter(([id]) => versions.get(id) === (this.#versions.get(id) ?? 0)));
      this.store.set((state) => ({ byUser: { ...state.byUser, ...fresh } }));
    } catch {
      // sem conexão: tenta de novo quando pedirem de novo
    }
  }

  #forget(userId: string): void {
    this.#versions.set(userId, (this.#versions.get(userId) ?? 0) + 1);
  }

  async #ping(): Promise<void> {
    const now = Date.now();
    if (!groups.store.get().account || now - this.#lastPing < ACTIVE_PING_MS || now - this.#lastInput > ACTIVE_PING_MS) return;
    this.#lastPing = now;
    await groups.call('POST', '/api/me/active').catch(() => undefined);
  }

  async loadPoints(): Promise<void> {
    const me = groups.store.get().account?.id;
    const points = await groups.call<PointsInfo>('GET', '/api/me/points');
    if (groups.store.get().account?.id === me) this.store.set({ points });
  }

  async loadShop(): Promise<void> {
    const me = groups.store.get().account?.id;
    const { items, packs } = await groups.call<{ items: ShopItem[]; packs?: ShopPack[] }>('GET', '/api/shop');
    if (groups.store.get().account?.id === me) this.store.set({ shop: items, packs: packs ?? [] });
  }

  /** Leva de uma vez o que falta do pacote, pelo preço mostrado (se mudou, o servidor pede nova confirmação). */
  async buyPack(packId: string, expectedPrice: number): Promise<void> {
    const inventory = await groups.call<Inventory>('POST', '/api/shop/buy-pack', { packId, expectedPrice });
    this.store.set({ inventory });
    await Promise.all([this.loadShop(), this.loadPoints()]);
  }

  /** "Usar o pacote completo": equipa tudo o que a conta tem do pacote. */
  async equipPack(packId: string): Promise<void> {
    const inventory = await groups.call<Inventory>('PUT', '/api/me/equipped/pack', { packId });
    this.store.set({ inventory });
    const me = groups.store.get().account?.id;
    if (me) this.store.set((state) => ({ byUser: { ...state.byUser, [me]: inventory.equipped } }));
  }

  async loadInventory(): Promise<void> {
    const me = groups.store.get().account?.id;
    const inventory = await groups.call<Inventory>('GET', '/api/me/inventory');
    if (me && groups.store.get().account?.id === me) this.store.set((state) => ({ inventory, byUser: { ...state.byUser, [me]: inventory.equipped } }));
  }

  async buy(itemId: string, expectedPrice?: number): Promise<void> {
    const inventory = await groups.call<Inventory>('POST', '/api/shop/buy', { itemId, expectedPrice });
    this.store.set({ inventory });
    await Promise.all([this.loadShop(), this.loadPoints()]);
  }

  quoteCollection(collectionId: string, recipientId?: string): Promise<CollectionQuote> {
    return groups.call('GET', `/api/shop/collections/${collectionId}/quote${recipientId ? `?recipientId=${encodeURIComponent(recipientId)}` : ''}`);
  }

  async buyCollection(quote: CollectionQuote): Promise<void> {
    const inventory = await groups.call<Inventory>('POST', `/api/shop/collections/${quote.collectionId}/buy`, { expectedPrice: quote.price, expectedItemIds: quote.itemIds });
    this.store.set({ inventory });
    await Promise.all([this.loadShop(), this.loadPoints()]);
  }

  async giftCollection(quote: CollectionQuote, input: { recipientId: string; message: string; requestId: string }): Promise<void> {
    await groups.call('POST', `/api/shop/collections/${quote.collectionId}/gift`, { ...input, expectedPrice: quote.price, expectedItemIds: quote.itemIds, confirm: true });
    await Promise.all([this.loadGifts(), this.loadPoints()]);
  }

  async loadGifts(page = 0): Promise<void> {
    const me = groups.store.get().account?.id;
    const { gifts } = await groups.call<{ gifts: Gift[] }>('GET', `/api/me/gifts?page=${page}`);
    if (groups.store.get().account?.id === me) this.store.set((state) => ({ gifts: page === 0 ? gifts : [...new Map([...(state.gifts ?? []), ...gifts].map((gift) => [gift.id, gift])).values()], giftsPage: page, giftsHasMore: gifts.length === 100 }));
  }

  async redeem(code: string, requestId: string): Promise<{ reward: { kind: string; points?: number; itemId?: string } }> {
    const result = await groups.call<{ reward: { kind: string; points?: number; itemId?: string } }>('POST', '/api/shop/redeem', { code, requestId });
    await Promise.all([this.loadPoints(), this.loadInventory(), this.loadShop()]);
    return result;
  }

  async gift(input: { recipientId: string; itemId: string; message: string; kind: string; expectedPrice: number; requestId: string }): Promise<void> {
    await groups.call('POST', '/api/shop/gifts', { ...input, confirm: true });
    await Promise.all([this.loadGifts(), this.loadPoints(), this.loadInventory(), this.loadShop()]);
  }

  packGiftQuote(packId: string, recipientId: string): Promise<PackGiftQuote> {
    return groups.call<PackGiftQuote>('GET', `/api/shop/packs/${encodeURIComponent(packId)}/gift-quote?recipientId=${encodeURIComponent(recipientId)}`);
  }

  async giftPack(input: { recipientId: string; packId: string; message: string; expectedPrice: number; requestId: string }): Promise<void> {
    await groups.call('POST', '/api/shop/gift-pack', { ...input, confirm: true });
    await Promise.all([this.loadGifts(), this.loadPoints()]);
  }

  async equip(slot: ItemKind, itemId: string | null, variant?: string): Promise<void> {
    const inventory = await groups.call<Inventory>('PUT', '/api/me/equipped', { slot, itemId, variant });
    this.store.set({ inventory });
    const me = groups.store.get().account?.id;
    if (me) this.store.set((state) => ({ byUser: { ...state.byUser, [me]: inventory.equipped } }));
  }
}

export const cosmetics = new CosmeticsClient();
