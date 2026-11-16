import { describe, expect, it } from 'vitest';
import { preferHardwareH264, type CodecLike } from './h264.ts';

const h264 = (profile: string, mode = 1): CodecLike => ({
  mimeType: 'video/H264',
  sdpFmtpLine: `level-asymmetry-allowed=1;packetization-mode=${mode};profile-level-id=${profile}`,
});
const other = (mimeType: string): CodecLike => ({ mimeType });
const profiles = (codecs: CodecLike[] | null) =>
  codecs?.map((codec) => (/h264/i.test(codec.mimeType) ? /profile-level-id=(\w+)/.exec(codec.sdpFmtpLine!)![1] : codec.mimeType));

// Lista real do Chrome 157 no Windows com placa NVIDIA (ordem do navegador).
const chromeWithGpu: CodecLike[] = [
  other('video/VP8'),
  other('video/rtx'),
  h264('42001f'),
  h264('42001f', 0),
  h264('42e01f'),
  h264('42e01f', 0),
  h264('4d001f'),
  h264('4d001f', 0),
  h264('640032'),
  other('video/AV1'),
  other('video/VP9'),
  other('video/red'),
];

describe('preferência por H.264 com hardware', () => {
  it('põe High e Main na frente e tira o Constrained Baseline (o único codificado por software)', () => {
    expect(profiles(preferHardwareH264(chromeWithGpu))).toEqual([
      'video/VP8',
      'video/rtx',
      '640032',
      '4d001f',
      '4d001f',
      '42001f',
      '42001f',
      'video/AV1',
      'video/VP9',
      'video/red',
    ]);
  });

  it('não mexe nos outros codecs nem na ordem deles', () => {
    const result = preferHardwareH264(chromeWithGpu)!;
    expect(result.filter((codec) => !/h264/i.test(codec.mimeType))).toEqual(chromeWithGpu.filter((codec) => !/h264/i.test(codec.mimeType)));
  });

  it('sem variante por hardware (só Baseline), deixa tudo como está', () => {
    expect(preferHardwareH264([other('video/VP8'), h264('42001f'), h264('42e01f'), other('video/VP9')])).toBeNull();
  });

  it('sem H.264 nenhum, deixa tudo como está', () => {
    expect(preferHardwareH264([other('video/VP8'), other('video/VP9')])).toBeNull();
    expect(preferHardwareH264([])).toBeNull();
  });

  it('aceita o profile-level-id em maiúsculas', () => {
    const upper: CodecLike = { mimeType: 'video/h264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=640C1F' };
    expect(preferHardwareH264([h264('42e01f'), upper])).toEqual([upper]);
  });
});
