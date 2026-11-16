import { describe, expect, it } from 'vitest';
// Módulo JavaScript puro, compartilhado com o AudioWorklet.
import { BLOCK_FRAMES, MAX_STREAMS, TickBuffer } from '../public/worklets/tick-buffer.js';

const SAMPLES = BLOCK_FRAMES * 2;

/** Monta a mensagem binária como o app auxiliar faz: cabeçalho + [slot, amostras] por faixa. */
function tick(sequence: number, streams: { slot: number; fill: (frame: number) => number }[]): ArrayBuffer {
  const buffer = new ArrayBuffer(8 + streams.length * (4 + SAMPLES * 4));
  const view = new DataView(buffer);
  view.setUint32(0, sequence, true);
  view.setUint16(4, BLOCK_FRAMES, true);
  view.setUint8(6, streams.length);
  let offset = 8;
  for (const stream of streams) {
    view.setUint32(offset, stream.slot, true);
    offset += 4;
    const samples = new Float32Array(buffer, offset, SAMPLES);
    for (let frame = 0; frame < BLOCK_FRAMES; frame++) {
      const value = stream.fill(frame);
      samples[frame * 2] = value;
      samples[frame * 2 + 1] = -value;
    }
    offset += SAMPLES * 4;
  }
  return buffer;
}

function outputs(frames = 128): [Float32Array, Float32Array][] {
  return Array.from({ length: MAX_STREAMS }, () => [new Float32Array(frames), new Float32Array(frames)]);
}

describe('fila de áudio do app auxiliar', () => {
  it('só começa a tocar quando junta o atraso alvo (sem picotar no início)', () => {
    const buffer = new TickBuffer(1440);
    const out = outputs();
    buffer.push(tick(0, [{ slot: 0, fill: () => 0.5 }]));
    buffer.push(tick(1, [{ slot: 0, fill: () => 0.5 }]));
    expect(buffer.pull(out, 128)).toBe(false);
    expect(out[0]![0][0]).toBe(0);
    buffer.push(tick(2, [{ slot: 0, fill: () => 0.5 }]));
    expect(buffer.pull(out, 128)).toBe(true);
    expect(out[0]![0][0]).toBe(0.5);
    expect(out[0]![1][0]).toBe(-0.5);
  });

  it('entrega as amostras na ordem, sem perder nem repetir, quando os relógios batem', () => {
    const buffer = new TickBuffer(960);
    let counter = 0;
    const next = () => counter++;
    const heard: number[] = [];
    const out = outputs(120);
    // 4 segundos: nos primeiros ~1,5 s a fila se acomoda em torno do alvo, um quadro por bloco.
    for (let block = 0; block < 400; block++) {
      buffer.push(tick(block, [{ slot: 0, fill: next }]));
      for (let call = 0; call < 4; call++) {
        if (buffer.pull(out, 120)) heard.push(...out[0]![0]);
      }
    }
    expect(heard.length).toBeGreaterThan(15_000);
    // No começo a fila se acomoda em torno do alvo (lendo um quadro a mais ou a menos e interpolando);
    // nunca pula nem repete, e depois de acomodada entrega exatamente o que recebeu.
    for (let index = 1; index < heard.length; index++) {
      const step = heard[index]! - heard[index - 1]!;
      expect(step).toBeGreaterThan(0.97);
      expect(step).toBeLessThan(1.03);
    }
    for (let index = heard.length - 5000; index < heard.length; index++) expect(heard[index]).toBe(heard[index - 1]! + 1);
  });

  it('separa o mix das faixas solo e mantém todas alinhadas', () => {
    const buffer = new TickBuffer(480);
    buffer.setSlots([7, 9]);
    const out = outputs();
    buffer.push(tick(0, [
      { slot: 0, fill: (frame) => frame },
      { slot: 9, fill: (frame) => 1000 + frame },
      { slot: 7, fill: (frame) => 2000 + frame },
    ]));
    expect(buffer.pull(out, 128)).toBe(true);
    expect(out[0]![0][5]).toBe(5);
    expect(out[1]![0][5]).toBe(2005);
    expect(out[2]![0][5]).toBe(1005);
    expect(out[3]![0][5]).toBe(0);
  });

  it('faixa solo que some num bloco vira silêncio, sem atrasar as outras', () => {
    const buffer = new TickBuffer(480);
    buffer.setSlots([7]);
    buffer.push(tick(0, [{ slot: 0, fill: () => 1 }, { slot: 7, fill: () => 2 }]));
    buffer.push(tick(1, [{ slot: 0, fill: () => 3 }]));
    const out = outputs(480);
    buffer.pull(out, 480);
    expect(out[1]![0][100]).toBe(2);
    buffer.pull(out, 479);
    expect(out[0]![0][100]).toBe(3);
    expect(out[1]![0][100]).toBe(0);
  });

  it('ignora faixas de slots que a página não pediu (nada vaza para a transmissão)', () => {
    const buffer = new TickBuffer(480);
    const out = outputs();
    buffer.push(tick(0, [{ slot: 0, fill: () => 0 }, { slot: 42, fill: () => 9 }]));
    buffer.pull(out, 128);
    for (const [left] of out) expect(Math.max(...left)).toBe(0);
  });

  it('relógio do auxiliar mais rápido: a fila fica perto do alvo em vez de crescer', () => {
    const buffer = new TickBuffer(1440);
    const out = outputs();
    let sequence = 0;
    // 1% mais rápido que o navegador durante 60 segundos simulados.
    let produced = 0;
    for (let call = 0; call < (48_000 * 60) / 128; call++) {
      produced += 128 * 1.01;
      while (produced >= BLOCK_FRAMES) {
        buffer.push(tick(sequence++, [{ slot: 0, fill: () => 0.1 }]));
        produced -= BLOCK_FRAMES;
      }
      buffer.pull(out, 128);
    }
    const stats = buffer.takeStats();
    expect(buffer.fill).toBeLessThan(1440 + BLOCK_FRAMES * 2);
    expect(stats.droppedFrames).toBe(0);
    expect(stats.underruns).toBe(0);
  });

  it('relógio do auxiliar mais lento: não esvazia nem falta áudio', () => {
    const buffer = new TickBuffer(1440);
    const out = outputs();
    let sequence = 0;
    let produced = 1440;
    for (let call = 0; call < (48_000 * 60) / 128; call++) {
      produced += 128 * 0.995;
      while (produced >= BLOCK_FRAMES) {
        buffer.push(tick(sequence++, [{ slot: 0, fill: () => 0.1 }]));
        produced -= BLOCK_FRAMES;
      }
      buffer.pull(out, 128);
    }
    expect(buffer.takeStats().underruns).toBe(0);
    expect(buffer.fill).toBeGreaterThan(1440 - BLOCK_FRAMES * 2);
  });

  it('a correção de relógio não deforma o som: um tom continua sendo o mesmo tom', () => {
    const buffer = new TickBuffer(1440);
    const out = outputs();
    let phase = 0;
    const tone = () => Math.sin((phase++ * 2 * Math.PI * 440) / 48_000);
    const heard: number[] = [];
    let sequence = 0;
    let produced = 0;
    for (let call = 0; call < 3000; call++) {
      produced += 128 * 1.005;
      while (produced >= BLOCK_FRAMES) {
        buffer.push(tick(sequence++, [{ slot: 0, fill: tone }]));
        produced -= BLOCK_FRAMES;
      }
      if (buffer.pull(out, 128)) heard.push(...out[0]![0]);
    }
    // Sem estalos: a maior diferença entre amostras vizinhas é a de uma senoide de 440 Hz (com folga).
    let biggestJump = 0;
    for (let index = 1; index < heard.length; index++) biggestJump = Math.max(biggestJump, Math.abs(heard[index]! - heard[index - 1]!));
    expect(biggestJump).toBeLessThan(0.07);
    expect(Math.max(...heard.slice(-4800))).toBeGreaterThan(0.99);
  });

  it('quando falta áudio, silencia e só volta depois de encher de novo', () => {
    const buffer = new TickBuffer(960);
    const out = outputs(480);
    buffer.push(tick(0, [{ slot: 0, fill: () => 1 }]));
    buffer.push(tick(1, [{ slot: 0, fill: () => 1 }]));
    expect(buffer.pull(out, 480)).toBe(true);
    expect(buffer.pull(out, 480)).toBe(true);
    expect(buffer.pull(out, 480)).toBe(false);
    buffer.push(tick(2, [{ slot: 0, fill: () => 1 }]));
    expect(buffer.pull(out, 480)).toBe(false);
    buffer.push(tick(3, [{ slot: 0, fill: () => 1 }]));
    expect(buffer.pull(out, 480)).toBe(true);
    expect(buffer.takeStats().underruns).toBe(1);
  });

  it('conta blocos perdidos e recusa mensagens malformadas', () => {
    const buffer = new TickBuffer(480);
    buffer.push(tick(10, [{ slot: 0, fill: () => 0 }]));
    buffer.push(tick(12, [{ slot: 0, fill: () => 0 }]));
    expect(buffer.push(new ArrayBuffer(4))).toBe(false);
    const wrongSize = tick(13, [{ slot: 0, fill: () => 0 }]);
    new DataView(wrongSize).setUint16(4, 123, true);
    expect(buffer.push(wrongSize)).toBe(false);
    const lying = tick(13, [{ slot: 0, fill: () => 0 }]);
    new DataView(lying).setUint8(6, 5);
    expect(buffer.push(lying)).toBe(false);
    expect(buffer.takeStats().lostBlocks).toBe(1);
  });

  it('se o navegador para de consumir, descarta o mais antigo em vez de acumular atraso', () => {
    const buffer = new TickBuffer(480);
    for (let block = 0; block < 300; block++) buffer.push(tick(block, [{ slot: 0, fill: () => block }]));
    expect(buffer.fill).toBeLessThanOrEqual(48_000);
    const out = outputs();
    buffer.pull(out, 128);
    // Depois de descartar o excesso, o que toca é recente (perto do alvo de 10 ms), não de 3 segundos atrás.
    expect(out[0]![0][0]).toBeGreaterThan(290);
    expect(buffer.takeStats().droppedFrames).toBeGreaterThan(0);
  });
});
