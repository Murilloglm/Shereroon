export interface LatencySample { operation: string; stage: string; ms: number; at: number; detail?: string }
const samples: LatencySample[] = [];

/** Buffer limitado, consultável no diagnóstico; nunca contém mensagens, tokens ou IDs de contas. */
export const latency = {
  record(operation: string, stage: string, ms: number, detail?: string): void {
    samples.push({ operation, stage, ms: Math.round(ms * 100) / 100, at: Date.now(), ...(detail ? { detail } : {}) });
    if (samples.length > 200) samples.splice(0, samples.length - 200);
  },
  snapshot: (): LatencySample[] => samples.slice(),
  clear: (): void => { samples.length = 0; },
};
if (typeof window !== 'undefined') Object.defineProperty(window, 'cosmicLatency', { value: latency, configurable: true });
