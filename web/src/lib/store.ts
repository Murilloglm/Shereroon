import { useSyncExternalStore } from 'react';

/** Estado observável mínimo: quem muda chama set(), quem lê usa useStore(). */
export class Store<T extends object> {
  #state: T;
  readonly #listeners = new Set<() => void>();

  constructor(initial: T) {
    this.#state = initial;
  }

  get = (): T => this.#state;

  set(patch: Partial<T> | ((state: T) => Partial<T>)): void {
    const changes = typeof patch === 'function' ? patch(this.#state) : patch;
    let changed = false;
    for (const key of Object.keys(changes) as (keyof T)[]) {
      if (!Object.is(this.#state[key], changes[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.#state = { ...this.#state, ...changes };
    for (const listener of this.#listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

/** Lê uma fatia do estado. O seletor deve devolver uma referência estável (um campo, não um objeto novo). */
export function useStore<T extends object, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
