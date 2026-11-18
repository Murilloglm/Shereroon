import { describe, expect, it } from 'vitest';
import { cleanInput, DEFAULT_INPUT, effectiveMic } from './input-settings.ts';
import { DEFAULT_MIC } from './mic.ts';
describe('input settings', () => {
  it('preserves the existing pipeline until a profile or sensitivity is chosen', () => {
    expect(cleanInput(null)).toEqual(DEFAULT_INPUT); expect(DEFAULT_INPUT.enabled).toBe(false);
  });
  it('clamps persisted values and rejects corrupted settings', () => {
    expect(cleanInput({ thresholdDb: -999, holdMs: -1, preRollMs: Infinity, profile: 'bad' })).toMatchObject({ thresholdDb: -80, holdMs: 40, preRollMs: 40, profile: 'custom' });
    expect(cleanInput({ thresholdDb: 0 })).toMatchObject({ thresholdDb: -10 });
  });
  it('studio requests no WebRTC processing; AI never stacks browser suppression or AGC', () => {
    expect(effectiveMic(DEFAULT_MIC, { ...DEFAULT_INPUT, profile: 'studio' })).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(effectiveMic(DEFAULT_MIC, { ...DEFAULT_INPUT, profile: 'isolation' })).toMatchObject({ noiseSuppression: false, autoGainControl: false, echoCancellation: true });
  });
});
