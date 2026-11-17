import { describe, expect, it } from 'vitest';
// Módulo JavaScript puro, compartilhado com o AudioWorklet.
import { BoostLimiter, CEILING } from '../public/worklets/boost-limiter.js';

const RATE = 48_000;
const BLOCK = 128;

/** Passa um sinal pelo limitador em blocos de 128 (como no AudioWorklet) e devolve a saída. */
function run(limiter: BoostLimiter, signal: Float32Array): Float32Array {
  const out = new Float32Array(signal.length);
  for (let start = 0; start < signal.length; start += BLOCK) {
    const frames = Math.min(BLOCK, signal.length - start);
    const input = [signal.subarray(start, start + frames)];
    const output = [new Float32Array(frames)];
    limiter.process(input, output, frames);
    out.set(output[0]!, start);
  }
  return out;
}

const sine = (amplitude: number, hz: number, seconds: number) =>
  // Comprimento múltiplo de 128, como os blocos do AudioWorklet.
  Float32Array.from({ length: Math.round((seconds * RATE) / BLOCK) * BLOCK }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE));

const peak = (signal: Float32Array, from = 0) => {
  let value = 0;
  for (let i = from; i < signal.length; i++) value = Math.max(value, Math.abs(signal[i]!));
  return value;
};

/** Correlação entre a saída e um seno puro da mesma frequência: perto de 1 = sem distorção audível. */
function sineLikeness(signal: Float32Array, hz: number, from: number): number {
  let ss = 0;
  let sc = 0;
  let energy = 0;
  for (let i = from; i < signal.length; i++) {
    const t = (2 * Math.PI * hz * i) / RATE;
    ss += signal[i]! * Math.sin(t);
    sc += signal[i]! * Math.cos(t);
    energy += signal[i]! * signal[i]!;
  }
  const n = signal.length - from;
  const fundamental = (2 * (ss * ss + sc * sc)) / n;
  return fundamental / energy;
}

describe('reforço de volume com limitador', () => {
  it('em 100% é transparente: só atrasa 2 ms', () => {
    const limiter = new BoostLimiter(RATE);
    const input = sine(0.5, 440, 0.2);
    const out = run(limiter, input);
    const delay = limiter.lookahead;
    for (let i = delay + 10; i < input.length; i += 97) expect(out[i]).toBeCloseTo(input[i - delay]!, 6);
  });

  it('em 200% dobra um sinal baixo, sem mexer na forma de onda', () => {
    const limiter = new BoostLimiter(RATE);
    limiter.setBoost(2);
    const input = sine(0.3, 300, 0.6);
    const out = run(limiter, input);
    // Depois da rampa do reforço (~30 ms de constante), o pico dobra: 0,3 vira 0,6.
    expect(peak(out, RATE * 0.3)).toBeCloseTo(0.6, 2);
    expect(sineLikeness(out, 300, RATE * 0.3)).toBeGreaterThan(0.999);
  });

  it('em 200% um sinal alto não passa do teto nem é cortado', () => {
    const limiter = new BoostLimiter(RATE);
    limiter.setBoost(2);
    const input = sine(0.8, 300, 0.8); // 0,8 x 2 = 1,6: sem limitador seria corte seco
    const out = run(limiter, input);
    expect(peak(out)).toBeLessThanOrEqual(CEILING * 1.01);
    // Segurado pelo ganho, não cortado: continua um seno (o corte seco cairia para ~0,9).
    expect(sineLikeness(out, 300, RATE * 0.4)).toBeGreaterThan(0.995);
    expect(limiter.reduction).toBeLessThan(0.6);
  });

  it('pico repentino (batida) é segurado antes de sair', () => {
    const limiter = new BoostLimiter(RATE);
    limiter.setBoost(2);
    const input = new Float32Array(RATE / 4);
    input.fill(0.05);
    for (let i = 6000; i < 6050; i++) input[i] = 0.95; // de repente quase no máximo
    const out = run(limiter, input);
    expect(peak(out)).toBeLessThanOrEqual(CEILING * 1.01);
  });

  it('mudar o volume não faz degrau (sem estalo)', () => {
    const limiter = new BoostLimiter(RATE);
    const input = sine(0.25, 300, 0.5);
    const out = new Float32Array(input.length);
    for (let start = 0; start < input.length; start += BLOCK) {
      if (start === BLOCK * 60) limiter.setBoost(2);
      const output = [new Float32Array(BLOCK)];
      limiter.process([input.subarray(start, start + BLOCK)], output, BLOCK);
      out.set(output[0]!, start);
    }
    let maxStep = 0;
    for (let i = 1; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i]! - out[i - 1]!));
    // A maior variação entre amostras é a do próprio seno no volume mais alto (0,5 x 2π x 300 / 48000 ≈ 0,02).
    expect(maxStep).toBeLessThan(0.025);
  });

  it('estéreo: o mesmo ganho nos dois lados (não desloca o som)', () => {
    const limiter = new BoostLimiter(RATE);
    limiter.setBoost(2);
    const left = sine(0.9, 300, 0.3);
    const right = sine(0.3, 300, 0.3);
    const outLeft = new Float32Array(left.length);
    const outRight = new Float32Array(right.length);
    for (let start = 0; start < left.length; start += BLOCK) {
      const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      limiter.process([left.subarray(start, start + BLOCK), right.subarray(start, start + BLOCK)], output, BLOCK);
      outLeft.set(output[0]!, start);
      outRight.set(output[1]!, start);
    }
    const from = RATE * 0.2;
    expect(peak(outLeft, from) / peak(outRight, from)).toBeCloseTo(3, 1);
  });
});
