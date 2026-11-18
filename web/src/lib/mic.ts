import { PeakMeter } from './audio.ts';
import { inputSettings, type InputSettings } from './input-settings.ts';

const inputModules = new WeakMap<AudioContext, Promise<void>>();
export interface InputStats { inputDb: number; rawDb: number; thresholdDb: number; noiseDb: number; open: boolean; voice: number }

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
  #sensitivity: AudioWorkletNode | null = null;
  #generation = 0;
  #disposed = false;
  #capture: { resolve: (capture: { dry: Float32Array<ArrayBuffer>; wet: Float32Array<ArrayBuffer> }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  stats: InputStats | null = null;
  settings: MicSettings | null = null;

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
    const generation = ++this.#generation;
    if (this.#disposed) throw new MicError('Teste encerrado.');
    await this.#ensureSensitivity(generation);
    if (generation !== this.#generation || this.#disposed) throw new MicError('Teste encerrado.');
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
    if (generation !== this.#generation) { for (const track of stream.getTracks()) track.stop(); return; }
    // Trocar de aparelho com o som aberto: fecha a porta antes de soltar o antigo, para não cortar a onda no meio.
    const wasOpen = this.#open;
    if (this.#raw && wasOpen) await this.#fade(0, GATE_FADE_MS);
    if (generation !== this.#generation) { for (const track of stream.getTracks()) track.stop(); return; }
    this.#release();
    this.#raw = stream;
    this.settings = settings;
    this.#source = this.#ctx.createMediaStreamSource(stream);
    this.#gain.gain.value = settings.gain;
    this.#wire();
    if (wasOpen) await this.#fade(1, OPEN_FADE_MS);
  }

  stop(): void {
    this.#generation++;
    this.#cancelCapture();
    this.#sensitivity?.port.postMessage({ type: 'reset' });
    this.stats = null;
    this.#open = false;
    this.#gate.gain.cancelScheduledValues(this.#ctx.currentTime);
    this.#gate.gain.value = 0;
    this.#release();
    if (this.#sensitivity) {
      this.#gain.disconnect(this.#sensitivity);
      this.#gain.connect(this.#gate);
      this.#sensitivity.port.postMessage({ type: 'dispose' });
      this.#sensitivity.port.onmessage = null;
      this.#sensitivity.port.close(); this.#sensitivity.disconnect(); this.#sensitivity = null;
    }
  }

  /**
   * Abre ou fecha o som com rampa e espera a rampa terminar. Fechar antes de desligar a faixa (e abrir
   * depois de religá-la) é o que evita o estalo de mutar e desmutar.
   */
  async setOpen(open: boolean, fadeMs = GATE_FADE_MS): Promise<void> {
    this.#open = open;
    if (!open) this.#sensitivity?.port.postMessage({ type: 'reset' });
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
    this.#connectVad();
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
    if (this.#sensitivity) this.#source.connect(this.#sensitivity, 0, 1);
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

  configureInput(settings: InputSettings): void {
    this.#sensitivity?.port.postMessage({ type: 'settings', settings: { ...settings, enabled: settings.profile !== 'studio' && settings.enabled } });
  }

  async #ensureSensitivity(generation: number): Promise<void> {
    if (this.#sensitivity) return;
    let ready = inputModules.get(this.#ctx);
    if (!ready) {
      ready = this.#ctx.audioWorklet.addModule(new URL('worklets/input-processor.js', document.baseURI));
      inputModules.set(this.#ctx, ready);
      ready.catch(() => inputModules.delete(this.#ctx));
    }
    await ready;
    if (generation !== this.#generation) return;
    if (this.#disposed) throw new MicError('Teste encerrado.');
    if (this.#sensitivity) return;
    const settings = inputSettings.get();
    this.#sensitivity = new AudioWorkletNode(this.#ctx, 'cosmic-input', {
      numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { ...settings, enabled: settings.profile !== 'studio' && settings.enabled },
    });
    this.#sensitivity.port.onmessage = ({ data }) => {
      if (data.type === 'stats') this.stats = data.stats;
      if (data.type === 'capture' && this.#capture) {
        const pending = this.#capture; this.#capture = null; clearTimeout(pending.timer);
        pending.resolve({ dry: data.dry, wet: data.wet });
      }
    };
    this.#gain.disconnect(this.#gate);
    this.#gain.connect(this.#sensitivity);
    this.#sensitivity.connect(this.#gate);
    this.#connectVad();
  }

  #connectVad(): void {
    const node = this.#processor?.output;
    if (!(node instanceof AudioWorkletNode) || !this.#sensitivity) {
      this.#sensitivity?.port.postMessage({ type: 'vad-port', port: null });
      return;
    }
    const channel = new MessageChannel();
    node.port.postMessage({ type: 'vad-port', port: channel.port1 }, [channel.port1]);
    this.#sensitivity.port.postMessage({ type: 'vad-port', port: channel.port2 }, [channel.port2]);
  }

  capture(seconds = 3): Promise<{ dry: Float32Array<ArrayBuffer>; wet: Float32Array<ArrayBuffer> }> {
    this.#cancelCapture();
    if (!this.#sensitivity || !this.active) return Promise.reject(new MicError('Microfone não está ativo.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#cancelCapture(), seconds * 1000 + 3000);
      this.#capture = { resolve, reject, timer };
      this.#sensitivity!.port.postMessage({ type: 'capture', seconds });
    });
  }
  #cancelCapture(): void {
    if (!this.#capture) return;
    clearTimeout(this.#capture.timer); this.#capture.reject(new MicError('Teste de microfone encerrado.'));
    this.#capture = null; this.#sensitivity?.port.postMessage({ type: 'cancel' });
  }
  dispose(): void {
    this.#disposed = true;
    this.stop();
    this.#sensitivity?.port.postMessage({ type: 'vad-port', port: null });
    this.#sensitivity?.port.close(); this.#sensitivity?.disconnect();
    this.#processor = null; this.#gain.disconnect(); this.#gate.disconnect(); this.meter.node.disconnect(); this.output.stop();
  }
}
