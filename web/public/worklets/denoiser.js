// Supressão de ruído, 100% local: nenhum áudio sai da máquina para ser processado.
// Módulo sem dependências: roda dentro do AudioWorklet e também nos testes de unidade.
//
// Dois motores com a mesma interface (quadros de 480 amostras, 48 kHz, mono):
//  - RnnoiseEngine: rede neural RNNoise compilada para WebAssembly (o motor de "IA").
//  - SpectralEngine: supressão convencional por subtração espectral, usada se a IA não carregar.
//
// O Denoiser cuida do resto: enquadramento, intensidade, comparação original/processado sem estalo,
// medições e a gravação de trechos para comparar de ouvido.

export const FRAME = 480;
/**
 * Atraso de cada motor, em amostras. O do RNNoise foi medido com fala real: 479 (não 480).
 * O atraso total do filtro é um quadro (para montar o bloco de 10 ms) mais o do motor: ~20 ms.
 */
export const RNNOISE_DELAY = 479;
export const SPECTRAL_DELAY = 480;

/** Quanto do som original sobra em cada intensidade. O ruído cai, no máximo, o valor em dB. */
export const MODES = {
  leve: { limitDb: 12, dry: 10 ** (-12 / 20) },
  equilibrado: { limitDb: 24, dry: 10 ** (-24 / 20) },
  forte: { limitDb: Infinity, dry: 0 },
};

const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now();

// --- Motor de IA: RNNoise em WebAssembly ----------------------------------------------------------

export class RnnoiseEngine {
  /** @param {WebAssembly.Module} module módulo rnnoise.wasm já compilado */
  constructor(module) {
    let memory = null;
    const instance = new WebAssembly.Instance(module, {
      a: {
        // emscripten_resize_heap: o RNNoise aloca pouco, mas o crescimento fica correto se precisar.
        a: (requested) => {
          const pages = Math.ceil((requested - memory.buffer.byteLength) / 65536);
          try {
            memory.grow(Math.max(0, pages));
            return 1;
          } catch {
            return 0;
          }
        },
        // emscripten_memcpy_big
        b: (dest, src, count) => new Uint8Array(memory.buffer).copyWithin(dest, src, src + count),
      },
    });
    const wasm = instance.exports;
    memory = wasm.c;
    wasm.d(); // construtores estáticos
    // rnnoise_init(estado, modelo) NÃO é chamado: rnnoise_create já inicializa, e chamá-lo sem estado
    // escreve no endereço zero e corrompe os pesos da rede (o filtro vira um fio: não reduz nada).
    this.memory = memory;
    this.processFrame = wasm.j;
    this.destroyState = wasm.h;
    this.free = wasm.i;
    this.state = wasm.f(); // rnnoise_create
    this.inPtr = wasm.g(FRAME * 4);
    this.outPtr = wasm.g(FRAME * 4);
    if (!this.state || !this.inPtr || !this.outPtr) throw new Error('RNNoise não inicializou');
    this.name = 'ia';
    this.delay = RNNOISE_DELAY;
  }

  /** Processa um quadro. Devolve a probabilidade de haver voz nele (0 a 1). */
  process(input, output) {
    // A memória pode ter sido realocada: as "janelas" são recriadas a cada quadro (é barato).
    const heapIn = new Float32Array(this.memory.buffer, this.inPtr, FRAME);
    // O RNNoise trabalha na escala de inteiros de 16 bits.
    for (let i = 0; i < FRAME; i++) heapIn[i] = input[i] * 32768;
    const voice = this.processFrame(this.state, this.outPtr, this.inPtr);
    const heapOut = new Float32Array(this.memory.buffer, this.outPtr, FRAME);
    for (let i = 0; i < FRAME; i++) output[i] = heapOut[i] / 32768;
    return voice;
  }

  destroy() {
    this.destroyState(this.state);
    this.free(this.inPtr);
    this.free(this.outPtr);
  }
}

// --- Motor convencional: subtração espectral -------------------------------------------------------

const FFT_SIZE = 1024;
const WINDOW = FRAME * 2;

/** FFT radix-2 no lugar, sobre vetores de parte real e imaginária. */
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/**
 * Supressão convencional: estima o piso de ruído de cada faixa de frequência (o menor nível visto
 * recentemente) e atenua o que estiver perto dele. Funciona bem com ruído constante (ventilador,
 * chiado); não distingue voz de outros sons como a rede neural faz.
 */
export class SpectralEngine {
  constructor() {
    this.name = 'convencional';
    this.delay = SPECTRAL_DELAY;
    this.window = new Float32Array(WINDOW);
    for (let i = 0; i < WINDOW; i++) this.window[i] = Math.sin((Math.PI * (i + 0.5)) / WINDOW);
    this.previous = new Float32Array(FRAME);
    this.overlap = new Float32Array(FRAME);
    this.re = new Float32Array(FFT_SIZE);
    this.im = new Float32Array(FFT_SIZE);
    const bins = FFT_SIZE / 2 + 1;
    this.power = new Float32Array(bins);
    this.slow = new Float32Array(bins);
    this.floor = new Float32Array(bins).fill(-1);
    this.gain = new Float32Array(bins).fill(1);
  }

  process(input, output) {
    const { re, im, window } = this;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < FRAME; i++) {
      re[i] = this.previous[i] * window[i];
      re[i + FRAME] = input[i] * window[i + FRAME];
    }
    this.previous.set(input);
    fft(re, im, false);

    let kept = 0;
    let total = 0;
    const bins = FFT_SIZE / 2 + 1;
    for (let k = 0; k < bins; k++) {
      const magnitude = re[k] * re[k] + im[k] * im[k];
      this.power[k] = this.power[k] * 0.7 + magnitude * 0.3;
      // O piso de ruído é o menor valor recente de uma média bem lenta (assim fica perto do nível médio do
      // ruído, não dos seus vales). Sobe devagar e desce na hora: acompanha o ruído sem "aprender" a voz.
      this.slow[k] = this.slow[k] * 0.92 + magnitude * 0.08;
      this.floor[k] = this.floor[k] < 0 ? magnitude : Math.min(this.floor[k] * 1.004, this.slow[k]);
      const wanted = Math.max(0.1, 1 - (3 * this.floor[k]) / (this.power[k] + 1e-12));
      // Abre rápido (não corta o começo das sílabas) e fecha devagar (não "bombeia").
      this.gain[k] = wanted > this.gain[k] ? wanted : this.gain[k] * 0.75 + wanted * 0.25;
      const g = this.gain[k];
      re[k] *= g;
      im[k] *= g;
      if (k > 0 && k < bins - 1) {
        re[FFT_SIZE - k] *= g;
        im[FFT_SIZE - k] *= g;
      }
      total += magnitude;
      kept += magnitude * g * g;
    }
    fft(re, im, true);

    for (let i = 0; i < FRAME; i++) {
      output[i] = this.overlap[i] + re[i] * window[i];
      this.overlap[i] = re[i + FRAME] * window[i + FRAME];
    }
    return total > 0 ? Math.min(1, kept / total) : 0;
  }

  destroy() {}
}

// --- Enquadramento, intensidade e medições -----------------------------------------------------------

const toDb = (power) => (power > 1e-12 ? 10 * Math.log10(power) : -120);

export class Denoiser {
  /** @param {{process(input: Float32Array, output: Float32Array): number, name: string, destroy(): void}} engine */
  constructor(engine) {
    this.engine = engine;
    this.inFrame = new Float32Array(FRAME);
    this.filled = 0;
    this.outQueue = new Float32Array(FRAME);
    this.outRead = 0;
    // Os dois últimos quadros de entrada: daqui sai o original atrasado exatamente como a saída do motor.
    this.history = new Float32Array(FRAME * 2);
    this.dryFrame = new Float32Array(FRAME);
    this.wetFrame = new Float32Array(FRAME);
    /** Atraso total entre entrada e saída, em amostras. */
    this.delay = FRAME + engine.delay;
    this.mode = 'equilibrado';
    this.bypass = false;
    this.dryGain = 1; // começa no original e desliza até a intensidade pedida
    this.capture = null;
    this.onCapture = null;
    this.#resetStats();
  }

  #resetStats() {
    this.stats = { frames: 0, inPower: 0, outPower: 0, removedPower: 0, voice: 0, busyMs: 0, peakReductionDb: 0 };
  }

  setMode(mode) {
    if (MODES[mode]) this.mode = mode;
  }

  /** `true` deixa passar o som original (com o mesmo atraso, então ligar e desligar não dá estalo nem salto). */
  setBypass(bypass) {
    this.bypass = bypass === true;
  }

  /** Grava os próximos `seconds` segundos em duas versões (original e processada) para comparar de ouvido. */
  startCapture(seconds) {
    const length = Math.max(1, Math.round(seconds * 100)) * FRAME;
    this.capture = { dry: new Float32Array(length), wet: new Float32Array(length), at: 0 };
  }

  /** Processa `count` amostras mono. A saída sai atrasada exatamente `this.delay` amostras. */
  process(input, output, count) {
    for (let i = 0; i < count; i++) {
      output[i] = this.outQueue[this.outRead++];
      this.inFrame[this.filled++] = input[i];
      if (this.filled === FRAME) {
        this.#frame();
        this.filled = 0;
        this.outRead = 0;
      }
    }
  }

  #frame() {
    const started = now();
    const voice = this.engine.process(this.inFrame, this.wetFrame);
    this.stats.busyMs += now() - started;

    // Original alinhado: a amostra i da saída do motor corresponde à entrada `engine.delay` amostras atrás.
    this.history.copyWithin(0, FRAME);
    this.history.set(this.inFrame, FRAME);
    this.dryFrame.set(this.history.subarray(FRAME - this.engine.delay, FRAME * 2 - this.engine.delay));

    const target = this.bypass ? 1 : MODES[this.mode].dry;
    const step = (target - this.dryGain) / FRAME;
    let gain = this.dryGain;
    let inPower = 0;
    let outPower = 0;
    let removedPower = 0;
    const dry = this.dryFrame;
    const wet = this.wetFrame;
    const out = this.outQueue;
    for (let i = 0; i < FRAME; i++) {
      gain += step;
      const sample = wet[i] + gain * (dry[i] - wet[i]);
      out[i] = sample;
      inPower += dry[i] * dry[i];
      outPower += sample * sample;
      const removed = dry[i] - sample;
      removedPower += removed * removed;
    }
    this.dryGain = target;

    if (this.capture) {
      const capture = this.capture;
      capture.dry.set(dry, capture.at);
      // "Processado" na gravação é sempre o filtro na intensidade escolhida, mesmo com a comparação ligada.
      const dryShare = MODES[this.mode].dry;
      for (let i = 0; i < FRAME; i++) capture.wet[capture.at + i] = wet[i] + dryShare * (dry[i] - wet[i]);
      capture.at += FRAME;
      if (capture.at >= capture.dry.length) {
        this.capture = null;
        this.onCapture?.(capture.dry, capture.wet);
      }
    }

    const stats = this.stats;
    stats.frames += 1;
    stats.inPower += inPower / FRAME;
    stats.outPower += outPower / FRAME;
    stats.removedPower += removedPower / FRAME;
    stats.voice += voice;
    if (inPower > 1e-9) stats.peakReductionDb = Math.max(stats.peakReductionDb, toDb(inPower) - toDb(outPower));
  }

  /**
   * Medições desde a última chamada. `reductionDb` é quanto o filtro baixou o nível (energia de entrada
   * sobre energia de saída); `noiseDb` é o nível do que foi removido; `cpuPct` é a fração de um núcleo
   * gasta, medida de verdade (tempo de processamento sobre tempo de áudio).
   */
  takeStats() {
    const stats = this.stats;
    this.#resetStats();
    if (stats.frames === 0) return null;
    const inPower = stats.inPower / stats.frames;
    const outPower = stats.outPower / stats.frames;
    return {
      inputDb: toDb(inPower),
      outputDb: toDb(outPower),
      reductionDb: Math.max(0, toDb(inPower) - toDb(outPower)),
      peakReductionDb: stats.peakReductionDb,
      noiseDb: toDb(stats.removedPower / stats.frames),
      voice: stats.voice / stats.frames,
      cpuPct: (stats.busyMs / (stats.frames * 10)) * 100,
      msPerFrame: stats.busyMs / stats.frames,
      engine: this.engine.name,
    };
  }

  destroy() {
    this.engine.destroy();
  }
}
