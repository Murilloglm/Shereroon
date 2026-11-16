/**
 * Supressão de ruído por fonte. Cada filtro é um AudioWorklet com o modelo RNNoise (rede neural, em
 * WebAssembly) rodando neste computador; nenhum áudio é enviado a serviço externo para ser processado.
 * Se o modelo não puder ser carregado, o mesmo worklet usa uma supressão convencional.
 */

export type NoiseMode = 'off' | 'leve' | 'equilibrado' | 'forte';
export type NoiseLevel = Exclude<NoiseMode, 'off'>;
export type NoiseEngine = 'ia' | 'convencional';

export const NOISE_LEVELS: { value: NoiseLevel; name: string; about: string }[] = [
  { value: 'leve', name: 'Leve', about: 'Baixa o ruído em até 12 dB. É o que menos mexe no som.' },
  { value: 'equilibrado', name: 'Equilibrado', about: 'Baixa o ruído em até 24 dB.' },
  { value: 'forte', name: 'Forte', about: 'Remove tudo o que o modelo considera ruído. Pode engolir sons fracos que não são voz.' },
];

export const isNoiseLevel = (value: unknown): value is NoiseLevel => NOISE_LEVELS.some((level) => level.value === value);

/** Atraso que o filtro acrescenta a uma fonte, em milissegundos (959 amostras a 48 kHz, medido nos testes). */
export const NOISE_DELAY_MS = 20;

export interface NoiseStats {
  inputDb: number;
  outputDb: number;
  /** Quanto o nível caiu por causa do filtro, na última medição. */
  reductionDb: number;
  /** Nível do que foi removido (o "ruído", segundo o modelo). */
  noiseDb: number;
  /** Probabilidade de haver voz, segundo o modelo (0 a 1). */
  voice: number;
  /** Fração de um núcleo de CPU gasta por este filtro, medida. */
  cpuPct: number;
  msPerFrame: number;
  engine: NoiseEngine;
}

export interface NoiseCapture {
  dry: Float32Array<ArrayBuffer>;
  wet: Float32Array<ArrayBuffer>;
}

let moduleReady: Promise<void> | null = null;
let wasmBytes: Promise<ArrayBuffer | null> | null = null;

function loadWasm(): Promise<ArrayBuffer | null> {
  wasmBytes ??= fetch(new URL('worklets/rnnoise.wasm', document.baseURI))
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .catch(() => null);
  return wasmBytes;
}

export class NoiseFilter {
  readonly node: AudioWorkletNode;
  /** Resolve com o motor que realmente entrou em uso. */
  readonly ready: Promise<NoiseEngine>;
  engine: NoiseEngine | null = null;
  /** Última medição enviada pelo worklet (quatro por segundo). */
  stats: NoiseStats | null = null;
  #pendingCapture: ((result: NoiseCapture) => void) | null = null;

  constructor(node: AudioWorkletNode) {
    this.node = node;
    this.ready = new Promise((resolve, reject) => {
      node.onprocessorerror = () => reject(new Error('O processador de áudio do filtro de ruído falhou ao iniciar.'));
      node.port.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          this.engine = data.engine as NoiseEngine;
          resolve(this.engine);
        } else if (data.type === 'stats') {
          this.stats = data.stats as NoiseStats;
        } else if (data.type === 'capture') {
          this.#pendingCapture?.({ dry: data.dry, wet: data.wet });
          this.#pendingCapture = null;
        }
      };
    });
  }

  setLevel(level: NoiseLevel): void {
    this.node.port.postMessage({ type: 'mode', mode: level });
  }

  /** `true` deixa passar o som original (mesmo atraso, sem estalo): é a comparação instantânea. */
  setBypass(on: boolean): void {
    this.node.port.postMessage({ type: 'bypass', on });
  }

  /** Grava o mesmo trecho nas duas versões, para ouvir e comparar. Fica só na memória; nada vai para o disco. */
  capture(seconds: number): Promise<NoiseCapture> {
    return new Promise((resolve) => {
      this.#pendingCapture = resolve;
      this.node.port.postMessage({ type: 'capture', seconds });
    });
  }

  dispose(): void {
    this.node.port.onmessage = null;
    this.node.onprocessorerror = null;
    this.node.disconnect();
  }
}

/** Cria um filtro e espera ele dizer qual motor está usando. Com `forceConventional`, nem tenta o modelo de IA. */
export async function createNoiseFilter(context: AudioContext, level: NoiseLevel, forceConventional = false): Promise<NoiseFilter> {
  moduleReady ??= context.audioWorklet.addModule(new URL('worklets/denoise-processor.js', document.baseURI));
  moduleReady.catch(() => (moduleReady = null));
  const [wasm] = await Promise.all([forceConventional ? null : loadWasm(), moduleReady]);
  const node = new AudioWorkletNode(context, 'sr-denoise', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCountMode: 'max',
    processorOptions: { wasm, mode: level },
  });
  const filter = new NoiseFilter(node);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      filter.ready,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('O filtro de ruído não respondeu.')), 4000);
      }),
    ]);
  } catch (error) {
    filter.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return filter;
}
