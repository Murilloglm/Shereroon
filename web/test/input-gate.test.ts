import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InputGate } from '../public/worklets/input-gate.js';
import { Denoiser, RnnoiseEngine } from '../public/worklets/denoiser.js';
const RATE = 48000, BLOCK = 128;
const rms = (x: Float32Array) => Math.sqrt(x.reduce((sum, v) => sum + v*v, 0) / Math.max(1, x.length));
const sine = (db: number, seconds = 0.5, hz = 220) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => Math.sqrt(2) * 10 ** (db / 20) * Math.sin(2 * Math.PI * hz * i / RATE));
function run(gate: InputGate, input: Float32Array, probability: number | null = null) {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += BLOCK) gate.process(input.subarray(i, i + BLOCK), output.subarray(i, i + BLOCK), probability);
  return output;
}
const silence = (seconds = 0.5) => new Float32Array(Math.round(seconds * RATE));

describe('input sensitivity on the audio thread', () => {
  it('manual threshold accepts low, normal and loud signals and rejects quieter input', () => {
    for (const db of [-55, -30, -10]) {
      const gate = new InputGate(RATE, { enabled: true, mode: 'manual', thresholdDb: -60, vad: false });
      const input = sine(db), output = run(gate, input);
      expect(rms(output) / rms(input)).toBeGreaterThan(0.9);
    }
    const gate = new InputGate(RATE, { enabled: true, mode: 'manual', thresholdDb: -40, vad: false });
    expect(rms(run(gate, sine(-65)))).toBe(0);
  });
  it('pre-roll preserves the onset and hold bridges pauses between words', () => {
    const gate = new InputGate(RATE, { enabled: true, mode: 'manual', thresholdDb: -50, vad: true, preRollMs: 40, holdMs: 180 });
    const tone = sine(-30, 0.2), output = run(gate, tone, 0.9);
    const delay = Math.round(RATE * 0.04);
    expect(output[delay + 8]).toBeCloseTo(tone[8]!, 5);
    run(gate, silence(0.12), 0); expect(gate.open).toBe(true);
    run(gate, tone, 0.9); expect(gate.open).toBe(true);
    run(gate, silence(0.5), 0); expect(gate.stats.open).toBe(false);
  });
  it('hysteresis prevents chatter; release limits gain discontinuities', () => {
    const gate = new InputGate(RATE, { enabled: true, mode: 'manual', thresholdDb: -40, hysteresisDb: 8, vad: false, holdMs: 100, releaseMs: 100 });
    run(gate, sine(-30)); run(gate, sine(-44)); expect(gate.open).toBe(true);
    const output = run(gate, sine(-70)); expect(gate.stats.open).toBe(false);
    let step = 0; for (let i = 1; i < output.length; i++) step = Math.max(step, Math.abs(output[i]! - output[i-1]!));
    expect(step).toBeLessThan(0.001);
  });
  it('automatic mode learns stationary noise when VAD says there is no voice', () => {
    const gate = new InputGate(RATE, { enabled: true, mode: 'auto' });
    run(gate, sine(-45, 5, 120), 0.01);
    expect(gate.stats.thresholdDb).toBeGreaterThan(-50);
    expect(gate.stats.open).toBe(false);
    expect(rms(run(gate, sine(-35), 0.95))).toBeGreaterThan(0.01);
  });
  it('short mechanical clicks fail the sustained VAD gate', () => {
    const gate = new InputGate(RATE, { enabled: true, mode: 'manual', thresholdDb: -60, vad: true });
    const clicks = silence(1); for (let i=1000; i<clicks.length; i+=6000) clicks.fill(0.6, i, i+40);
    expect(rms(run(gate, clicks, 0.05))).toBe(0);
  });
  it('studio bypass is sample-identical and has zero added delay; reset clears pre-mute audio', () => {
    const gate = new InputGate(RATE, { enabled: false }); const input = sine(-15);
    expect(run(gate, input)).toEqual(input);
    gate.configure({ enabled: true, mode: 'manual', thresholdDb: -60, vad: false });
    run(gate, input); gate.reset(); expect(rms(run(gate, silence()))).toBe(0);
  });
  it('RNNoise + auto sensitivity: measures soft/normal/loud speech, fan and background TV proxy', () => {
    const bytes = readFileSync(new URL('./fixtures/voz.wav', import.meta.url));
    const offset = bytes.indexOf('data', 12, 'ascii');
    const speech = Float32Array.from({ length: bytes.readUInt32LE(offset+4)/2 }, (_, i) => bytes.readInt16LE(offset+8+i*2)/32768);
    const wasm = new WebAssembly.Module(readFileSync(new URL('../public/worklets/rnnoise.wasm', import.meta.url)));
    for (const db of [-50, -30, -12]) {
      const level = rms(speech), gain = 10 ** (db/20)/level;
      const denoiser = new Denoiser(new RnnoiseEngine(wasm)); denoiser.setMode('equilibrado');
      const gate = new InputGate(RATE, { enabled: true, mode: 'auto' });
      let opened = 0, frames = 0, energy = 0;
      const size = Math.ceil(speech.length/BLOCK)*BLOCK + BLOCK*40;
      const reference = new Float32Array(size), result = new Float32Array(size);
      for (let at = 0; at < size; at += BLOCK) {
        const input = Float32Array.from({ length: BLOCK }, (_, i) => (speech[at+i]??0)*gain + 0.0002*Math.sin(2*Math.PI*120*(at+i)/RATE));
        const filtered = new Float32Array(BLOCK), output = new Float32Array(BLOCK);
        denoiser.process(input, filtered, BLOCK);
        gate.process(filtered, output, denoiser.lastVoice ?? 0);
        reference.set(filtered, at); result.set(output, at);
        opened += Number(gate.stats.open); frames++; energy += rms(output)**2;
      }
      console.log(`speech ${db} dBFS: gate open ${(100*opened/frames).toFixed(1)}%, output RMS ${Math.sqrt(energy/frames).toFixed(6)}, gate delay 40ms + RNNoise`);
      expect(opened / frames).toBeGreaterThan(db === -50 ? 0.05 : 0.15);
      expect(energy).toBeGreaterThan(0);
      let error=0, total=0, windows=0, cuts=0;
      const delay = Math.round(RATE*0.04);
      for (let at=0;at+BLOCK+delay<size;at+=BLOCK) {
        const original = rms(reference.subarray(at,at+BLOCK)), gated = rms(result.subarray(at+delay,at+delay+BLOCK));
        if (original > 10**(-65/20)) { windows++; cuts += Number(gated < original*0.2); }
        for (let i=at;i<at+BLOCK;i++) { error+=(reference[i]!-result[i+delay]!)**2; total+=reference[i]!**2; }
      }
      console.log(`speech ${db}: additional gated-window cuts ${(100*cuts/Math.max(1,windows)).toFixed(2)}%, normalized waveform error ${(100*Math.sqrt(error/total)).toFixed(3)}% after delay alignment`);
      expect(cuts/Math.max(1,windows)).toBeLessThan(0.03);
      expect(Math.sqrt(error/total)).toBeLessThan(0.06);
    }
    // TV contains speech: a gate cannot reliably distinguish the speaker from a television.
    const gate = new InputGate(RATE, { enabled: true, mode: 'auto' });
    run(gate, sine(-35, 1), 0.9); expect(gate.stats.open).toBe(true);
  });
  it('measures false activations for generated fan, keyboard and speech from a TV proxy', () => {
    const wasm = new WebAssembly.Module(readFileSync(new URL('../public/worklets/rnnoise.wasm', import.meta.url)));
    const bytes = readFileSync(new URL('./fixtures/voz.wav', import.meta.url)), offset = bytes.indexOf('data', 12, 'ascii');
    const speech = Float32Array.from({ length: bytes.readUInt32LE(offset+4)/2 }, (_, i) => bytes.readInt16LE(offset+8+i*2)/32768);
    let seed = 11;
    const random = () => { seed = (1664525*seed+1013904223)>>>0; return seed/4294967296-0.5; };
    const fan = sine(-42, 4, 120).map(value => value + random()*0.004);
    const keyboard = silence(4);
    for (let at=1000; at<keyboard.length-800; at+=8000) for (let i=0;i<700;i++) keyboard[at+i] = random()*0.3*Math.exp(-i/90);
    const tvGain = 10**(-38/20) / rms(speech);
    const tv = speech.map(value => value * tvGain);
    for (const [name, input] of [['fan',fan],['keyboard',keyboard],['TV proxy',tv]] as const) {
      const denoiser = new Denoiser(new RnnoiseEngine(wasm)); denoiser.setMode('equilibrado');
      const gate = new InputGate(RATE, { enabled: true, mode: 'auto' });
      let open=0, frames=0, voiceSum=0, voiceMax=0;
      for (let at=0;at+BLOCK<=input.length;at+=BLOCK) {
        const filtered = new Float32Array(BLOCK), output = new Float32Array(BLOCK);
        denoiser.process(input.subarray(at,at+BLOCK),filtered,BLOCK);
        gate.process(filtered,output,denoiser.lastVoice??0);
        open+=Number(gate.stats.open); frames++; voiceSum += denoiser.lastVoice??0; voiceMax = Math.max(voiceMax, denoiser.lastVoice??0);
      }
      console.log(`${name}: false activation ${(100*open/frames).toFixed(1)}% of frames (synthetic fixture, not a physical environment)`);
      console.log(`VAD mean ${voiceSum/frames}, max ${voiceMax}, noise floor ${gate.noiseDb}, threshold ${gate.stats.thresholdDb}`);
      if (name !== 'TV proxy') expect(open/frames).toBeLessThan(0.2);
      else expect(open/frames).toBeGreaterThan(0.1);
    }
  });
});
