import { describe, expect, it } from 'vitest';
import { estimateDelayMs, PeakWindow, readPublisher, readViewer, type RawStat, type UplinkInfo } from './stats.ts';

const at = (timestamp: number, stats: Omit<RawStat, 'timestamp'>[]): RawStat[] =>
  stats.map((item) => ({ ...item, timestamp }) as RawStat);

function publisherReport(timestamp: number, bytesSent: number, framesEncoded: number, extra: Record<string, unknown> = {}): RawStat[] {
  return at(timestamp, [
    { id: 'codec1', type: 'codec', mimeType: 'video/H264' },
    { id: 'src', type: 'media-source', kind: 'video', width: 1920, height: 1080, framesPerSecond: 118 },
    {
      id: 'out1',
      type: 'outbound-rtp',
      kind: 'video',
      codecId: 'codec1',
      frameWidth: 1920,
      frameHeight: 1080,
      framesPerSecond: 117,
      bytesSent,
      framesEncoded,
      totalEncodeTime: framesEncoded * 0.004,
      packetsSent: framesEncoded * 10,
      retransmittedPacketsSent: framesEncoded * 0.1,
      targetBitrate: 16_000_000,
      qualityLimitationReason: 'none',
      encoderImplementation: 'MediaFoundationVideoEncodeAccelerator',
      powerEfficientEncoder: true,
      ...extra,
    },
    { id: 'rin1', type: 'remote-inbound-rtp', kind: 'video', localId: 'out1', roundTripTime: 0.024, fractionLost: 0.005 },
    { id: 'tr', type: 'transport', selectedCandidatePairId: 'pair1' },
    { id: 'pair1', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.03, availableOutgoingBitrate: 22_000_000 },
  ]);
}

describe('estatísticas de quem transmite', () => {
  it('a primeira leitura não tem taxas (não há intervalo para medir)', () => {
    const { stats } = readPublisher(publisherReport(1000, 1_000_000, 100), null);
    expect(stats.bitrateKbps).toBeNull();
    expect(stats.encodeMs).toBeNull();
    expect(stats.width).toBe(1920);
    expect(stats.fps).toBe(117);
    expect(stats.captureFps).toBe(118);
  });

  it('calcula bitrate, tempo de codificação e retransmissão entre duas leituras', () => {
    const first = readPublisher(publisherReport(1000, 1_000_000, 100), null);
    const { stats } = readPublisher(publisherReport(2000, 2_850_000, 217), first.counters);
    expect(stats.bitrateKbps).toBeCloseTo(14_800, 0);
    expect(stats.encodeMs).toBeCloseTo(4, 3);
    expect(stats.retransmitPct).toBeCloseTo(1, 3);
    expect(stats.targetKbps).toBe(16_000);
    expect(stats.availableKbps).toBe(22_000);
    expect(stats.rttMs).toBeCloseTo(24, 5);
    expect(stats.lossPct).toBeCloseTo(0.5, 5);
    expect(stats.codec).toBe('H264');
    expect(stats.hardware).toBe(true);
    expect(stats.limitation).toBe('none');
  });

  it('repassa a limitação informada pelo navegador', () => {
    const { stats } = readPublisher(publisherReport(1000, 1, 1, { qualityLimitationReason: 'cpu' }), null);
    expect(stats.limitation).toBe('cpu');
  });

  it('com simulcast, mostra a camada de maior resolução e soma o bitrate de todas', () => {
    const layers = (timestamp: number, high: number, low: number): RawStat[] =>
      at(timestamp, [
        { id: 'low', type: 'outbound-rtp', kind: 'video', frameWidth: 960, frameHeight: 540, framesPerSecond: 30, bytesSent: low, framesEncoded: 1 },
        { id: 'high', type: 'outbound-rtp', kind: 'video', frameWidth: 1920, frameHeight: 1080, framesPerSecond: 60, bytesSent: high, framesEncoded: 1 },
      ]);
    const first = readPublisher(layers(0, 0, 0), null);
    const { stats } = readPublisher(layers(1000, 1_000_000, 125_000), first.counters);
    expect(stats.height).toBe(1080);
    expect(stats.fps).toBe(60);
    expect(stats.layers).toBe(2);
    expect(stats.bitrateKbps).toBeCloseTo(9000, 5);
  });

  it('ignora camadas desativadas ao escolher a principal', () => {
    const report = at(0, [
      { id: 'off', type: 'outbound-rtp', kind: 'video', active: false, frameWidth: 1920, frameHeight: 1080, bytesSent: 0 },
      { id: 'on', type: 'outbound-rtp', kind: 'video', active: true, frameWidth: 960, frameHeight: 540, framesPerSecond: 30, bytesSent: 0 },
    ]);
    const { stats } = readPublisher(report, null);
    expect(stats.height).toBe(540);
    expect(stats.layers).toBe(1);
  });

  it('relatório vazio vira tudo nulo, sem números inventados', () => {
    const { stats } = readPublisher([], null);
    expect(stats.fps).toBeNull();
    expect(stats.bitrateKbps).toBeNull();
    expect(stats.rttMs).toBeNull();
    expect(stats.hardware).toBeNull();
  });
});

function viewerReport(timestamp: number, counters: Record<string, number>): RawStat[] {
  return at(timestamp, [
    { id: 'codec9', type: 'codec', mimeType: 'video/VP9' },
    {
      id: 'in1',
      type: 'inbound-rtp',
      kind: 'video',
      codecId: 'codec9',
      frameWidth: 1920,
      frameHeight: 1080,
      framesPerSecond: 59,
      jitter: 0.004,
      decoderImplementation: 'D3D11VideoDecoder',
      powerEfficientDecoder: true,
      freezeCount: 1,
      ...counters,
    },
    { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.04 },
  ]);
}

describe('estatísticas de quem assiste', () => {
  const before = { bytesReceived: 0, packetsReceived: 0, packetsLost: 0, framesDecoded: 0, totalDecodeTime: 0, jitterBufferDelay: 0, jitterBufferEmittedCount: 0, framesDropped: 0 };

  it('calcula bitrate, perda, buffer e decodificação no intervalo', () => {
    const first = readViewer(viewerReport(0, before), null);
    const { stats } = readViewer(
      viewerReport(2000, {
        bytesReceived: 2_500_000,
        packetsReceived: 1980,
        packetsLost: 20,
        framesDecoded: 118,
        totalDecodeTime: 0.354,
        jitterBufferDelay: 4.72,
        jitterBufferEmittedCount: 118,
        framesDropped: 4,
      }),
      first.counters,
    );
    expect(stats.bitrateKbps).toBeCloseTo(10_000, 5);
    expect(stats.lossPct).toBeCloseTo(1, 5);
    expect(stats.bufferMs).toBeCloseTo(40, 5);
    expect(stats.decodeMs).toBeCloseTo(3, 5);
    expect(stats.droppedPerSecond).toBeCloseTo(2, 5);
    expect(stats.jitterMs).toBeCloseTo(4, 5);
    expect(stats.rttMs).toBeCloseTo(40, 5);
    expect(stats.codec).toBe('VP9');
    expect(stats.freezes).toBe(1);
  });

  it('perda nunca fica negativa quando chegam retransmissões atrasadas', () => {
    const first = readViewer(viewerReport(0, { ...before, packetsLost: 30, packetsReceived: 100 }), null);
    const { stats } = readViewer(viewerReport(1000, { ...before, packetsLost: 25, packetsReceived: 600 }), first.counters);
    expect(stats.lossPct).toBe(0);
  });

  it('recomeça as contas quando a faixa muda', () => {
    const first = readViewer(viewerReport(0, { ...before, bytesReceived: 9_000_000 }), null);
    const other = viewerReport(1000, { ...before, bytesReceived: 1000 }).map((item) => (item.id === 'in1' ? { ...item, id: 'in2' } : item));
    expect(readViewer(other, first.counters).stats.bitrateKbps).toBeNull();
  });
});

describe('atraso estimado', () => {
  const viewer = readViewer([], null).stats;
  const uplink: UplinkInfo = { encodeMs: 5, rttMs: 20, width: 1920, height: 1080, fps: 60, requestedHeight: 1080, requestedFps: 60, limitation: 'none', mode: 'manual' };

  it('soma as partes medidas dos dois lados', () => {
    expect(estimateDelayMs({ ...viewer, bufferMs: 40, decodeMs: 3, rttMs: 30 }, uplink)).toBeCloseTo(40 + 3 + 15 + 5 + 10, 5);
  });

  it('sem os dados de quem transmite, usa só o lado de quem assiste', () => {
    expect(estimateDelayMs({ ...viewer, bufferMs: 40, decodeMs: 3, rttMs: 30 }, null)).toBeCloseTo(58, 5);
  });

  it('sem a medida do buffer, não estima nada', () => {
    expect(estimateDelayMs({ ...viewer, bufferMs: null }, uplink)).toBeNull();
  });
});

describe('PeakWindow', () => {
  it('guarda o maior valor dentro da janela e esquece o que saiu dela', () => {
    const peak = new PeakWindow(10_000);
    expect(peak.push(null, 0)).toBeNull();
    expect(peak.push(60, 1000)).toBe(60);
    expect(peak.push(118, 2000)).toBe(118);
    expect(peak.push(3, 9000)).toBe(118);
    expect(peak.push(2, 12_500)).toBe(3);
    peak.reset();
    expect(peak.push(null, 13_000)).toBeNull();
  });
});
