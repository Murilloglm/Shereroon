/**
 * Sincronia do áudio dos aplicativos com o vídeo da tela, do lado de quem assiste.
 *
 * O vídeo da tela recebe o horário da captura; o áudio vindo do componente de áudio recebe o horário em que
 * entra no navegador, depois da captura do Windows e das filas (medidas por quem transmite). O navegador
 * sincroniza pelos horários, então tocaria o som atrasado exatamente esse tanto. A correção é segurar o
 * vídeo o mesmo tanto no buffer de quem assiste (`jitterBufferTarget`). Medido com áudio atrasado de
 * propósito: 150 ms de atraso na origem viram 154 ms de diferença; com a compensação, menos de 15 ms.
 */
export interface AvSyncReading {
  /** Tempo médio que os quadros de vídeo esperaram no buffer no último segundo, em ms. */
  videoBufferMs: number | null;
  /** Atraso do áudio antes do WebRTC informado por quem transmite, em ms. Null sem áudio de aplicativos. */
  audioDelayMs: number | null;
}

/** Abaixo disso a diferença não se percebe e não vale atrasar a imagem. */
export const MIN_COMPENSATION_MS = 15;
/** Nunca segura a imagem mais que isto, mesmo que o som venha muito atrasado. */
export const MAX_TARGET_MS = 400;
/** Só muda o alvo quando a diferença passa disto: cada mudança mexe no buffer de vídeo. */
const STEP_MS = 8;

export class AvSyncController {
  /** Buffer do vídeo sem compensação (medido antes de aplicar). */
  natural: number | null = null;
  /** Alvo aplicado no buffer do vídeo, em ms (null = deixar o navegador decidir). */
  target: number | null = null;
  /** Quanto a imagem está sendo segurada a mais, em ms (o que o diagnóstico mostra). */
  compensationMs = 0;

  /** Devolve o alvo que deve estar aplicado depois desta leitura. */
  update({ videoBufferMs, audioDelayMs }: AvSyncReading): number | null {
    if (audioDelayMs === null || audioDelayMs < MIN_COMPENSATION_MS) {
      this.target = null;
      this.compensationMs = 0;
      if (videoBufferMs !== null) this.natural = smooth(this.natural, videoBufferMs);
      return null;
    }
    if (videoBufferMs === null) return this.target;

    if (this.target === null) {
      // Primeira leitura com áudio atrasado: mede o buffer natural e aplica.
      this.natural = smooth(this.natural, videoBufferMs);
      this.target = clamp(this.natural + audioDelayMs);
      this.compensationMs = audioDelayMs;
      return this.target;
    }

    // Malha fechada: o buffer real fica um pouco abaixo do alvo pedido; corrige pela diferença medida.
    const wanted = (this.natural ?? 0) + audioDelayMs;
    const error = wanted - videoBufferMs;
    if (Math.abs(error) >= STEP_MS) this.target = clamp(this.target + error * 0.5);
    this.compensationMs = Math.max(0, videoBufferMs - (this.natural ?? 0));
    return this.target;
  }

  reset(): void {
    this.natural = null;
    this.target = null;
    this.compensationMs = 0;
  }
}

function smooth(previous: number | null, value: number): number {
  return previous === null ? value : previous * 0.7 + value * 0.3;
}

function clamp(ms: number): number {
  return Math.round(Math.min(MAX_TARGET_MS, Math.max(0, ms)));
}
