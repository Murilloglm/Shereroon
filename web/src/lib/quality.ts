/**
 * Qualidade da transmissão: presets, restrições de captura, o controlador do modo
 * automático e o diagnóstico "pedido × real". Tudo aqui é função pura, sem navegador.
 */

export const RESOLUTIONS = [480, 720, 900, 1080] as const;
export const FRAME_RATES = [30, 60, 90, 120] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export type FrameRate = (typeof FRAME_RATES)[number];
export type Codec = 'h264' | 'vp9' | 'av1' | 'vp8';
export type CodecChoice = 'auto' | Codec;
/** O que está na tela: muda como o codificador trata a imagem. */
export type ContentKind = 'movimento' | 'texto';
export type Limitation = 'none' | 'cpu' | 'bandwidth' | 'other';

export interface Target {
  height: Resolution;
  fps: FrameRate;
}

export interface QualitySettings {
  mode: 'auto' | 'manual';
  resolution: Resolution;
  fps: FrameRate;
  codec: CodecChoice;
  /** Jogo/vídeo (movimento) ou texto/código. */
  content: ContentKind;
  /** Teto de bitrate em kbps; null usa o valor recomendado para resolução/FPS/codec. */
  bitrateKbps: number | null;
  /** Publica também uma camada leve (simulcast) para quem está no celular ou com internet fraca. */
  lightLayer: boolean;
}

export const DEFAULT_QUALITY: QualitySettings = {
  mode: 'auto',
  resolution: 1080,
  fps: 120,
  codec: 'auto',
  content: 'movimento',
  bitrateKbps: null,
  lightLayer: false,
};

export const TOP_TARGET: Target = { height: 1080, fps: 120 };

const WIDTHS: Record<Resolution, number> = { 480: 854, 720: 1280, 900: 1600, 1080: 1920 };

export function widthFor(height: Resolution): number {
  return WIDTHS[height];
}

/** Bitrate recomendado em kbps para H.264 (conteúdo de jogo/tela em movimento). */
const H264_KBPS: Record<Resolution, Record<FrameRate, number>> = {
  480: { 30: 1500, 60: 2500, 90: 3200, 120: 4000 },
  720: { 30: 3000, 60: 5000, 90: 6500, 120: 8000 },
  900: { 30: 4500, 60: 7000, 90: 9000, 120: 11000 },
  1080: { 30: 6000, 60: 10000, 90: 13000, 120: 16000 },
};

/** Codecs mais novos entregam a mesma imagem com menos bits. */
const CODEC_FACTOR: Record<Codec, number> = { h264: 1, vp8: 1.1, vp9: 0.75, av1: 0.65 };

export function presetBitrateKbps(target: Target, codec: Codec): number {
  return Math.round((H264_KBPS[target.height][target.fps] * CODEC_FACTOR[codec]) / 50) * 50;
}

export function effectiveBitrateKbps(settings: QualitySettings, target: Target, codec: Codec): number {
  if (settings.mode === 'manual' && settings.bitrateKbps !== null) return settings.bitrateKbps;
  return presetBitrateKbps(target, codec);
}

/**
 * Restrições para getDisplayMedia/applyConstraints. Usa `max`, então a captura é
 * reduzida para caber na caixa pedida e nunca ampliada além do tamanho real da fonte.
 */
export function captureConstraints(target: Target): MediaTrackConstraints {
  return {
    width: { max: widthFor(target.height) },
    height: { max: target.height },
    frameRate: { ideal: target.fps, max: target.fps },
  };
}

/**
 * O WebRTC nunca troca a resolução por conta própria. Medido no Chrome 157: com
 * "maintain-framerate" o redutor por qualidade derruba 1080p para ~734p logo no início e não
 * volta, mesmo com banda sobrando; com "maintain-resolution" a mesma máquina sustenta 1080p a
 * 120 fps. Quem reduz resolução ou FPS quando falta recurso é o modo automático (de forma
 * explícita e visível), não o navegador às escondidas.
 */
export const DEGRADATION: RTCDegradationPreference = 'maintain-resolution';

/** 'motion' trata a tela como vídeo (necessário acima de 30 fps); 'detail' favorece texto parado. */
export function contentHintFor(content: ContentKind): 'motion' | 'detail' {
  return content === 'texto' ? 'detail' : 'motion';
}

export function sanitizeQuality(value: unknown): QualitySettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<QualitySettings>;
  const pick = <T>(candidate: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(candidate as T) ? (candidate as T) : fallback;
  const bitrate = typeof raw.bitrateKbps === 'number' && Number.isFinite(raw.bitrateKbps) ? raw.bitrateKbps : null;
  return {
    mode: pick(raw.mode, ['auto', 'manual'] as const, DEFAULT_QUALITY.mode),
    resolution: pick(raw.resolution, RESOLUTIONS, DEFAULT_QUALITY.resolution),
    fps: pick(raw.fps, FRAME_RATES, DEFAULT_QUALITY.fps),
    codec: pick(raw.codec, ['auto', 'h264', 'vp9', 'av1', 'vp8'] as const, DEFAULT_QUALITY.codec),
    content: pick(raw.content, ['movimento', 'texto'] as const, DEFAULT_QUALITY.content),
    bitrateKbps: bitrate === null ? null : Math.min(50_000, Math.max(300, Math.round(bitrate))),
    lightLayer: raw.lightLayer === true,
  };
}

// --- Modo automático ---------------------------------------------------------

/** Degraus do modo automático, do melhor para o mais leve (por pixels por segundo). */
export const AUTO_LADDER: readonly Target[] = [
  { height: 1080, fps: 120 },
  { height: 1080, fps: 90 },
  { height: 1080, fps: 60 },
  { height: 900, fps: 60 },
  { height: 720, fps: 60 },
  { height: 720, fps: 30 },
  { height: 480, fps: 30 },
];

export interface SourceLimits {
  /** Altura real da fonte capturada (uma janela pequena não tem 1080 linhas). */
  maxHeight: number;
  /** Maior taxa de quadros que a captura aceita. */
  maxFps: number;
}

/** Remove degraus que, para esta fonte, não mudariam nada em relação ao anterior. */
export function buildLadder(limits: SourceLimits): Target[] {
  const ladder: Target[] = [];
  let lastKey = '';
  for (const step of AUTO_LADDER) {
    const fps = FRAME_RATES.filter((rate) => rate <= Math.max(30, limits.maxFps)).at(-1) ?? 30;
    const effective = { height: Math.min(step.height, limits.maxHeight), fps: Math.min(step.fps, fps) };
    const key = `${effective.height}@${effective.fps}`;
    if (key === lastKey) continue;
    lastKey = key;
    ladder.push({ height: step.height, fps: Math.min(step.fps, fps) as FrameRate });
  }
  return ladder;
}

export interface AutoSample {
  limitation: Limitation;
  captureFps: number | null;
  encodedFps: number | null;
  lossPct: number | null;
  /** A estimativa de banda ainda está subindo: quadros a menos agora não são um problema real. */
  ramping: boolean;
}

export interface AutoState {
  level: number;
  bad: number;
  good: number;
  goodNeeded: number;
  lastChange: 'up' | 'down' | null;
}

/** Amostras ruins seguidas para descer um degrau (uma amostra a cada ~2 s). */
export const BAD_TO_DROP = 3;
/** Amostras boas seguidas para tentar subir. Dobra a cada subida que não se sustenta. */
export const BASE_GOOD_TO_RISE = 15;
const MAX_GOOD_TO_RISE = 120;

export function initialAutoState(): AutoState {
  return { level: 0, bad: 0, good: 0, goodNeeded: BASE_GOOD_TO_RISE, lastChange: null };
}

export function isStruggling(sample: AutoSample): boolean {
  if (sample.limitation === 'cpu' || sample.limitation === 'bandwidth') return true;
  if ((sample.lossPct ?? 0) > 8) return true;
  if (sample.ramping) return false;
  // Tela parada gera poucos quadros de captura; só conta quando há movimento de verdade.
  if (sample.captureFps !== null && sample.encodedFps !== null && sample.captureFps >= 20) {
    return sample.encodedFps < sample.captureFps * 0.7;
  }
  return false;
}

export function stepAuto(
  state: AutoState,
  sample: AutoSample,
  ladderLength: number,
): { state: AutoState; change: 'up' | 'down' | null } {
  const next = { ...state, level: Math.min(state.level, ladderLength - 1) };

  if (isStruggling(sample)) {
    next.bad += 1;
    next.good = 0;
    if (next.bad >= BAD_TO_DROP && next.level < ladderLength - 1) {
      // Subiu e não aguentou: da próxima vez espera o dobro antes de tentar de novo.
      if (state.lastChange === 'up') next.goodNeeded = Math.min(MAX_GOOD_TO_RISE, state.goodNeeded * 2);
      next.level += 1;
      next.bad = 0;
      next.lastChange = 'down';
      return { state: next, change: 'down' };
    }
    return { state: next, change: null };
  }

  next.good += 1;
  next.bad = 0;
  if (next.good >= next.goodNeeded && next.level > 0) {
    if (state.lastChange === 'up') next.goodNeeded = Math.max(BASE_GOOD_TO_RISE, Math.round(state.goodNeeded / 2));
    next.level -= 1;
    next.good = 0;
    next.lastChange = 'up';
    return { state: next, change: 'up' };
  }
  return { state: next, change: null };
}

/** A banda estimada cresceu de forma consistente nas últimas leituras e ainda não chegou ao alvo? */
export function isRamping(availableKbps: readonly (number | null)[], targetKbps: number | null): boolean {
  const values = availableKbps.filter((value): value is number => value !== null);
  if (values.length < 3 || targetKbps === null) return false;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  return last > first * 1.05 && last < targetKbps * 1.15;
}

// --- Pedido × real -----------------------------------------------------------

export interface RealQuality {
  captureWidth: number | null;
  captureHeight: number | null;
  /** Maior taxa de captura vista na janela recente (tela parada derruba o valor instantâneo). */
  captureFpsPeak: number | null;
  captureFps: number | null;
  encodedWidth: number | null;
  encodedHeight: number | null;
  encodedFps: number | null;
  limitation: Limitation;
  bitrateKbps: number | null;
  targetKbps: number | null;
  /** Banda de envio estimada pelo WebRTC. */
  availableKbps: number | null;
  /** Tempo médio que o codificador gasta por quadro. */
  encodeMs: number | null;
  ramping: boolean;
  /** O que está sendo capturado: muda o teto de FPS que o navegador entrega. */
  surface?: 'monitor' | 'window' | 'browser' | null;
}

export type Shortfall = 'subindo' | 'cpu' | 'banda' | 'indefinido';

export interface Diagnosis {
  level: 'info' | 'aviso';
  code: 'fonte_menor' | 'captura_fps' | 'monitor_60' | 'janela_60' | 'subindo' | 'cpu' | 'banda' | 'resolucao_reduzida' | 'fps_reduzido';
  message: string;
}

const round = (value: number) => Math.round(value);
const mbps = (kbps: number) => `${(kbps / 1000).toFixed(1).replace('.', ',')} Mbps`;

/**
 * Por que estão saindo menos quadros do que os capturados? Compara medidas reais:
 * o tempo de codificação contra o tempo disponível por quadro, e a banda estimada contra o alvo.
 */
export function shortfallCause(real: RealQuality): Shortfall {
  if (real.limitation === 'cpu') return 'cpu';
  if (real.limitation === 'bandwidth') return 'banda';
  if (real.ramping) return 'subindo';
  if (real.encodeMs !== null && real.captureFps !== null && real.captureFps > 0 && real.encodeMs > (1000 / real.captureFps) * 0.9) {
    return 'cpu';
  }
  if (real.availableKbps !== null && real.targetKbps !== null && real.availableKbps < real.targetKbps * 0.9) return 'banda';
  return 'indefinido';
}

/** Compara o que foi pedido com o que está sendo enviado e explica cada diferença. Nunca arredonda a favor. */
export function diagnose(requested: Target, real: RealQuality): Diagnosis[] {
  const out: Diagnosis[] = [];
  const { captureWidth, captureHeight, encodedWidth, encodedHeight } = real;

  if (
    captureWidth !== null &&
    captureHeight !== null &&
    captureHeight < requested.height * 0.95 &&
    captureWidth < widthFor(requested.height) * 0.95
  ) {
    out.push({
      level: 'info',
      code: 'fonte_menor',
      message: `A fonte capturada tem ${captureWidth}×${captureHeight}, menor que os ${requested.height}p pedidos. Não há mais pixels para enviar.`,
    });
  }

  // Medido no Chrome 157 e no aplicativo (Windows 11, monitor de 300 Hz): a tela inteira e a janela de OUTRO
  // programa chegam a 60 fps, que é o ritmo em que o Windows entrega a captura; aba do navegador (e janela do
  // próprio navegador) chega a 120.
  const stuckAt60 = requested.fps > 60 && real.captureFpsPeak !== null && real.captureFpsPeak >= 50 && real.captureFpsPeak <= 66;
  if (stuckAt60 && real.surface === 'monitor') {
    out.push({
      level: 'aviso',
      code: 'monitor_60',
      message: `A captura da tela inteira chega a no máximo 60 fps neste computador (medido agora: ${round(real.captureFpsPeak!)}). É o ritmo em que o Windows entrega a imagem; ${requested.fps} fps só são possíveis compartilhando uma aba do navegador.`,
    });
  } else if (stuckAt60 && real.surface === 'window') {
    out.push({
      level: 'aviso',
      code: 'janela_60',
      message: `A captura da janela de outro programa chega a no máximo 60 fps neste computador (medido agora: ${round(real.captureFpsPeak!)}). É o ritmo em que o Windows entrega a imagem; ${requested.fps} fps só são possíveis compartilhando uma aba do navegador.`,
    });
  } else if (real.captureFpsPeak !== null && real.captureFpsPeak > 0 && real.captureFpsPeak < requested.fps * 0.85) {
    out.push({
      level: 'info',
      code: 'captura_fps',
      message: `A captura chegou a no máximo ${round(real.captureFpsPeak)} fps (pedido: ${requested.fps}). Com a tela parada isso é normal; com a imagem em movimento, é o limite real do navegador ou do monitor.`,
    });
  }

  if (captureHeight !== null && encodedHeight !== null && encodedHeight < captureHeight * 0.9) {
    out.push({
      level: 'aviso',
      code: 'resolucao_reduzida',
      message: `A resolução enviada caiu para ${encodedWidth}×${encodedHeight} (captura em ${captureWidth}×${captureHeight}).`,
    });
  }

  const reference = Math.min(real.captureFps ?? requested.fps, requested.fps);
  const fewerFrames =
    real.encodedFps !== null && real.captureFps !== null && real.captureFps >= 10 && real.encodedFps < reference * 0.8;
  const sent = real.encodedFps !== null ? `${round(real.encodedFps)} fps` : 'menos quadros';
  const captured = real.captureFps !== null ? `${round(real.captureFps)} fps` : `${requested.fps} fps`;

  if (!fewerFrames) {
    // Os quadros estão saindo, mas o próprio navegador declara uma limitação.
    const size = encodedWidth !== null && encodedHeight !== null ? `${encodedWidth}×${encodedHeight}` : 'a imagem';
    if (real.limitation === 'cpu') {
      out.push({
        level: 'aviso',
        code: 'cpu',
        message: `O navegador informa que o codificador de vídeo (CPU/GPU) está no limite. Enviando de fato ${size} a ${sent}.`,
      });
    } else if (real.limitation === 'bandwidth') {
      const flow = real.bitrateKbps !== null && real.targetKbps !== null ? `: saindo ${mbps(real.bitrateKbps)} de ${mbps(real.targetKbps)}` : '';
      out.push({
        level: 'aviso',
        code: 'banda',
        message: `O navegador informa que a conexão de envio está limitando a qualidade${flow}. Enviando de fato ${size} a ${sent}.`,
      });
    }
    return out;
  }

  const cause = shortfallCause(real);
  if (cause === 'subindo') {
    out.push({
      level: 'info',
      code: 'subindo',
      message: `A banda de envio estimada ainda está subindo${real.availableKbps !== null && real.targetKbps !== null ? ` (${mbps(real.availableKbps)} de ${mbps(real.targetKbps)})` : ''}. Por enquanto saem ${sent}; o valor sobe junto em alguns segundos.`,
    });
  } else if (cause === 'cpu') {
    const budget = real.captureFps ? ` Para ${captured} cada quadro teria de levar menos de ${(1000 / real.captureFps).toFixed(1).replace('.', ',')} ms` : '';
    const spent = real.encodeMs !== null && budget ? `, e está levando ${real.encodeMs.toFixed(1).replace('.', ',')} ms.` : budget ? '.' : '';
    out.push({
      level: 'aviso',
      code: 'cpu',
      message: `O codificador de vídeo (CPU/GPU) não acompanha: saem ${sent} dos ${captured} capturados.${budget}${spent}`,
    });
  } else if (cause === 'banda') {
    const room = real.availableKbps !== null ? ` comporta cerca de ${mbps(real.availableKbps)}` : ' não comporta o bitrate';
    const wanted = real.targetKbps !== null ? `, abaixo dos ${mbps(real.targetKbps)} pedidos` : '';
    out.push({
      level: 'aviso',
      code: 'banda',
      message: `Sua conexão de envio${room}${wanted}. Por isso saem ${sent} dos ${captured} capturados.`,
    });
  } else {
    out.push({
      level: 'aviso',
      code: 'fps_reduzido',
      message: `Estão sendo enviados ${sent}, abaixo dos ${captured} capturados.`,
    });
  }

  return out;
}
