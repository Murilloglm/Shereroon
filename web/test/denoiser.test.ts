// Testes da supressão de ruído com áudio de verdade: uma frase em português (sintetizada localmente pela
// voz do Windows, em test/fixtures/voz.wav) misturada com ruídos gerados aqui. Medem latência, qualidade
// de voz e consumo de processamento do mesmo código que roda no navegador.
//
// A qualidade é medida como se ouve, não pela forma de onda (o filtro altera fase e ganho por faixa de
// frequência, então a onda muda mesmo quando o som é o mesmo): quanto o ruído cai nas PAUSAS da fala,
// se o nível da voz se mantém nos trechos FALADOS e se algum trecho de voz foi cortado.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Denoiser, FRAME, MODES, RNNOISE_DELAY, RnnoiseEngine, SPECTRAL_DELAY, SpectralEngine, VOICE_LOOKAHEAD } from '../public/worklets/denoiser.js';

const RATE = 48_000;
const IA_DELAY = FRAME + RNNOISE_DELAY;
const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
type Mode = keyof typeof MODES;

let wasm: WebAssembly.Module;
let voice: Float32Array;
/** Para cada quadro de 10 ms da fala limpa: true = alguém falando, false = pausa, null = transição. */
let spoken: (boolean | null)[];

function readWav(path: string): Float32Array {
  const bytes = readFileSync(path);
  const data = bytes.indexOf('data', 12, 'ascii');
  const length = bytes.readUInt32LE(data + 4) / 2;
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) samples[i] = bytes.readInt16LE(data + 8 + i * 2) / 32768;
  return samples;
}

/** Gerador pseudoaleatório com semente: os testes dão sempre o mesmo resultado. */
function random(seed: number) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
  return () => uniform() + uniform() + uniform() + uniform();
}

const power = (x: Float32Array, from = 0, to = x.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i]! * x[i]!;
  return sum / Math.max(1, to - from);
};
const db = (value: number) => 10 * Math.log10(Math.max(value, 1e-12));

function scaleTo(x: Float32Array, targetDb: number): Float32Array {
  const gain = Math.sqrt(10 ** (targetDb / 10) / power(x));
  return x.map((sample) => sample * gain);
}

/** Chiado de microfone/pré-amplificador: ruído com energia até uns 8 kHz. */
function hiss(length: number): Float32Array {
  const next = random(1);
  let a = 0;
  let b = 0;
  return Float32Array.from({ length }, () => {
    a += 0.6 * (next() - a);
    b += 0.6 * (a - b);
    return b;
  });
}

/** Ventilador: ruído grave e constante mais um zumbido de 120 Hz. */
function fan(length: number): Float32Array {
  const next = random(7);
  let low = 0;
  return Float32Array.from({ length }, (_, i) => {
    low += 0.03 * (next() - low);
    return low * 6 + 0.02 * Math.sin((2 * Math.PI * 120 * i) / RATE);
  });
}

/** Teclado mecânico: estalos curtos e agudos, vários por segundo, em intervalos irregulares. */
function keyboard(length: number): Float32Array {
  const next = random(42);
  const out = new Float32Array(length);
  for (let at = 2000; at < length - 1000; at += Math.round(RATE * (0.13 + Math.abs(next()) * 0.1))) {
    for (let i = 0; i < 700; i++) out[at + i] = next() * Math.exp(-i / 90);
  }
  return out;
}

/** Ambiente: vozerio distante e abafado (várias cópias da própria fala, atrasadas e filtradas) mais um fundo grave. */
function ambience(length: number): Float32Array {
  const out = fan(length).map((sample) => sample * 0.3);
  for (const [delay, gain] of [[0.37, 0.5], [0.91, 0.4], [1.53, 0.35]] as const) {
    let low = 0;
    const shift = Math.round(delay * RATE);
    for (let i = 0; i < length; i++) {
      low += 0.08 * ((voice[(i + shift) % voice.length] ?? 0) - low);
      out[i] = out[i]! + low * gain;
    }
  }
  return out;
}

const add = (a: Float32Array, b: Float32Array) => a.map((sample, i) => sample + (b[i] ?? 0));

/** Passa um sinal pelo filtro em blocos de 128 amostras, como o navegador faz. */
function run(engine: 'ia' | 'convencional', mode: Mode, input: Float32Array, each?: (denoiser: Denoiser, block: number) => void, protection = true) {
  const denoiser = new Denoiser(engine === 'ia' ? new RnnoiseEngine(wasm) : new SpectralEngine());
  denoiser.setMode(mode);
  denoiser.protection = protection;
  const output = new Float32Array(input.length);
  const started = performance.now();
  for (let at = 0, block = 0; at + 128 <= input.length; at += 128, block++) {
    each?.(denoiser, block);
    denoiser.process(input.subarray(at, at + 128), output.subarray(at, at + 128), 128);
  }
  const elapsedMs = performance.now() - started;
  const stats = denoiser.takeStats();
  const delay = denoiser.delay as number;
  denoiser.destroy();
  return { output, elapsedMs, stats, delay };
}

/**
 * Quanto do ruído original volta na saída durante a fala (dB em relação ao ruído original), pela parte do original
 * que o filtro mistura de volta. Mede exatamente o que a proteção da voz acrescenta de ruído.
 */
function noiseBackInSpeech(input: Float32Array, noise: Float32Array, mode: Mode) {
  const gains = new Float32Array(input.length);
  const { delay } = run('ia', mode, input, (denoiser, block) => gains.fill(denoiser.dryGain as number, block * 128, block * 128 + 128));
  let back = 0;
  let original = 0;
  for (let frame = 100; frame < spoken.length - 3 - Math.ceil(delay / FRAME); frame++) {
    if (spoken[frame] !== true) continue;
    const from = frame * FRAME;
    for (let i = 0; i < FRAME; i++) {
      back += (gains[from + delay + i]! * noise[from + i]!) ** 2;
      original += noise[from + i]! ** 2;
    }
  }
  return db(back) - db(original);
}

/** Atraso (em amostras) que melhor alinha a saída com a entrada. */
function bestLag(input: Float32Array, output: Float32Array): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = 0; lag <= 2400; lag++) {
    let score = 0;
    for (let i = RATE; i < RATE * 4; i += 3) score += input[i]! * output[i + lag]!;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

/** Mede a saída nos trechos falados e nas pausas (definidos pela fala limpa), descontando o atraso do filtro. */
function measure(output: Float32Array, delay: number, reference: Float32Array) {
  let speech = 0;
  let speechRef = 0;
  let speechFrames = 0;
  let pause = 0;
  let pauseFrames = 0;
  let cuts = 0;
  // Até onde a saída (atrasada) ainda existe.
  for (let frame = 100; frame < spoken.length - 3 - Math.ceil(delay / FRAME); frame++) {
    const from = frame * FRAME;
    const out = power(output, from + delay, from + delay + FRAME);
    if (spoken[frame] === true) {
      const ref = power(reference, from, from + FRAME);
      speech += out;
      speechRef += ref;
      speechFrames += 1;
      // "Corte": um trecho de voz que saiu mais de 10 dB abaixo do original.
      if (db(out) < db(ref) - 10) cuts += 1;
    } else if (spoken[frame] === false) {
      pause += out;
      pauseFrames += 1;
    }
  }
  return {
    voiceChangeDb: db(speech / speechFrames) - db(speechRef / speechFrames),
    pauseDb: db(pause / pauseFrames),
    cutsPct: (cuts / speechFrames) * 100,
  };
}

beforeAll(() => {
  wasm = new WebAssembly.Module(readFileSync(file('../public/worklets/rnnoise.wasm')));
  voice = scaleTo(readWav(file('./fixtures/voz.wav')).subarray(0, RATE * 9), -23);
  // Quadro "falado" = energia alta; "pausa" = energia muito baixa E longe de qualquer fala (sem bordas de sílaba).
  const levels = Array.from({ length: Math.floor(voice.length / FRAME) }, (_, frame) => db(power(voice, frame * FRAME, (frame + 1) * FRAME)));
  spoken = levels.map((level, frame) => {
    if (level > -35) return true;
    const nearby = levels.slice(Math.max(0, frame - 12), frame + 13);
    return nearby.every((value) => value < -55) ? false : null;
  });
});

describe('a amostra de voz serve para o teste', () => {
  it('tem trechos falados e pausas suficientes', () => {
    expect(spoken.filter((value) => value === true).length).toBeGreaterThan(200);
    expect(spoken.filter((value) => value === false).length).toBeGreaterThan(40);
  });
});

describe('latência', () => {
  it('o filtro de IA atrasa o áudio em 959 amostras (20 ms), em qualquer intensidade', () => {
    expect(IA_DELAY).toBe(959);
    for (const mode of ['leve', 'equilibrado', 'forte'] as const) {
      const { output, delay } = run('ia', mode, voice);
      expect(delay).toBe(959);
      expect(bestLag(voice, output)).toBe(959);
    }
  });

  it('"Voz prioritária" antecipa 40 ms: atrasa 959 + 1920 amostras (60 ms)', () => {
    const { output, delay } = run('ia', 'voz', voice);
    expect(delay).toBe(IA_DELAY + VOICE_LOOKAHEAD * FRAME);
    expect(delay).toBe(2879);
    // A voz limpa sai igual, só mais atrasada.
    let lagScore = -Infinity;
    let lag = 0;
    for (let candidate = 2700; candidate <= 3000; candidate++) {
      let score = 0;
      for (let i = RATE; i < RATE * 4; i += 3) score += voice[i]! * output[i + candidate]!;
      if (score > lagScore) {
        lagScore = score;
        lag = candidate;
      }
    }
    expect(lag).toBe(2879);
  });

  it('o motor convencional atrasa 960 amostras', () => {
    const { output, delay } = run('convencional', 'forte', voice);
    expect(delay).toBe(FRAME + SPECTRAL_DELAY);
    expect(bestLag(voice, output)).toBe(960);
  });
});

describe('qualidade de voz (motor de IA)', () => {
  it('voz limpa: mesmo nível e nenhum trecho cortado, em qualquer intensidade', () => {
    for (const mode of ['leve', 'equilibrado', 'forte'] as const) {
      const { output, delay } = run('ia', mode, voice);
      const result = measure(output, delay, voice);
      console.log(`  voz limpa, ${mode}: nível da voz ${result.voiceChangeDb.toFixed(2)} dB, trechos cortados ${result.cutsPct.toFixed(1)}%`);
      expect(Math.abs(result.voiceChangeDb)).toBeLessThan(1);
      expect(result.cutsPct).toBeLessThan(1);
    }
  });

  const scenarios: [string, (length: number) => Float32Array, number, number][] = [
    // nome, gerador, nível do ruído (dBFS), redução mínima exigida no modo forte (dB)
    ['chiado', hiss, -38, 15],
    ['ventilador', fan, -32, 20],
    ['teclado mecânico', keyboard, -34, 6],
    ['som ambiente', ambience, -36, 8],
  ];

  for (const [name, make, level, minimum] of scenarios) {
    it(`voz com ${name}: o ruído cai nas pausas e a voz não é cortada`, () => {
      const noise = scaleTo(make(voice.length), level);
      const noisy = add(voice, noise);
      const before = measure(noisy, 0, voice);
      const line: string[] = [];
      const reductions: Record<string, number> = {};
      for (const mode of ['leve', 'equilibrado', 'forte'] as const) {
        const { output, delay } = run('ia', mode, noisy);
        const after = measure(output, delay, voice);
        reductions[mode] = before.pauseDb - after.pauseDb;
        line.push(`${mode} −${reductions[mode]!.toFixed(1)} dB (voz ${after.voiceChangeDb.toFixed(1)} dB, cortes ${after.cutsPct.toFixed(1)}%)`);
        // A voz continua lá: nível dentro de 2,5 dB do original e quase nenhum trecho cortado.
        expect(Math.abs(after.voiceChangeDb)).toBeLessThan(2.5);
        expect(after.cutsPct).toBeLessThan(3);
      }
      console.log(`  ${name} (ruído nas pausas): ${line.join(' | ')}`);
      // Cada intensidade respeita o seu teto: é o que mantém o som natural nos modos mais suaves.
      expect(reductions.leve!).toBeGreaterThan(Math.min(minimum, 12) * 0.6);
      expect(reductions.leve!).toBeLessThan(12.5);
      expect(reductions.equilibrado!).toBeGreaterThan(reductions.leve!);
      expect(reductions.equilibrado!).toBeLessThan(24.5);
      expect(reductions.forte!).toBeGreaterThan(minimum);
      expect(reductions.forte!).toBeGreaterThanOrEqual(reductions.equilibrado! - 0.5);
    });
  }
});

describe('ambiente barulhento (ruído no nível da voz ou acima dela)', () => {
  // O problema relatado: com muito barulho em volta, o filtro tirava pedaços da voz junto com o ruído. Aqui a voz
  // fica no nível do ruído (0 dB) e abaixo dele (−5 dB). A proteção da voz mistura parte do original enquanto há
  // fala; o modo "Voz prioritária" ainda antecipa 40 ms para proteger o começo das palavras.
  const noises: [string, (length: number) => Float32Array, number][] = [
    // nome, gerador, redução mínima exigida nas pausas no modo Equilibrado (dB)
    ['ventilador', fan, 15],
    ['chiado', hiss, 15],
    ['som ambiente com vozes ao fundo', ambience, 10],
  ];
  // Trechos de voz cortados (mais de 10 dB abaixo do original) tolerados em cada modo.
  const maxCuts: Record<number, Record<'leve' | 'equilibrado' | 'forte' | 'voz', number>> = {
    0: { leve: 0.5, equilibrado: 2.5, forte: 2.5, voz: 0.5 },
    [-5]: { leve: 0.5, equilibrado: 5, forte: 8, voz: 1.5 },
  };
  for (const [name, make, minimum] of noises) {
    for (const snr of [0, -5]) {
      it(`${name}, voz ${snr} dB em relação ao ruído: a voz fica e o ruído das pausas cai`, () => {
        const noisy = add(voice, scaleTo(make(voice.length), -23 - snr));
        const before = measure(noisy, 0, voice);
        const line: string[] = [];
        const reductions: Record<string, number> = {};
        for (const mode of ['leve', 'equilibrado', 'forte', 'voz'] as const) {
          const { output, delay } = run('ia', mode, noisy);
          const after = measure(output, delay, voice);
          reductions[mode] = before.pauseDb - after.pauseDb;
          line.push(`${mode} −${reductions[mode]!.toFixed(1)} dB (voz ${after.voiceChangeDb.toFixed(1)} dB, cortes ${after.cutsPct.toFixed(1)}%)`);
          expect(after.cutsPct, `${mode}: trechos de voz cortados`).toBeLessThan(maxCuts[snr]![mode]);
          // O Forte com o ruído acima da voz é o único que baixa mais o nível: ele só devolve o original até 9 dB abaixo
          // (os outros, até 6, 3 e 1,5). A 0.3.1 dava −1,4 dB aqui porque devolvia o ruído o tempo todo, e esse ruído
          // entrava na conta como se fosse voz; os cortes de agora são os mesmos dela.
          expect(after.voiceChangeDb, `${mode}: nível da voz`).toBeGreaterThan(mode === 'forte' && snr === -5 ? -4.5 : -2.5);
        }
        console.log(`  ${name}, voz ${snr} dB: ${line.join(' | ')}`);
        expect(reductions.equilibrado!).toBeGreaterThan(minimum);
        expect(reductions.forte!).toBeGreaterThanOrEqual(reductions.equilibrado! - 0.5);
        // "Voz prioritária" troca parte da redução por voz preservada (detecção mais sensível, solta mais devagar).
        expect(reductions.voz!).toBeGreaterThan(minimum * 0.6);
      });
    }
  }

  it('com ruído moderado, falar não traz o ruído de volta: a proteção só age quando a voz está sendo apagada', () => {
    // O defeito da 0.3.1: a proteção misturava o original (−3/−6/−9 dB) sempre que havia fala, mesmo quando a rede
    // neural mantinha a voz inteira. O ruído "respirava": sumia nas pausas e voltava junto com a fala.
    for (const [make, level] of [[fan, -32], [ambience, -36], [keyboard, -34], [hiss, -38]] as const) {
      const noise = scaleTo(make(voice.length), level);
      const noisy = add(voice, noise);
      const line: string[] = [];
      for (const mode of ['leve', 'equilibrado', 'forte'] as const) {
        const back = noiseBackInSpeech(noisy, noise, mode);
        line.push(`${mode} ${back.toFixed(1)} dB`);
        // No máximo 3 dB acima da mistura fixa de cada modo (−12, −24 e, no Forte, nada). A 0.3.1 dava −3, −6 e −9.
        // O teclado testa os estalos no meio da fala: a rede os tira, e a proteção não pode devolvê-los.
        const limit = mode === 'forte' ? -28 : 20 * Math.log10(MODES[mode].dry) + 3;
        expect(back, `${make.name}, ${mode}: ruído devolvido durante a fala`).toBeLessThan(limit);
      }
      console.log(`  ${make.name} moderado, ruído devolvido durante a fala: ${line.join(' | ')}`);
    }
  });

  it('a proteção da voz é o que evita os cortes: sem ela, o mesmo filtro corta muito mais', () => {
    for (const make of [fan, ambience]) {
      const noisy = add(voice, scaleTo(make(voice.length), -18));
      for (const mode of ['equilibrado', 'forte'] as const) {
        const protectedRun = run('ia', mode, noisy);
        const bare = run('ia', mode, noisy, undefined, false);
        const withProtection = measure(protectedRun.output, protectedRun.delay, voice).cutsPct;
        const without = measure(bare.output, bare.delay, voice).cutsPct;
        console.log(`  ${make.name}, ${mode}: cortes sem proteção ${without.toFixed(1)}% → com proteção ${withProtection.toFixed(1)}%`);
        expect(without).toBeGreaterThan(8);
        expect(withProtection).toBeLessThan(without / 2);
      }
    }
  });
});

describe('comparação original × processado', () => {
  it('em modo original, a saída é idêntica à entrada (só atrasada)', () => {
    const { output, delay } = run('ia', 'forte', voice, (denoiser) => denoiser.setBypass(true));
    let worst = 0;
    for (let i = RATE; i < voice.length - delay - 128; i++) worst = Math.max(worst, Math.abs(output[i + delay]! - voice[i]!));
    expect(worst).toBeLessThan(1e-6);
  });

  it('alternar entre original e processado não dá estalo', () => {
    const noisy = add(voice, scaleTo(hiss(voice.length), -38));
    const { output } = run('ia', 'forte', noisy, (denoiser, block) => denoiser.setBypass(Math.floor(block / 150) % 2 === 1));
    const original = run('ia', 'forte', noisy, (denoiser) => denoiser.setBypass(true)).output;
    // O maior salto entre amostras vizinhas não passa do que o próprio áudio original já tem.
    const jump = (x: Float32Array) => {
      let worst = 0;
      for (let i = RATE; i < x.length - 1; i++) worst = Math.max(worst, Math.abs(x[i + 1]! - x[i]!));
      return worst;
    };
    expect(jump(output)).toBeLessThanOrEqual(jump(original) * 1.05);
  });

  it('entrar e sair de "Voz prioritária" (que muda o atraso) não dá estalo', () => {
    const noisy = add(voice, scaleTo(hiss(voice.length), -38));
    const modes = ['equilibrado', 'voz', 'forte', 'voz', 'leve'] as const;
    const { output } = run('ia', 'equilibrado', noisy, (denoiser, block) => denoiser.setMode(modes[Math.floor(block / 300) % modes.length]!));
    const original = run('ia', 'forte', noisy, (denoiser) => denoiser.setBypass(true)).output;
    const jump = (x: Float32Array) => {
      let worst = 0;
      for (let i = RATE; i < x.length - 1; i++) worst = Math.max(worst, Math.abs(x[i + 1]! - x[i]!));
      return worst;
    };
    expect(jump(output)).toBeLessThanOrEqual(jump(original) * 1.05);
  });

  it('grava as duas versões do mesmo trecho para comparar de ouvido', () => {
    const noisy = add(voice, scaleTo(fan(voice.length), -30));
    let captured: { dry: Float32Array; wet: Float32Array } | null = null;
    run('ia', 'forte', noisy, (denoiser, block) => {
      if (block === 400) {
        denoiser.onCapture = (dry: Float32Array, wet: Float32Array) => (captured = { dry, wet });
        denoiser.startCapture(2);
      }
    });
    expect(captured).not.toBeNull();
    expect(captured!.dry.length).toBe(RATE * 2);
    // O "original" gravado é exatamente o que entrou; o "processado" tem menos energia (o ruído saiu).
    expect(power(captured!.wet)).toBeLessThan(power(captured!.dry) * 0.9);
  });
});

describe('consumo de processamento', () => {
  it('o motor de IA usa uma fração pequena de um núcleo', () => {
    const long = new Float32Array(RATE * 30);
    for (let at = 0; at < long.length; at += voice.length) long.set(voice.subarray(0, Math.min(voice.length, long.length - at)), at);
    const { elapsedMs, stats } = run('ia', 'equilibrado', add(long, scaleTo(fan(long.length), -32)));
    const share = (elapsedMs / 30_000) * 100;
    console.log(`  30 s de áudio em ${elapsedMs.toFixed(0)} ms: ${share.toFixed(2)}% de um núcleo, ${stats!.msPerFrame.toFixed(3)} ms por quadro de 10 ms`);
    expect(share).toBeLessThan(10);
    expect(stats!.msPerFrame).toBeLessThan(1);
    expect(stats!.engine).toBe('ia');
  });

  it('as medições mostradas na tela refletem o que o filtro fez', () => {
    const quiet = run('ia', 'forte', scaleTo(fan(RATE * 4), -32)).stats!;
    expect(quiet.reductionDb).toBeGreaterThan(15);
    expect(quiet.noiseDb).toBeGreaterThan(-40);
    expect(quiet.voice).toBeLessThan(0.2);
    const talking = run('ia', 'forte', voice).stats!;
    expect(talking.voice).toBeGreaterThan(quiet.voice + 0.2);
    // Medidor de "voz protegida": sobe quando há fala e fica perto de zero só com ruído.
    expect(talking.presence).toBeGreaterThan(0.3);
    expect(quiet.presence).toBeLessThan(0.1);
    expect(talking.reductionDb).toBeLessThan(3);
    expect(talking.cpuPct).toBeGreaterThan(0);
  });
});

describe('motor convencional (usado se a IA não carregar)', () => {
  it('reduz ruído constante sem cortar a voz, ainda que menos que a IA', () => {
    const noisy = add(voice, scaleTo(fan(voice.length), -32));
    const before = measure(noisy, 0, voice);
    const conventional = run('convencional', 'forte', noisy);
    const after = measure(conventional.output, conventional.delay, voice);
    const ia = run('ia', 'forte', noisy);
    const iaReduction = before.pauseDb - measure(ia.output, ia.delay, voice).pauseDb;
    const reduction = before.pauseDb - after.pauseDb;
    console.log(`  ventilador, convencional: −${reduction.toFixed(1)} dB (IA: −${iaReduction.toFixed(1)} dB), voz ${after.voiceChangeDb.toFixed(1)} dB, cortes ${after.cutsPct.toFixed(1)}%`);
    expect(reduction).toBeGreaterThan(6);
    expect(reduction).toBeLessThan(iaReduction);
    expect(Math.abs(after.voiceChangeDb)).toBeLessThan(3);
    expect(after.cutsPct).toBeLessThan(5);
    expect(conventional.stats!.engine).toBe('convencional');
  });
});
