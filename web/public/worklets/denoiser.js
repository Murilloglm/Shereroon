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

/**
 * Quanto do som original sobra em cada intensidade.
 *  - `dry`: a mistura fixa do original: o ruído cai, no máximo, `limitDb`.
 *  - `voiceDry`: piso da voz. Em barulho forte a rede neural às vezes confunde a fala com ruído e a apagaria;
 *    enquanto há voz, a saída nunca fica mais que isso abaixo do som original. O original só volta quando a rede
 *    de fato apagou parte da fala; se ela manteve a voz, nada é acrescentado e o ruído continua fora.
 *  - `sensitive`: detecção de voz mais sensível e que demora mais para fechar (modo "Voz prioritária").
 */
export const MODES = {
  leve: { limitDb: 12, dry: 10 ** (-12 / 20), voiceDry: 10 ** (-3 / 20), sensitive: false },
  equilibrado: { limitDb: 24, dry: 10 ** (-24 / 20), voiceDry: 10 ** (-6 / 20), sensitive: false },
  forte: { limitDb: Infinity, dry: 0, voiceDry: 10 ** (-9 / 20), sensitive: false },
  voz: { limitDb: 30, dry: 10 ** (-30 / 20), voiceDry: 10 ** (-1.5 / 20), sensitive: true },
};

/**
 * Presença de voz, quadro a quadro (10 ms), a partir da probabilidade que o RNNoise dá. Em barulho forte essa
 * probabilidade cai bastante mesmo com alguém falando, então ela é comparada com o nível que o próprio
 * ruído provoca (uma linha de base que acompanha as pausas), suavizada, e abre rápido e fecha devagar:
 * o começo e o fim das palavras não são cortados.
 */
export const PRESENCE = {
  // `full`: presença a partir da qual o piso da voz vale inteiro. Nos modos normais chega lá com meia certeza, para
  // proteger o começo das palavras; em "Voz prioritária" (que já antecipa 40 ms) sobe aos poucos, para o ruído
  // não voltar nas pausas entre as palavras.
  normal: { smooth: 0.4, margin: 0.12, span: 0.22, hold: 8, release: 0.15, full: 0.5 },
  sensitive: { smooth: 0.4, margin: 0.07, span: 0.16, hold: 12, release: 0.12, full: 1 },
};

/**
 * Antecipação do modo "Voz prioritária", em quadros de 10 ms. Com ruído muito forte, a rede neural leva algumas
 * dezenas de milissegundos para perceber que a fala começou; segurando o áudio esse tanto, a proteção já está
 * ligada quando a primeira sílaba sai. Custa o mesmo tanto de atraso, por isso só existe nesse modo.
 */
export const VOICE_LOOKAHEAD = 4;

export class VoicePresence {
  constructor() {
    this.smooth = 0;
    this.base = 0.1;
    this.hold = 0;
    this.value = 0;
    this.sensitive = false;
  }

  /** @param {number} probability probabilidade de voz do RNNoise para o quadro */
  update(probability) {
    const p = this.sensitive ? PRESENCE.sensitive : PRESENCE.normal;
    this.smooth += (probability - this.smooth) * p.smooth;
    // Linha de base: desce rápido (pausas) e sobe devagar (~3 s), para não "aprender" uma fala longa.
    this.base += (this.smooth - this.base) * (this.smooth < this.base ? 0.2 : 0.003);
    const raw = Math.min(1, Math.max(0, (this.smooth - this.base - p.margin) / p.span));
    if (raw >= this.value) {
      this.value = raw;
      this.hold = p.hold; // segura um pouco depois do último sinal de voz (o fim das palavras)
    } else if (this.hold > 0) {
      this.hold -= 1;
    } else {
      this.value = Math.max(raw, this.value - p.release);
    }
    return this.value;
  }
}

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
    this.mode = 'equilibrado';
    this.bypass = false;
    this.dryGain = 1; // começa no original e desliza até a intensidade pedida
    this.voicePresence = new VoicePresence();
    /** Energia do último quadro original, para o piso da voz não pular com estalos curtos. */
    this.lastDryPower = null;
    /** Quadros guardados para a antecipação do modo "Voz prioritária" (null nos outros modos). */
    this.ahead = null;
    /** Liga e desliga a proteção da voz (os testes comparam com o filtro sem proteção). */
    this.protection = true;
    this.started = false;
    /** Troca de modo pendente (entrar/sair de "Voz prioritária"), feita com rampa. */
    this.switchTo = null;
    /** Quadros até a rampa de volta depois de uma troca dessas (0 = nada pendente). */
    this.fadeInIn = 0;
    this.capture = null;
    this.onCapture = null;
    this.#resetStats();
  }

  /** Atraso total entre entrada e saída, em amostras (um quadro a mais por quadro de antecipação). */
  get delay() {
    return FRAME + this.engine.delay + (this.mode === 'voz' ? VOICE_LOOKAHEAD * FRAME : 0);
  }

  #resetStats() {
    this.stats = { frames: 0, inPower: 0, outPower: 0, removedPower: 0, voice: 0, presence: 0, busyMs: 0, peakReductionDb: 0 };
  }

  setMode(mode) {
    if (!MODES[mode]) return;
    // Entrar ou sair de "Voz prioritária" muda o atraso em 40 ms: o som desce até zero, o modo troca e o som volta
    // em rampa (sem estalo). As outras trocas são imediatas (a mistura já desliza amostra a amostra).
    const changesDelay = (mode === 'voz') !== (this.mode === 'voz');
    if (changesDelay && this.started) {
      this.switchTo = mode;
      return;
    }
    this.switchTo = null;
    this.#applyMode(mode);
  }

  #applyMode(mode) {
    this.mode = mode;
    this.voicePresence.sensitive = MODES[mode].sensitive;
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

    // Proteção da voz: só o motor de IA dá a probabilidade de voz (o convencional não corta a fala a esse ponto).
    // O valor descreve o quadro que acabou de entrar, que sai no próximo: a proteção abre um pouco antes da voz.
    let presence = this.engine.name === 'ia' && this.protection ? this.voicePresence.update(voice) : 0;
    let dry = this.dryFrame;
    let wet = this.wetFrame;
    if (this.mode === 'voz') {
      // Antecipação: sai o quadro de VOICE_LOOKAHEAD quadros atrás, protegido pelo que se sabe dos quadros seguintes.
      const slots = VOICE_LOOKAHEAD + 1;
      this.ahead ??= { dry: Array.from({ length: slots }, () => new Float32Array(FRAME)), wet: Array.from({ length: slots }, () => new Float32Array(FRAME)), presence: new Float32Array(slots), at: 0 };
      const ahead = this.ahead;
      ahead.dry[ahead.at].set(dry);
      ahead.wet[ahead.at].set(wet);
      ahead.presence[ahead.at] = presence;
      ahead.at = (ahead.at + 1) % slots;
      dry = ahead.dry[ahead.at];
      wet = ahead.wet[ahead.at];
      for (let i = 0; i < slots; i++) presence = Math.max(presence, ahead.presence[i]);
    } else {
      this.ahead = null;
    }
    const dryShare = this.#dryShare(dry, wet, presence, MODES[this.mode]);
    const target = this.bypass ? 1 : dryShare;
    const step = (target - this.dryGain) / FRAME;
    let gain = this.dryGain;
    let inPower = 0;
    let outPower = 0;
    let removedPower = 0;
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
    this.started = true;
    if (this.switchTo) {
      // Rampa para zero neste quadro; o modo novo vale a partir do próximo.
      for (let i = 0; i < FRAME; i++) out[i] *= 1 - (i + 1) / FRAME;
      this.#applyMode(this.switchTo);
      this.switchTo = null;
      // Entrando em "Voz prioritária", os primeiros quadros da antecipação ainda estão vazios.
      this.fadeInIn = this.mode === 'voz' ? VOICE_LOOKAHEAD + 1 : 1;
    } else if (this.fadeInIn > 0) {
      this.fadeInIn -= 1;
      if (this.fadeInIn === 0) for (let i = 0; i < FRAME; i++) out[i] *= (i + 1) / FRAME;
      else out.fill(0);
    }

    if (this.capture) {
      const capture = this.capture;
      capture.dry.set(dry, capture.at);
      // "Processado" na gravação é sempre o filtro na intensidade escolhida, mesmo com a comparação ligada.
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
    stats.presence += presence;
    if (inPower > 1e-9) stats.peakReductionDb = Math.max(stats.peakReductionDb, toDb(inPower) - toDb(outPower));
  }

  /**
   * Quanto do original misturar neste quadro. Sem voz, a mistura fixa do modo. Com voz, só o necessário para a saída
   * não ficar mais de `voiceDry` abaixo do quadro original. Se a rede neural manteve a voz (ruído moderado), a saída
   * já passa do piso e a mistura continua a fixa: falar não traz o ruído de volta. Se ela apagou parte da fala
   * (barulho no nível da voz ou acima), o original volta até esse piso.
   */
  #dryShare(dry, wet, presence, mode) {
    let wetPower = 0;
    let dryPower = 0;
    let diffPower = 0;
    let cross = 0;
    for (let i = 0; i < FRAME; i++) {
      const diff = dry[i] - wet[i];
      wetPower += wet[i] * wet[i];
      dryPower += dry[i] * dry[i];
      diffPower += diff * diff;
      cross += wet[i] * diff;
    }
    // O piso acompanha o original, mas sobe no máximo 6 dB por quadro: um estalo curto no meio da fala (tecla, clique)
    // que a rede tirou não vira "voz apagada" a devolver. A fala sobe mais devagar que isso e não é afetada.
    const previous = this.lastDryPower ?? dryPower;
    this.lastDryPower = dryPower;
    if (presence <= 0 || diffPower <= 1e-12) return mode.dry;
    const floor = mode.voiceDry * Math.min(1, presence / (mode.sensitive ? PRESENCE.sensitive : PRESENCE.normal).full);
    const need = floor * floor * Math.min(dryPower, previous * 4);
    // Energia da saída com uma mistura g: |wet + g·(dry − wet)|² = wetPower + 2g·cross + g²·diffPower.
    if (wetPower + 2 * mode.dry * cross + mode.dry * mode.dry * diffPower >= need) return mode.dry;
    const g = (-cross + Math.sqrt(Math.max(0, cross * cross - diffPower * (wetPower - need)))) / diffPower;
    return Math.min(1, Math.max(mode.dry, g));
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
      /** Quanto a proteção da voz esteve ativa (0 a 1): fala detectada mesmo no meio do ruído. */
      presence: stats.presence / stats.frames,
      cpuPct: (stats.busyMs / (stats.frames * 10)) * 100,
      msPerFrame: stats.busyMs / stats.frames,
      engine: this.engine.name,
    };
  }

  destroy() {
    this.engine.destroy();
  }
}
