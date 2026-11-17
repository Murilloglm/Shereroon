/**
 * Cliente do app auxiliar "ShareRoom Áudio" (Windows). O auxiliar captura o som dos aplicativos escolhidos
 * e entrega por WebSocket em 127.0.0.1; aqui esse som vira uma faixa de áudio do navegador, pronta para
 * ser publicada junto com a tela. Nada sai da máquina por esse canal.
 */
import { audioContext, resumeAudio } from '../audio.ts';
import { desktop } from '../desktop.ts';
import { Store } from '../store.ts';

export const HELPER_DEFAULT_PORT = 47821;
/** Quantas fontes podem seguir em faixa separada (para filtros) ao mesmo tempo. Igual ao limite do auxiliar. */
export const MAX_SOLO = 6;

export type HelperPhase =
  | 'parado'
  | 'conectando'
  /** O auxiliar abriu uma janela no PC perguntando se este site pode usá-lo. */
  | 'autorizando'
  | 'conectado'
  /** Não respondeu: não está aberto, não está instalado ou o navegador bloqueou o acesso local. */
  | 'ausente'
  | 'negado'
  /** Outra aba do ShareRoom assumiu o mixer. */
  | 'substituido';

export interface HelperApp {
  id: string;
  pid: number;
  exe: string;
  name: string;
  /** Já abriu uma sessão de áudio no Windows. */
  hasSession: boolean;
  playing: boolean;
  /** É o navegador que está com esta sala aberta: capturá-lo causaria eco. */
  browserHost: boolean;
}

export type SourceStateName = 'off' | 'capturing' | 'covered' | 'error' | 'ended';

export interface HelperSource {
  id: string;
  slot: number;
  exe: string;
  enabled: boolean;
  volume: number;
  solo: boolean;
  state: SourceStateName;
  coveredBy: string | null;
  error: string | null;
}

export interface QueueStats {
  /** Atraso médio real da fila entre o auxiliar e o navegador. */
  bufferMs: number | null;
  underruns: number;
  lostBlocks: number;
  /** Atraso alvo atual da fila adaptativa, em ms. */
  targetMs: number | null;
}

/** Fila do navegador: começa em 20 ms e só cresce (até 80 ms) se faltar áudio de verdade. */
const QUEUE_MIN_FRAMES = 960;
const QUEUE_MAX_FRAMES = 3840;

export interface HelperState {
  phase: HelperPhase;
  apps: HelperApp[];
  sources: HelperSource[];
  version: string | null;
  build: number | null;
  browserExe: string | null;
  icons: Record<string, string | null>;
  queue: QueueStats | null;
}

export interface HelperError {
  id: string | null;
  message: string;
}

function helperPort(): number {
  // No aplicativo de Windows o componente de áudio sobe junto, numa porta que só o aplicativo conhece.
  if (desktop?.config.helperPort) return desktop.config.helperPort;
  try {
    const custom = Number(localStorage.getItem('shareroom:auxiliar-porta'));
    if (Number.isInteger(custom) && custom > 1023 && custom < 65536) return custom;
  } catch {
    // armazenamento bloqueado
  }
  return HELPER_DEFAULT_PORT;
}

export class HelperClient {
  readonly store = new Store<HelperState>({
    phase: 'parado',
    apps: [],
    sources: [],
    version: null,
    build: null,
    browserExe: null,
    icons: {},
    queue: null,
  });
  /** Níveis de pico atualizados 20 vezes por segundo. Lidos direto pelos medidores, sem re-renderizar a tela. */
  readonly levels = {
    master: 0,
    bySlot: new Map<number, number>(),
    bufferMs: new Map<number, number>(),
    /** Atraso medido da captura do Windows até o auxiliar, por fonte. */
    captureMs: new Map<number, number>(),
  };
  onError: ((error: HelperError) => void) | null = null;

  #worker: Worker | null = null;
  #node: AudioWorkletNode | null = null;
  #destination: MediaStreamAudioDestinationNode | null = null;
  #soloGains: GainNode[] = [];
  #soloProcessors: (AudioNode | null)[] = [];
  #wanted = false;
  #streaming = false;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #requestedIcons = new Set<string>();

  /** Faixa de áudio com a mixagem dos aplicativos. Só existe depois de `connect()`. */
  get track(): MediaStreamTrack | null {
    return this.#destination?.stream.getAudioTracks()[0] ?? null;
  }

  /**
   * Atraso total do áudio dos aplicativos antes de entrar no WebRTC, em ms: captura do Windows + fila do
   * auxiliar + fila do navegador, tudo medido. É esse o quanto o som chega atrasado em relação à imagem,
   * porque o vídeo da tela recebe o horário da captura e o áudio, o horário em que entra no navegador.
   * Null enquanto não há medição.
   */
  pipelineDelayMs(): number | null {
    const queue = this.store.get().queue?.bufferMs ?? null;
    if (queue === null || this.levels.bufferMs.size === 0) return null;
    // Fontes diferentes são misturadas juntas: vale a mais atrasada.
    let source = 0;
    for (const [slot, buffered] of this.levels.bufferMs) source = Math.max(source, buffered + (this.levels.captureMs.get(slot) ?? 0));
    return Math.round(source + queue);
  }

  /** Fontes "solo" em captura, na ordem das faixas (índice 0 = primeira faixa solo). */
  soloSources(): HelperSource[] {
    return this.store
      .get()
      .sources.filter((source) => source.solo && source.state === 'capturing')
      .slice(0, MAX_SOLO);
  }

  /**
   * Encaixa (ou tira, com null) um processador na faixa solo `index`, entre a captura e o volume dela.
   * É por aqui que a supressão de ruído filtra uma fonte sozinha, antes de ela entrar na mixagem.
   */
  setSoloProcessor(index: number, processor: AudioNode | null): void {
    const node = this.#node;
    const gain = this.#soloGains[index];
    const current = this.#soloProcessors[index] ?? null;
    if (!node || !gain || current === processor) return;
    try {
      node.disconnect(current ?? gain, index + 1);
    } catch {
      // ainda não estava ligado
    }
    if (current) {
      try {
        current.disconnect(gain);
      } catch {
        // idem
      }
    }
    if (processor) {
      node.connect(processor, index + 1);
      processor.connect(gain);
    } else {
      node.connect(gain, index + 1);
    }
    this.#soloProcessors[index] = processor;
  }

  /** Abre a conexão (e tenta de novo sozinho enquanto o mixer estiver em uso). Chame a partir de um clique. */
  async connect(): Promise<void> {
    this.#wanted = true;
    await resumeAudio();
    try {
      await this.#ensureGraph();
    } catch (error) {
      console.error('AudioWorklet indisponível', error);
      this.store.set({ phase: 'ausente' });
      return;
    }
    // Já conectado (ou no meio do caminho): abrir de novo derrubaria as capturas em andamento.
    const phase = this.store.get().phase;
    if (phase === 'conectado' || phase === 'conectando' || phase === 'autorizando') return;
    this.#open();
  }

  disconnect(): void {
    this.#wanted = false;
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = null;
    this.#worker?.postMessage({ type: 'close' });
    this.levels.master = 0;
    this.levels.bySlot.clear();
    this.store.set({ phase: 'parado', apps: [], sources: [], queue: null });
  }

  /** Liga/desliga uma fonte, muda o volume de envio ou marca como "solo". */
  setSource(id: string, patch: { enabled?: boolean; volume?: number; solo?: boolean }): void {
    this.#send({ t: 'source', id, ...patch });
  }

  /** Com `false` o auxiliar segue medindo níveis, mas não envia áudio. */
  setStreaming(on: boolean): void {
    this.#streaming = on;
    this.#send({ t: 'stream', on });
  }

  refreshApps(): void {
    this.#send({ t: 'apps' });
  }

  #send(message: Record<string, unknown>): void {
    if (this.store.get().phase === 'conectado') this.#worker?.postMessage({ type: 'send', text: JSON.stringify(message) });
  }

  async #ensureGraph(): Promise<void> {
    if (this.#node) return;
    const context = audioContext();
    await context.audioWorklet.addModule(new URL('worklets/helper-source.js', document.baseURI));
    const node = new AudioWorkletNode(context, 'sr-helper-source', {
      numberOfInputs: 0,
      numberOfOutputs: MAX_SOLO + 1,
      outputChannelCount: Array.from({ length: MAX_SOLO + 1 }, () => 2),
      processorOptions: { adaptive: { min: QUEUE_MIN_FRAMES, max: QUEUE_MAX_FRAMES } },
    });
    const destination = context.createMediaStreamDestination();
    node.connect(destination, 0);
    this.#soloGains = Array.from({ length: MAX_SOLO }, (_, index) => {
      const gain = context.createGain();
      node.connect(gain, index + 1);
      gain.connect(destination);
      return gain;
    });
    node.port.onmessage = (event) => {
      const stats = event.data as { type: string; bufferMs: number | null; underruns: number; lostBlocks: number; targetMs?: number };
      if (stats.type === 'stats') {
        this.store.set({
          queue: { bufferMs: stats.bufferMs, underruns: stats.underruns, lostBlocks: stats.lostBlocks, targetMs: stats.targetMs ?? null },
        });
      }
    };

    const worker = new Worker(new URL('./helper.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => this.#onWorker(event.data);
    // O áudio vai do Worker direto para o AudioWorklet por esta ponte.
    const bridge = new MessageChannel();
    worker.postMessage({ type: 'port', port: bridge.port1 }, [bridge.port1]);
    node.port.postMessage({ type: 'port', port: bridge.port2 }, [bridge.port2]);

    this.#node = node;
    this.#destination = destination;
    this.#worker = worker;
  }

  #open(): void {
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = null;
    this.store.set({ phase: 'conectando' });
    this.#node?.port.postMessage({ type: 'reset' });
    this.#worker?.postMessage({ type: 'connect', url: `ws://127.0.0.1:${helperPort()}/` });
  }

  #onWorker(message: { type: string; text?: string; code?: number }): void {
    if (message.type === 'text' && message.text) {
      this.#onText(message.text);
    } else if (message.type === 'close') {
      this.#onClose(message.code ?? 1006);
    }
  }

  #onClose(code: number): void {
    const before = this.store.get().phase;
    this.levels.master = 0;
    this.levels.bySlot.clear();
    if (before === 'parado') return;
    if (code === 4403) {
      this.store.set({ phase: 'negado', apps: [], sources: [] });
      return;
    }
    if (code === 4001) {
      this.#wanted = false;
      this.store.set({ phase: 'substituido', apps: [], sources: [] });
      return;
    }
    this.store.set({ phase: 'ausente', apps: [], sources: [], queue: null });
    // Fechou o auxiliar no meio? Volta sozinho quando ele reabrir.
    if (this.#wanted) this.#retry = setTimeout(() => this.#wanted && this.#open(), 3000);
  }

  #onText(text: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (message.t) {
      case 'levels': {
        this.levels.master = Number(message.m) || 0;
        this.levels.bySlot.clear();
        for (const [slot, peak] of Object.entries((message.s ?? {}) as Record<string, number>)) this.levels.bySlot.set(Number(slot), peak);
        this.levels.bufferMs.clear();
        for (const [slot, ms] of Object.entries((message.b ?? {}) as Record<string, number>)) this.levels.bufferMs.set(Number(slot), ms);
        this.levels.captureMs.clear();
        for (const [slot, ms] of Object.entries((message.c ?? {}) as Record<string, number>)) this.levels.captureMs.set(Number(slot), ms);
        break;
      }
      case 'pending':
        this.store.set({ phase: 'autorizando' });
        break;
      case 'denied':
        this.store.set({ phase: 'negado' });
        break;
      case 'welcome': {
        const browser = (message.browser ?? {}) as { exe?: string };
        this.store.set({
          phase: 'conectado',
          version: String(message.version ?? ''),
          build: Number(message.build) || null,
          browserExe: browser.exe || null,
        });
        this.#send({ t: 'stream', on: this.#streaming });
        break;
      }
      case 'apps': {
        const apps = (message.apps ?? []) as HelperApp[];
        this.store.set({ apps });
        for (const app of apps) {
          const key = app.exe.toLowerCase();
          if (!this.#requestedIcons.has(key)) {
            this.#requestedIcons.add(key);
            this.#send({ t: 'icon', exe: app.exe });
          }
        }
        break;
      }
      case 'sources': {
        const sources = (message.sources ?? []) as HelperSource[];
        this.store.set({ sources });
        this.#routeSolo(sources);
        break;
      }
      case 'icon':
        if (typeof message.exe === 'string') {
          const key = message.exe.toLowerCase();
          this.store.set((state) => ({ icons: { ...state.icons, [key]: (message.png as string | null) ?? null } }));
        }
        break;
      case 'error':
        this.onError?.({ id: (message.id as string | undefined) ?? null, message: String(message.message ?? 'Erro no app auxiliar.') });
        break;
    }
  }

  /** Diz ao AudioWorklet em qual saída cada fonte "solo" deve tocar e aplica o volume de cada uma. */
  #routeSolo(sources: HelperSource[]): void {
    const solo = this.soloSources();
    this.#node?.port.postMessage({ type: 'slots', slots: solo.map((source) => source.slot) });
    const now = audioContext().currentTime;
    this.#soloGains.forEach((gain, index) => {
      gain.gain.setTargetAtTime(solo[index]?.volume ?? 0, now, 0.015);
    });
  }
}
