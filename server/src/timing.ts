import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestTiming { started: number; stages: Map<string, number>; queries: number }
export const requestTiming = new AsyncLocalStorage<RequestTiming>();

/** Somente durações: não registra SQL, conteúdo, tokens ou dados de contas. */
export async function timed<T>(stage: string, run: () => Promise<T>): Promise<T> {
  const timing = requestTiming.getStore();
  if (!timing) return run();
  const start = performance.now();
  try { return await run(); }
  finally { timing.stages.set(stage, (timing.stages.get(stage) ?? 0) + performance.now() - start); }
}

export function timedQuery<T>(run: () => Promise<T>): Promise<T> {
  const timing = requestTiming.getStore();
  if (timing) timing.queries++;
  return timed('db', run);
}
