/**
 * Detector de fala para o indicador em volta do avatar. Acende no primeiro bloco acima do limiar (sem
 * esperar média) e só apaga depois de um tempo abaixo do limiar de desligar: pausas curtas entre palavras
 * não fazem o anel piscar. Os níveis são RMS linear de 0 a 1 (1 = 0 dBFS), o mesmo que o WebRTC informa
 * em `audioLevel` para cada pacote recebido.
 */
export interface SpeechOptions {
  /** Nível que acende o indicador. */
  on: number;
  /** Nível abaixo do qual a contagem para apagar começa (menor que `on`: histerese). */
  off: number;
  /** Quanto tempo abaixo de `off` até apagar, em milissegundos. */
  holdMs: number;
}

/** -36 dBFS acende, -42 dBFS conta para apagar, 320 ms de pausa apagam. */
export const SPEECH: SpeechOptions = { on: 0.0158, off: 0.0079, holdMs: 320 };

/** Janela do piso de ruído: o menor nível dos últimos ~2 s (50 leituras de 40 ms). */
const FLOOR_WINDOW = 50;

export class SpeechDetector {
  speaking = false;
  #quietSince: number | null = null;
  readonly #options: SpeechOptions;
  readonly #recent = new Float32Array(FLOOR_WINDOW).fill(Infinity);
  #recentAt = 0;
  #readings = 0;

  constructor(options: SpeechOptions = SPEECH) {
    this.#options = options;
  }

  /**
   * Recebe um nível e o horário (ms). Devolve se a pessoa está falando agora.
   * Limiar adaptativo: se o próprio ruído de fundo (o menor nível dos últimos ~2 s) já passa do limiar de acender
   * (um ventilador alto sem supressão, por exemplo), os limiares sobem para ficar acima dele (+6 dB para acender,
   * +3 dB para apagar). Assim o anel não fica aceso o tempo todo, e acender continua instantâneo.
   */
  update(level: number, now: number): boolean {
    this.#recent[this.#recentAt] = level;
    this.#recentAt = (this.#recentAt + 1) % FLOOR_WINDOW;
    this.#readings += 1;
    let floor = Infinity;
    for (let i = 0; i < FLOOR_WINDOW; i++) if (this.#recent[i]! < floor) floor = this.#recent[i]!;
    // Só depois de ~1 s de leituras: antes disso, o "piso" ainda pode ser a própria voz.
    const noisy = this.#readings >= FLOOR_WINDOW / 2 && floor > this.#options.on;
    const on = noisy ? floor * 2 : this.#options.on;
    const off = noisy ? floor * 1.4 : this.#options.off;
    const { holdMs } = this.#options;
    if (level >= on) {
      this.speaking = true;
      this.#quietSince = null;
    } else if (this.speaking) {
      if (level >= off) {
        this.#quietSince = null;
      } else {
        this.#quietSince ??= now;
        if (now - this.#quietSince >= holdMs) {
          this.speaking = false;
          this.#quietSince = null;
        }
      }
    }
    return this.speaking;
  }

  reset(): void {
    this.speaking = false;
    this.#quietSince = null;
  }
}
