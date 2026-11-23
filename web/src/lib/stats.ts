/**
 * Leitura das estatísticas reais do WebRTC (RTCStatsReport). Nada aqui é estimado
 * a partir do que foi pedido: se o navegador não informa um valor, ele fica null.
 */
import type { Limitation } from './quality.ts';

export type RawStat = { id: string; type: string; timestamp: number } & Record<string, unknown>;

export function collect(report: RTCStatsReport | undefined | null): RawStat[] {
  const out: RawStat[] = [];
  report?.forEach((entry) => out.push(entry as RawStat));
  return out;
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/** Variação por segundo entre duas leituras de um contador. Null se não der para calcular. */
function rate(current: number | null, previous: number | null | undefined, seconds: number): number | null {
  if (current === null || previous === null || previous === undefined || seconds <= 0) return null;
  return Math.max(0, current - previous) / seconds;
}

/** Média de (soma de tempos) / (quantidade) dentro do intervalo, em milissegundos. */
function meanMs(
  totalNow: number | null,
  totalBefore: number | null | undefined,
  countNow: number | null,
  countBefore: number | null | undefined,
): number | null {
  if (totalNow === null || countNow === null || totalBefore == null || countBefore == null) return null;
  const count = countNow - countBefore;
  if (count <= 0) return null;
  return (Math.max(0, totalNow - totalBefore) / count) * 1000;
}

function selectedPair(stats: RawStat[]): RawStat | undefined {
  const transport = stats.find((item) => item.type === 'transport' && item.selectedCandidatePairId);
  const byId = transport && stats.find((item) => item.id === transport.selectedCandidatePairId);
  if (byId) return byId;
  const pairs = stats.filter((item) => item.type === 'candidate-pair' && item.state === 'succeeded');
  return pairs.find((item) => item.nominated === true) ?? pairs[0];
}

function codecName(stats: RawStat[], codecId: unknown): string | null {
  const codec = stats.find((item) => item.type === 'codec' && item.id === codecId);
  const mime = text(codec?.mimeType);
  return mime ? mime.replace(/^video\//i, '').replace(/^audio\//i, '').toUpperCase() : null;
}

function limitation(value: unknown): Limitation {
  return value === 'cpu' || value === 'bandwidth' || value === 'other' || value === 'none' ? value : 'unknown';
}

// --- Quem transmite ----------------------------------------------------------

export interface PublisherCounters {
  timestamp: number;
  bytes: number | null;
  topId: string | null;
  framesSent: number | null;
  framesEncoded: number | null;
  encodeTime: number | null;
  packetsSent: number | null;
  retransmitted: number | null;
}

export interface PublisherStats {
  sentFps: number | null;
  dropped: number | null;
  captureWidth: number | null;
  captureHeight: number | null;
  captureFps: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  targetKbps: number | null;
  availableKbps: number | null;
  limitation: Limitation;
  encoder: string | null;
  /** true = codificador por hardware (GPU); false = software; null = o navegador não informou. */
  hardware: boolean | null;
  codec: string | null;
  scalability: string | null;
  layers: number;
  rttMs: number | null;
  lossPct: number | null;
  encodeMs: number | null;
  retransmitPct: number | null;
}

export function readPublisher(
  stats: RawStat[],
  previous: PublisherCounters | null,
): { stats: PublisherStats; counters: PublisherCounters } {
  const outbound = stats.filter((item) => item.type === 'outbound-rtp' && (item.kind ?? item.mediaType) === 'video');
  const active = outbound.filter((item) => item.active !== false);
  const pixels = (item: RawStat) => (num(item.frameWidth) ?? 0) * (num(item.frameHeight) ?? 0);
  // Com simulcast há uma entrada por camada; a principal é a de maior resolução.
  const top = [...active].sort((a, b) => pixels(b) - pixels(a))[0];
  const source = stats.find((item) => item.type === 'media-source' && item.kind === 'video');
  const remote =
    stats.find((item) => item.type === 'remote-inbound-rtp' && top !== undefined && item.localId === top.id) ??
    stats.find((item) => item.type === 'remote-inbound-rtp' && item.kind === 'video');
  const pair = selectedPair(stats);

  const timestamp = top?.timestamp ?? stats[0]?.timestamp ?? 0;
  const bytes = outbound.length > 0 ? outbound.reduce((total, item) => total + (num(item.bytesSent) ?? 0), 0) : null;
  const counters: PublisherCounters = {
    timestamp,
    bytes,
    topId: top?.id ?? null,
    framesSent: num(top?.framesSent),
    framesEncoded: num(top?.framesEncoded),
    encodeTime: num(top?.totalEncodeTime),
    packetsSent: num(top?.packetsSent),
    retransmitted: num(top?.retransmittedPacketsSent),
  };

  const seconds = previous ? (timestamp - previous.timestamp) / 1000 : 0;
  const sameTop = previous !== null && previous.topId === counters.topId;
  const bytesPerSecond = rate(bytes, previous?.bytes, seconds);
  const sentPackets = sameTop ? rate(counters.packetsSent, previous?.packetsSent, seconds) : null;
  const resent = sameTop ? rate(counters.retransmitted, previous?.retransmitted, seconds) : null;

  const targetBps = outbound.reduce<number | null>((total, item) => {
    const value = num(item.targetBitrate);
    return value === null ? total : (total ?? 0) + value;
  }, null);
  const rtt = num(remote?.roundTripTime) ?? num(pair?.currentRoundTripTime);
  const lost = num(remote?.fractionLost);
  const available = num(pair?.availableOutgoingBitrate);

  return {
    counters,
    stats: {
      captureWidth: num(source?.width),
      captureHeight: num(source?.height),
      captureFps: num(source?.framesPerSecond),
      width: num(top?.frameWidth),
      height: num(top?.frameHeight),
      fps: num(top?.framesPerSecond) ?? (sameTop ? rate(counters.framesEncoded, previous?.framesEncoded, seconds) : null),
      sentFps: sameTop ? rate(counters.framesSent, previous?.framesSent, seconds) : null,
      dropped: num(top?.framesDropped),
      bitrateKbps: bytesPerSecond === null ? null : (bytesPerSecond * 8) / 1000,
      targetKbps: targetBps === null ? null : targetBps / 1000,
      availableKbps: available === null ? null : available / 1000,
      limitation: limitation(top?.qualityLimitationReason),
      encoder: text(top?.encoderImplementation),
      hardware: flag(top?.powerEfficientEncoder),
      codec: codecName(stats, top?.codecId),
      scalability: text(top?.scalabilityMode),
      layers: active.length,
      rttMs: rtt === null ? null : rtt * 1000,
      lossPct: lost === null ? null : lost * 100,
      encodeMs: sameTop
        ? meanMs(counters.encodeTime, previous?.encodeTime, counters.framesEncoded, previous?.framesEncoded)
        : null,
      retransmitPct: sentPackets && resent !== null ? (resent / sentPackets) * 100 : null,
    },
  };
}

// --- Quem assiste ------------------------------------------------------------

export interface ViewerCounters {
  framesReceived: number | null;
  timestamp: number;
  id: string | null;
  bytes: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  framesDecoded: number | null;
  decodeTime: number | null;
  bufferDelay: number | null;
  bufferEmitted: number | null;
  framesDropped: number | null;
}

export interface ViewerStats {
  receivedFps: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  lossPct: number | null;
  jitterMs: number | null;
  /** Tempo médio que cada quadro esperou no buffer antes de ser exibido. */
  bufferMs: number | null;
  decodeMs: number | null;
  rttMs: number | null;
  droppedPerSecond: number | null;
  freezes: number | null;
  decoder: string | null;
  hardware: boolean | null;
  codec: string | null;
}

export function readViewer(stats: RawStat[], previous: ViewerCounters | null): { stats: ViewerStats; counters: ViewerCounters } {
  const inbound = stats.find((item) => item.type === 'inbound-rtp' && (item.kind ?? item.mediaType) === 'video');
  const pair = selectedPair(stats);

  const counters: ViewerCounters = {
    timestamp: inbound?.timestamp ?? stats[0]?.timestamp ?? 0,
    id: inbound?.id ?? null,
    bytes: num(inbound?.bytesReceived),
    packetsReceived: num(inbound?.packetsReceived),
    packetsLost: num(inbound?.packetsLost),
    framesReceived: num(inbound?.framesReceived),
    framesDecoded: num(inbound?.framesDecoded),
    decodeTime: num(inbound?.totalDecodeTime),
    bufferDelay: num(inbound?.jitterBufferDelay),
    bufferEmitted: num(inbound?.jitterBufferEmittedCount),
    framesDropped: num(inbound?.framesDropped),
  };

  const before = previous !== null && previous.id === counters.id ? previous : null;
  const seconds = before ? (counters.timestamp - before.timestamp) / 1000 : 0;
  const bytesPerSecond = rate(counters.bytes, before?.bytes, seconds);

  let lossPct: number | null = null;
  if (before && counters.packetsLost !== null && before.packetsLost !== null && counters.packetsReceived !== null && before.packetsReceived !== null) {
    // packetsLost pode diminuir quando chegam retransmissões atrasadas.
    const lost = Math.max(0, counters.packetsLost - before.packetsLost);
    const received = Math.max(0, counters.packetsReceived - before.packetsReceived);
    lossPct = lost + received > 0 ? (lost / (lost + received)) * 100 : 0;
  }

  const jitter = num(inbound?.jitter);
  const rtt = num(pair?.currentRoundTripTime);

  return {
    counters,
    stats: {
      width: num(inbound?.frameWidth),
      height: num(inbound?.frameHeight),
      fps: num(inbound?.framesPerSecond) ?? rate(counters.framesDecoded, before?.framesDecoded, seconds),
      receivedFps: rate(counters.framesReceived, before?.framesReceived, seconds),
      bitrateKbps: bytesPerSecond === null ? null : (bytesPerSecond * 8) / 1000,
      lossPct,
      jitterMs: jitter === null ? null : jitter * 1000,
      bufferMs: meanMs(counters.bufferDelay, before?.bufferDelay, counters.bufferEmitted, before?.bufferEmitted),
      decodeMs: meanMs(counters.decodeTime, before?.decodeTime, counters.framesDecoded, before?.framesDecoded),
      rttMs: rtt === null ? null : rtt * 1000,
      droppedPerSecond: rate(counters.framesDropped, before?.framesDropped, seconds),
      freezes: num(inbound?.freezeCount),
      decoder: text(inbound?.decoderImplementation),
      hardware: flag(inbound?.powerEfficientDecoder),
      codec: codecName(stats, inbound?.codecId),
    },
  };
}

/** O que quem transmite informa aos espectadores (pelo canal de dados) sobre o próprio lado. */
export interface UplinkInfo {
  encodeMs: number | null;
  rttMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  requestedHeight: number;
  requestedFps: number;
  limitation: Limitation;
  mode: 'auto' | 'manual';
  /** Atraso medido do áudio dos aplicativos antes do WebRTC (captura + filas), em ms. Ausente sem esse áudio. */
  audioDelayMs?: number | null;
}

/**
 * Atraso estimado de ponta a ponta para quem assiste. É uma soma de partes medidas
 * (codificação, rede nos dois trechos, buffer e decodificação), não uma medição direta —
 * a interface sempre mostra como "estimado".
 */
export function estimateDelayMs(viewer: ViewerStats, uplink: UplinkInfo | null): number | null {
  if (viewer.bufferMs === null || viewer.decodeMs === null || viewer.rttMs === null ||
      !uplink || uplink.encodeMs === null || uplink.rttMs === null) return null;
  return viewer.bufferMs + viewer.decodeMs + uplink.encodeMs + (viewer.rttMs + uplink.rttMs) / 2;
}

/** Guarda o maior valor visto em uma janela de tempo (para o pico de FPS de captura). */
export class PeakWindow {
  readonly #windowMs: number;
  #samples: { time: number; value: number }[] = [];

  constructor(windowMs: number) {
    this.#windowMs = windowMs;
  }

  push(value: number | null, now: number): number | null {
    if (value !== null) this.#samples.push({ time: now, value });
    this.#samples = this.#samples.filter((sample) => now - sample.time <= this.#windowMs);
    return this.#samples.length === 0 ? null : Math.max(...this.#samples.map((sample) => sample.value));
  }

  reset(): void {
    this.#samples = [];
  }
}
