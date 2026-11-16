/**
 * Captura de tela. A captura só começa depois que a pessoa escolhe a fonte no seletor do navegador
 * (ou, no aplicativo de Windows, no seletor do próprio aplicativo) — não há como iniciar sem essa escolha.
 */
import { desktop } from './desktop.ts';
import { preferHardwareH264 } from './h264.ts';
import { captureConstraints, type Codec, type Target } from './quality.ts';
import { pickDesktopSource } from './source-picker.ts';

export type Surface = 'monitor' | 'window' | 'browser';

export interface CaptureRequest {
  target: Target;
  /** Pede ao navegador o áudio da fonte (aba, janela ou sistema, conforme o que ele oferecer). */
  audio: boolean;
  /** Só uma sugestão de qual aba o seletor abre primeiro; quem decide é a pessoa. */
  surface?: Surface;
}

export interface CaptureSession {
  stream: MediaStream;
  video: MediaStreamTrack;
  audio: MediaStreamTrack | null;
  /** O que foi de fato escolhido no seletor. */
  surface: Surface | null;
  /** O navegador leu a opção windowAudio? (Chrome 141+.) */
  windowAudioUnderstood: boolean;
  stop(): void;
}

export class CaptureError extends Error {
  readonly code: 'cancelado' | 'nao_suportado' | 'bloqueado' | 'falha';

  constructor(code: CaptureError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function canCaptureScreen(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** Explica, em português, por que este aparelho/navegador não consegue compartilhar a tela. */
export function captureUnavailableReason(): string | null {
  if (canCaptureScreen()) return null;
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Compartilhar a tela exige uma página segura (HTTPS ou localhost).';
  }
  return 'Este navegador não compartilha a tela. No celular dá para assistir; para transmitir, use Chrome ou Edge no computador.';
}

export async function startCapture(request: CaptureRequest): Promise<CaptureSession> {
  if (!canCaptureScreen()) {
    throw new CaptureError('nao_suportado', captureUnavailableReason() ?? 'Captura de tela indisponível.');
  }

  const supported = navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean | undefined>;
  let windowAudioUnderstood = false;

  const audio: Record<string, unknown> | false = request.audio
    ? {
        // Áudio de jogo/música: sem nenhum processamento de voz.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        sampleRate: 48_000,
        // Continua tocando no PC de quem transmite.
        suppressLocalAudioPlayback: false,
        // Chrome 141+: tira do áudio do sistema o som desta própria aba (as vozes da sala), evitando eco.
        ...(supported.restrictOwnAudio ? { restrictOwnAudio: true } : {}),
      }
    : false;

  const options: Record<string, unknown> = {
    video: {
      ...captureConstraints(request.target),
      ...(request.surface ? { displaySurface: request.surface } : {}),
    },
    audio,
    // Não oferecer a própria aba do ShareRoom (efeito "espelho infinito").
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'include',
    systemAudio: request.audio ? 'include' : 'exclude',
  };
  if (request.audio) {
    // Getter para descobrir se o navegador conhece a opção: ele só lê os campos que entende.
    Object.defineProperty(options, 'windowAudio', {
      enumerable: true,
      get() {
        windowAudioUnderstood = true;
        return 'window';
      },
    });
  }

  if (desktop) {
    // Aplicativo de Windows: quem escolhe a fonte é o seletor do aplicativo, e o processo principal só libera
    // a captura da fonte escolhida ali. O som não vem daqui, e sim do componente de áudio.
    const id = await pickDesktopSource(request.surface);
    if (!id) throw new CaptureError('cancelado', 'Compartilhamento cancelado.');
    if (!(await desktop.chooseSource(id))) {
      throw new CaptureError('bloqueado', 'Essa tela ou janela não está mais disponível. Escolha outra.');
    }
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(
      desktop ? { video: captureConstraints(request.target), audio: false } : (options as DisplayMediaStreamOptions),
    );
  } catch (error) {
    const name = (error as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') {
      throw new CaptureError('cancelado', 'Compartilhamento cancelado.');
    }
    if (name === 'NotFoundError' || name === 'NotReadableError') {
      throw new CaptureError('bloqueado', 'O sistema não liberou a captura dessa fonte. Tente escolher outra janela ou a tela inteira.');
    }
    throw new CaptureError('falha', `Não foi possível iniciar a captura (${name ?? 'erro desconhecido'}).`);
  }

  const video = stream.getVideoTracks()[0];
  if (!video) {
    for (const track of stream.getTracks()) track.stop();
    throw new CaptureError('falha', 'O navegador não entregou vídeo para essa fonte.');
  }

  return {
    stream,
    video,
    audio: stream.getAudioTracks()[0] ?? null,
    surface: surfaceOf(video),
    windowAudioUnderstood,
    stop() {
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

/** Monitor, janela ou aba. Usa o que o navegador declara e, na falta, o rótulo que o Chrome dá à faixa. */
export function surfaceOf(video: MediaStreamTrack): Surface | null {
  const declared = (video.getSettings() as { displaySurface?: string }).displaySurface;
  if (declared === 'monitor' || declared === 'window' || declared === 'browser') return declared;
  if (video.label.startsWith('screen:')) return 'monitor';
  if (video.label.startsWith('window:')) return 'window';
  if (video.label.startsWith('web-contents-media-stream')) return 'browser';
  return null;
}

/** Muda resolução/FPS da captura em andamento, sem novo pedido de permissão. */
export async function retarget(video: MediaStreamTrack, target: Target): Promise<boolean> {
  try {
    await video.applyConstraints(captureConstraints(target));
    return true;
  } catch {
    return false;
  }
}

export interface CaptureFacts {
  width: number | null;
  height: number | null;
  frameRate: number | null;
  maxFrameRate: number | null;
}

export function captureFacts(video: MediaStreamTrack): CaptureFacts {
  const settings = video.getSettings();
  let maxFrameRate: number | null = null;
  try {
    maxFrameRate = video.getCapabilities?.().frameRate?.max ?? null;
  } catch {
    // alguns navegadores não implementam getCapabilities para captura de tela
  }
  return {
    width: settings.width ?? null,
    height: settings.height ?? null,
    frameRate: settings.frameRate ?? null,
    maxFrameRate,
  };
}

/** Codecs de vídeo que este navegador consegue ENVIAR por WebRTC, do mais ao menos compatível. */
export function sendableCodecs(): Codec[] {
  const mimes = new Set(
    (RTCRtpSender.getCapabilities?.('video')?.codecs ?? []).map((codec) => codec.mimeType.toLowerCase()),
  );
  const order: [Codec, string][] = [
    ['h264', 'video/h264'],
    ['vp9', 'video/vp9'],
    ['av1', 'video/av1'],
    ['vp8', 'video/vp8'],
  ];
  return order.filter(([, mime]) => mimes.has(mime)).map(([codec]) => codec);
}

export interface CodecHint {
  supported: boolean;
  smooth: boolean;
  powerEfficient: boolean;
}

/** O perfil de H.264 que será de fato negociado (High, quando o navegador tem codificador por hardware). */
function h264ContentType(): string {
  const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs ?? [];
  const first = (preferHardwareH264(codecs) ?? codecs).find((codec) => codec.mimeType.toLowerCase() === 'video/h264');
  const profile = /profile-level-id=([0-9a-f]{6})/i.exec(first?.sdpFmtpLine ?? '')?.[1] ?? '42e01f';
  return `video/H264;profile-level-id=${profile}`;
}

const contentTypeFor = (codec: Codec): string =>
  codec === 'h264' ? h264ContentType() : codec === 'vp9' ? 'video/VP9' : codec === 'av1' ? 'video/AV1' : 'video/VP8';

/** Pergunta ao navegador se ele codifica bem esse codec nessa resolução/FPS (e se usa hardware). */
export async function codecHint(codec: Codec, target: Target, bitrateKbps: number): Promise<CodecHint | null> {
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: 'webrtc',
      video: {
        contentType: contentTypeFor(codec),
        width: Math.round((target.height * 16) / 9),
        height: target.height,
        framerate: target.fps,
        bitrate: bitrateKbps * 1000,
      },
    });
    return { supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient };
  } catch {
    return null;
  }
}
