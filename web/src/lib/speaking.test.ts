import { describe, expect, it } from 'vitest';
import { SPEECH, SpeechDetector } from './speaking.ts';

const VOICE = 0.05; // cerca de -26 dBFS
const BREATH = 0.01; // entre os limiares: não acende, mas também não começa a apagar
const SILENCE = 0.001;
const TICK = 40;

describe('SpeechDetector', () => {
  it('acende no primeiro bloco com voz, sem esperar média', () => {
    const detector = new SpeechDetector();
    expect(detector.update(SILENCE, 0)).toBe(false);
    expect(detector.update(VOICE, TICK)).toBe(true);
  });

  it('não pisca nas pausas curtas entre palavras', () => {
    const detector = new SpeechDetector();
    detector.update(VOICE, 0);
    for (let t = TICK; t <= 240; t += TICK) expect(detector.update(SILENCE, t)).toBe(true);
    expect(detector.update(VOICE, 280)).toBe(true);
  });

  it('apaga depois do tempo de espera em silêncio', () => {
    const detector = new SpeechDetector();
    detector.update(VOICE, 0);
    let off: number | null = null;
    for (let t = TICK; t <= 1000 && off === null; t += TICK) if (!detector.update(SILENCE, t)) off = t;
    // O silêncio começa no primeiro bloco depois da voz; apaga em até um bloco após o tempo de espera.
    expect(off).not.toBeNull();
    expect(off! - TICK).toBeGreaterThanOrEqual(SPEECH.holdMs);
    expect(off! - TICK).toBeLessThanOrEqual(SPEECH.holdMs + TICK);
  });

  it('ruído constante acima do limiar (ventilador a −30 dBFS, sem filtro): o anel apaga e só a voz acende de novo', () => {
    const NOISE = 0.0316; // −30 dBFS
    const LOUD_VOICE = 0.12; // −18 dBFS, voz por cima do ruído
    const detector = new SpeechDetector();
    let t = 0;
    for (; t <= 3000; t += TICK) detector.update(NOISE, t);
    expect(detector.update(NOISE, t)).toBe(false);
    // A voz acima do ruído acende no mesmo bloco, sem esperar.
    expect(detector.update(LOUD_VOICE, (t += TICK))).toBe(true);
    // Fala com pausas curtas no meio do ruído: continua acesa.
    for (let i = 0; i < 40; i++) expect(detector.update(i % 8 < 6 ? LOUD_VOICE : NOISE, (t += TICK))).toBe(true);
    // E apaga quando a pessoa para de falar.
    let off = false;
    for (let i = 0; i < 20 && !off; i++) off = !detector.update(NOISE, (t += TICK));
    expect(off).toBe(true);
  });

  it('histerese: nível entre os limiares mantém aceso mas não acende sozinho', () => {
    const detector = new SpeechDetector();
    expect(detector.update(BREATH, 0)).toBe(false);
    detector.update(VOICE, TICK);
    for (let t = 2 * TICK; t <= 2000; t += TICK) expect(detector.update(BREATH, t)).toBe(true);
  });
});
