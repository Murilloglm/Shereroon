import type { MicSettings } from './mic.ts';
import type { NoiseLevel } from './denoise.ts';
import { storage } from './storage.ts';
import { Store } from './store.ts';

export interface InputSettings {
  profile: 'isolation' | 'studio' | 'custom';
  enabled: boolean;
  mode: 'auto' | 'manual';
  thresholdDb: number;
  hysteresisDb: number;
  holdMs: number;
  releaseMs: number;
  attackMs: number;
  preRollMs: number;
  vad: boolean;
  vadThreshold: number;
  noise: 'legacy' | 'off' | 'browser' | NoiseLevel;
}
export const DEFAULT_INPUT: InputSettings = { profile: 'custom', enabled: false, mode: 'auto', thresholdDb: -50, hysteresisDb: 6, holdMs: 180, releaseMs: 100, attackMs: 4, preRollMs: 40, vad: true, vadThreshold: 0.6, noise: 'legacy' };
const limits = { thresholdDb: [-80, -10], hysteresisDb: [2, 15], holdMs: [40, 1000], releaseMs: [20, 500], attackMs: [1, 20], preRollMs: [0, 80], vadThreshold: [0.1, 0.9] } as const;
export function cleanInput(raw: unknown): InputSettings {
  const out = { ...DEFAULT_INPUT };
  if (!raw || typeof raw !== 'object') return out;
  const data = raw as Record<string, unknown>;
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) (out as unknown as Record<string, unknown>)[key] = Math.max(min, Math.min(max, value));
  }
  if (['isolation', 'studio', 'custom'].includes(String(data.profile))) out.profile = data.profile as InputSettings['profile'];
  if (data.mode === 'auto' || data.mode === 'manual') out.mode = data.mode;
  if (typeof data.enabled === 'boolean') out.enabled = data.enabled;
  if (typeof data.vad === 'boolean') out.vad = data.vad;
  if (['legacy', 'off', 'browser', 'leve', 'equilibrado', 'forte', 'voz'].includes(String(data.noise))) out.noise = data.noise as InputSettings['noise'];
  return out;
}
const KEY = 'shareroom:entrada';
export const inputSettings = new Store<InputSettings>(cleanInput(storage.get(KEY, null)));
export function setInput(patch: Partial<InputSettings>): void {
  const next = cleanInput({ ...inputSettings.get(), ...patch });
  inputSettings.set(next); storage.set(KEY, next);
}
export function setInputProfile(profile: InputSettings['profile']): void {
  setInput(profile === 'studio' ? { profile, enabled: false, noise: 'off' }
    : profile === 'isolation' ? { profile, enabled: true, mode: 'auto', noise: 'equilibrado', vad: true }
    : { profile });
}
export function effectiveMic(settings: MicSettings, input: InputSettings): MicSettings {
  if (input.profile === 'studio') return { ...settings, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  if (input.profile === 'isolation' || !['off', 'legacy', 'browser'].includes(input.noise)) return { ...settings, noiseSuppression: false, autoGainControl: false };
  return { ...settings, noiseSuppression: input.noise === 'off' ? false : input.noise === 'browser' ? true : settings.noiseSuppression, autoGainControl: input.enabled ? false : settings.autoGainControl };
}
