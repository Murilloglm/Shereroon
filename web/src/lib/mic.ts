import { PeakMeter } from './audio.ts';

export interface MicSettings {
  deviceId: string | null;
  /** Cancelamento de eco do navegador: impede que o som da sala volte pelo seu microfone. */
  echoCancellation: boolean;
  /** Supressão de ruído convencional do navegador. Fica desligada quando a supressão por IA está ativa. */
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** Volume de envio, de 0 a 1. Não muda o que você escuta. */
  gain: number;
}

export const DEFAULT_MIC: MicSettings = {
  deviceId: null,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  gain: 1,
};

export class MicError extends Error {}

/**
 * Microfone → (processador opcional) → ganho → medidor → faixa de saída.
 * A faixa de saída é sempre a mesma, então trocar de aparelho ou de filtro não
 * exige republicar nada na sala.
 */
export class MicPipeline {
  readonly output: MediaStreamTrack;
  readonly meter: PeakMeter;
  readonly #ctx: AudioContext;
  readonly #gain: GainNode;
  #raw: MediaStream | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #processor: { input: AudioNode; output: AudioNode } | null = null;

  constructor(ctx: AudioContext) {
    this.#ctx = ctx;
    this.#gain = ctx.createGain();
    this.meter = new PeakMeter(ctx);
    const destination = ctx.createMediaStreamDestination();
    this.#gain.connect(this.meter.node);
    this.#gain.connect(destination);
    this.output = destination.stream.getAudioTracks()[0]!;
  }

  get active(): boolean {
    return this.#raw !== null;
  }

  /** Rótulo e id do aparelho realmente em uso. */
  get device(): { id: string | null; label: string } | null {
    const track = this.#raw?.getAudioTracks()[0];
    return track ? { id: track.getSettings().deviceId ?? null, label: track.label } : null;
  }

  async start(settings: MicSettings): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: settings.deviceId ? { exact: settings.deviceId } : undefined,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
          channelCount: 1,
        },
      });
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name === 'NotAllowedError') throw new MicError('O navegador bloqueou o microfone. Libere a permissão no cadeado da barra de endereço.');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicError('Nenhum microfone encontrado (ou o escolhido foi desconectado).');
      throw new MicError('Não foi possível abrir o microfone. Outro programa pode estar usando o aparelho.');
    }
    this.#release();
    this.#raw = stream;
    this.#source = this.#ctx.createMediaStreamSource(stream);
    this.#gain.gain.value = settings.gain;
    this.#wire();
  }

  stop(): void {
    this.#release();
  }

  setGain(value: number): void {
    this.#gain.gain.setTargetAtTime(Math.min(1, Math.max(0, value)), this.#ctx.currentTime, 0.015);
  }

  /** Coloca (ou tira, com null) um processador entre o microfone e o ganho. */
  setProcessor(processor: { input: AudioNode; output: AudioNode } | null): void {
    this.#processor?.output.disconnect(this.#gain);
    this.#processor = processor;
    this.#wire();
  }

  #wire(): void {
    if (!this.#source) return;
    this.#source.disconnect();
    if (this.#processor) {
      this.#source.connect(this.#processor.input);
      try {
        this.#processor.output.disconnect(this.#gain);
      } catch {
        // ainda não estava ligado
      }
      this.#processor.output.connect(this.#gain);
    } else {
      this.#source.connect(this.#gain);
    }
  }

  #release(): void {
    this.#source?.disconnect();
    this.#source = null;
    for (const track of this.#raw?.getTracks() ?? []) track.stop();
    this.#raw = null;
  }
}
