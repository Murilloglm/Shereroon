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

export class SpeechDetector {
  speaking = false;
  #quietSince: number | null = null;
  readonly #options: SpeechOptions;

  constructor(options: SpeechOptions = SPEECH) {
    this.#options = options;
  }

  /** Recebe um nível e o horário (ms). Devolve se a pessoa está falando agora. */
  update(level: number, now: number): boolean {
    const { on, off, holdMs } = this.#options;
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
