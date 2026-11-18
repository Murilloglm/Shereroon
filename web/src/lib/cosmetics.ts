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
  earnedToday: number;
  rules: Record<string, number>;
  history: { delta: number; reason: string; detail: string; at: string }[];
}

export interface ShopItem extends CosmeticItem {
  owned: boolean;
}

export interface Inventory {
  items: { id: string; price: number; acquiredAt: string }[];
  equipped: UserCosmetics;
}

interface CosmeticsState {
  byUser: Record<string, UserCosmetics>;
  points: PointsInfo | null;
  shop: ShopItem[] | null;
  inventory: Inventory | null;
}

const ACTIVE_PING_MS = 60_000;

class CosmeticsClient {
  readonly store = new Store<CosmeticsState>({ byUser: {}, points: null, shop: null, inventory: null });
  readonly #wanted = new Set<string>();
  #batch: ReturnType<typeof setTimeout> | null = null;
  #lastInput = 0;
  #lastPing = 0;

  constructor() {
    groups.onEvent((event) => {
      // Alguém trocou o que tem equipado: busca de novo só essa pessoa.
      if (event.t === 'profile.changed' && typeof event.userId === 'string' && this.store.get().byUser[event.userId]) {
        this.#forget(event.userId);
        this.request(event.userId);
      }
    });
    if (typeof window !== 'undefined') {
      const mark = () => (this.#lastInput = Date.now());
      for (const name of ['pointerdown', 'keydown', 'pointermove', 'wheel'] as const) window.addEventListener(name, mark, { passive: true });
      setInterval(() => void this.#ping(), 15_000);
    }
  }

  /** Pede (em lote, logo depois) o que essa pessoa tem equipado, se ainda não sabe. */
  request(userId: string): void {
    if (!userId || userId in this.store.get().byUser || this.#wanted.has(userId)) return;
    this.#wanted.add(userId);
    this.#batch ??= setTimeout(() => void this.#flush(), 40);
  }

  async #flush(): Promise<void> {
    this.#batch = null;
    const ids = [...this.#wanted].slice(0, 100);
    for (const id of ids) this.#wanted.delete(id);
    if (this.#wanted.size > 0) this.#batch = setTimeout(() => void this.#flush(), 40);
    if (ids.length === 0 || !groups.store.get().account) return;
    try {
      const { cosmetics } = await groups.call<{ cosmetics: Record<string, UserCosmetics> }>('GET', `/api/cosmetics?ids=${ids.join(',')}`);
      this.store.set((state) => ({ byUser: { ...state.byUser, ...cosmetics } }));
    } catch {
      // sem conexão: tenta de novo quando pedirem de novo
    }
  }

  #forget(userId: string): void {
    this.store.set((state) => {
      const next = { ...state.byUser };
      delete next[userId];
      return { byUser: next };
    });
  }

  async #ping(): Promise<void> {
    const now = Date.now();
    if (!groups.store.get().account || now - this.#lastPing < ACTIVE_PING_MS || now - this.#lastInput > ACTIVE_PING_MS) return;
    this.#lastPing = now;
    await groups.call('POST', '/api/me/active').catch(() => undefined);
  }

  async loadPoints(): Promise<void> {
    this.store.set({ points: await groups.call<PointsInfo>('GET', '/api/me/points') });
  }

  async loadShop(): Promise<void> {
    const { items } = await groups.call<{ items: ShopItem[] }>('GET', '/api/shop');
    this.store.set({ shop: items });
  }

  async loadInventory(): Promise<void> {
    this.store.set({ inventory: await groups.call<Inventory>('GET', '/api/me/inventory') });
  }

  async buy(itemId: string): Promise<void> {
    const inventory = await groups.call<Inventory>('POST', '/api/shop/buy', { itemId });
    this.store.set({ inventory });
    await Promise.all([this.loadShop(), this.loadPoints()]);
  }

  async equip(slot: ItemKind, itemId: string | null, variant?: string): Promise<void> {
    const inventory = await groups.call<Inventory>('PUT', '/api/me/equipped', { slot, itemId, variant });
    this.store.set({ inventory });
    const me = groups.store.get().account?.id;
    if (me) this.store.set((state) => ({ byUser: { ...state.byUser, [me]: inventory.equipped } }));
  }
}

export const cosmetics = new CosmeticsClient();
