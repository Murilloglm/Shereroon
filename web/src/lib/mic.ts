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

/** Rampa ao mutar e desmutar: curta o bastante para não atrasar a primeira sílaba, longa o bastante para não estalar. */
export const GATE_FADE_MS = 15;
/** Rampa de entrada quando o aparelho acabou de abrir: o controle de ganho do navegador ainda está se ajustando. */
export const OPEN_FADE_MS = 40;

/**
 * Microfone → (processador opcional) → ganho → medidor → porta → faixa de saída.
 * A faixa de saída é sempre a mesma, então trocar de aparelho ou de filtro não exige republicar nada
 * na sala. A porta abre e fecha com rampa: mutar, desmutar, trocar de aparelho e ligar o filtro não estalam.
 * O medidor fica antes da porta, para o teste de microfone mostrar o nível mesmo com o som fechado.
 */
export class MicPipeline {
  readonly output: MediaStreamTrack;
  readonly meter: PeakMeter;
  readonly #ctx: AudioContext;
  readonly #gain: GainNode;
  readonly #gate: GainNode;
  #open = false;
  #raw: MediaStream | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #processor: { input: AudioNode; output: AudioNode } | null = null;

  constructor(ctx: AudioContext) {
    this.#ctx = ctx;
    this.#gain = ctx.createGain();
    this.#gate = ctx.createGain();
    this.#gate.gain.value = 0;
    this.meter = new PeakMeter(ctx);
    const destination = ctx.createMediaStreamDestination();
    this.#gain.connect(this.meter.node);
    this.#gain.connect(this.#gate);
    this.#gate.connect(destination);
    this.output = destination.stream.getAudioTracks()[0]!;
  }

  get active(): boolean {
    return this.#raw !== null;
  }

  /** Se o som do microfone está saindo (porta aberta). */
  get open(): boolean {
    return this.#open;
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
    // Trocar de aparelho com o som aberto: fecha a porta antes de soltar o antigo, para não cortar a onda no meio.
    const wasOpen = this.#open;
    if (this.#raw && wasOpen) await this.#fade(0, GATE_FADE_MS);
    this.#release();
    this.#raw = stream;
    this.#source = this.#ctx.createMediaStreamSource(stream);
    this.#gain.gain.value = settings.gain;
    this.#wire();
    if (wasOpen) await this.#fade(1, OPEN_FADE_MS);
  }

  stop(): void {
    this.#open = false;
    this.#gate.gain.cancelScheduledValues(this.#ctx.currentTime);
    this.#gate.gain.value = 0;
    this.#release();
  }

  /**
   * Abre ou fecha o som com rampa e espera a rampa terminar. Fechar antes de desligar a faixa (e abrir
   * depois de religá-la) é o que evita o estalo de mutar e desmutar.
   */
  async setOpen(open: boolean, fadeMs = GATE_FADE_MS): Promise<void> {
    this.#open = open;
    await this.#fade(open ? 1 : 0, fadeMs);
  }

  setGain(value: number): void {
    this.#gain.gain.setTargetAtTime(Math.min(1, Math.max(0, value)), this.#ctx.currentTime, 0.015);
  }

  /** Coloca (ou tira, com null) um processador entre o microfone e o ganho, com a porta fechada durante a troca. */
  async setProcessor(processor: { input: AudioNode; output: AudioNode } | null): Promise<void> {
    const wasOpen = this.#open && this.#raw !== null;
    if (wasOpen) await this.#fade(0, GATE_FADE_MS);
    try {
      this.#processor?.output.disconnect(this.#gain);
    } catch {
      // não estava ligado
    }
    this.#processor = processor;
    this.#wire();
    if (wasOpen) await this.#fade(1, GATE_FADE_MS);
  }

  /** Rampa linear do valor atual até `target`. Resolve quando ela termina (pelo relógio da página). */
  #fade(target: number, ms: number): Promise<void> {
    const param = this.#gate.gain;
    const now = this.#ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + ms / 1000);
    // Com o contexto de áudio suspenso o relógio dele para; a espera é pelo relógio da página.
    return new Promise((done) => setTimeout(done, ms + 5));
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
