/**
 * Limitador de janela deslizante em memória. É suficiente para um backend de
 * instância única; em serverless cada instância conta por conta própria.
 */
export class RateLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #now: () => number;
  #lastSweep = 0;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Registra uma tentativa. Retorna false quando o limite da janela já foi atingido. */
  take(key: string, limit: number, windowMs: number): boolean {
    const now = this.#now();
    this.#sweep(now);
    const recent = (this.#hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    return true;
  }

  /** Quantas tentativas ainda cabem na janela, sem registrar nada. */
  remaining(key: string, limit: number, windowMs: number): number {
    const now = this.#now();
    const recent = (this.#hits.get(key) ?? []).filter((time) => now - time < windowMs);
    return Math.max(0, limit - recent.length);
  }

  #sweep(now: number): void {
    if (now - this.#lastSweep < 60_000) return;
    this.#lastSweep = now;
    for (const [key, times] of this.#hits) {
      // A maior janela usada é de uma hora (cadastros): só some o que é mais velho que isso.
      if (times.every((time) => now - time > 60 * 60_000)) this.#hits.delete(key);
    }
  }
}
