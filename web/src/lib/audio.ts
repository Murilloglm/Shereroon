/** Um único AudioContext para o app inteiro (microfone, mixer e medidores), sempre em 48 kHz. */
let context: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!context) {
    context = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
  }
  return context;
}

let boostModule: Promise<void> | null = null;

/** Carrega (uma vez) o AudioWorklet do volume acima de 100%. */
export function loadBoostWorklet(): Promise<void> {
  boostModule ??= audioContext()
    .audioWorklet.addModule(new URL('worklets/boost-processor.js', document.baseURI))
    .catch((error: unknown) => {
      boostModule = null;
      throw error;
    });
  return boostModule;
}

/** Estado da permissão do microfone sem abrir o aparelho (null quando o navegador não informa). */
export async function micPermission(): Promise<PermissionState | null> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
  } catch {
    return null;
  }
}

/** Navegadores só liberam áudio depois de um gesto; chame isto dentro de um clique. */
export async function resumeAudio(): Promise<void> {
  const ctx = audioContext();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // segue suspenso até o próximo gesto
    }
  }
}

/** Medidor de pico (0 a 1) em cima de um AnalyserNode. */
export class PeakMeter {
  readonly node: AnalyserNode;
  readonly #buffer: Float32Array<ArrayBuffer>;

  constructor(ctx: AudioContext, fftSize = 1024) {
    this.node = ctx.createAnalyser();
    this.node.fftSize = fftSize;
    this.node.smoothingTimeConstant = 0;
    this.#buffer = new Float32Array(this.node.fftSize);
  }

  read(): number {
    this.node.getFloatTimeDomainData(this.#buffer);
    let peak = 0;
    for (const sample of this.#buffer) {
      const magnitude = sample < 0 ? -sample : sample;
      if (magnitude > peak) peak = magnitude;
    }
    return Math.min(1, peak);
  }

  /** Nível RMS (0 a 1) da última janela: a mesma escala do `audioLevel` que o WebRTC dá para o áudio recebido. */
  readRms(): number {
    this.node.getFloatTimeDomainData(this.#buffer);
    let sum = 0;
    for (const sample of this.#buffer) sum += sample * sample;
    return Math.min(1, Math.sqrt(sum / this.#buffer.length));
  }
}

/** Converte amplitude linear em posição de medidor (0 a 1), em escala de decibéis de -60 a 0 dBFS. */
export function meterPosition(amplitude: number): number {
  if (amplitude <= 0.001) return 0;
  const db = 20 * Math.log10(amplitude);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

export interface AudioDevices {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

export async function listAudioDevices(): Promise<AudioDevices> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: devices.filter((device) => device.kind === 'audioinput' && device.deviceId !== ''),
      outputs: devices.filter((device) => device.kind === 'audiooutput' && device.deviceId !== ''),
    };
  } catch {
    return { inputs: [], outputs: [] };
  }
}
