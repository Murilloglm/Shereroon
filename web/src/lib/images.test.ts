// Foto de perfil e banner aceitam qualquer imagem que o app consiga abrir: o que o servidor não guarda como
// está (outro formato, grande demais, pequena demais) é convertido antes de enviar. Animação não se perde
// em silêncio: GIF/WebP/PNG animados vão como estão ou são recusados com o motivo.
import { describe, expect, it } from 'vitest';
import { planImage, PROFILE_IMAGE_LIMITS, unreadableMessage } from './images.ts';

const MB = 1024 * 1024;
const image = (over: Partial<Parameters<typeof planImage>[0]> = {}) => ({ mime: 'image/png' as const, bytes: 200_000, width: 800, height: 600, animated: false, ...over });

describe('planImage: foto de perfil', () => {
  it('PNG, JPEG, GIF e WebP dentro dos limites vão como estão', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const) {
      expect(planImage(image({ mime }), 'avatar')).toEqual({ action: 'manter' });
    }
  });

  it('outro formato (BMP, AVIF, SVG, ICO...) é convertido mantendo o tamanho', () => {
    expect(planImage(image({ mime: null, width: 500, height: 400 }), 'avatar')).toEqual({ action: 'converter', width: 500, height: 400 });
  });

  it('grande demais (lados ou bytes) é reduzida mantendo a proporção', () => {
    expect(planImage(image({ width: 4000, height: 3000 }), 'avatar')).toEqual({ action: 'converter', width: 1024, height: 768 });
    expect(planImage(image({ bytes: 3 * MB, width: 1800, height: 1800 }), 'avatar')).toEqual({ action: 'converter', width: 1024, height: 1024 });
  });

  it('pequena demais é ampliada até o mínimo', () => {
    expect(planImage(image({ width: 16, height: 16 }), 'avatar')).toEqual({ action: 'converter', width: 32, height: 32 });
  });

  it('animada dentro dos limites vai como está; grande demais é recusada (não vira imagem parada sem avisar)', () => {
    expect(planImage(image({ mime: 'image/gif', animated: true, bytes: 3 * MB }), 'avatar')).toEqual({ action: 'manter' });
    const big = planImage(image({ mime: 'image/gif', animated: true, bytes: 5 * MB }), 'avatar');
    expect(big.action).toBe('recusar');
    expect(big.action === 'recusar' && big.reason).toMatch(/animada passa de 4 MB/);
    const huge = planImage(image({ mime: 'image/webp', animated: true, width: 3000, height: 3000 }), 'avatar');
    expect(huge.action === 'recusar' && huge.reason).toMatch(/2048/);
  });

  it('proporção impossível (muito estreita) é recusada com o motivo', () => {
    const plan = planImage(image({ width: 10000, height: 20 }), 'avatar');
    expect(plan.action).toBe('recusar');
  });
});

describe('planImage: banner', () => {
  it('dentro dos limites vai como está; grande é reduzido; estreito é ampliado até 300 × 100', () => {
    expect(planImage(image({ width: 1500, height: 500 }), 'banner')).toEqual({ action: 'manter' });
    expect(planImage(image({ width: 6000, height: 2000 }), 'banner')).toEqual({ action: 'converter', width: 2400, height: 800 });
    expect(planImage(image({ width: 150, height: 50 }), 'banner')).toEqual({ action: 'converter', width: 300, height: 100 });
  });

  it('os limites seguem os do servidor', () => {
    expect(PROFILE_IMAGE_LIMITS.avatar).toMatchObject({ minWidth: 32, minHeight: 32, maxSide: 2048, bytes: 2 * MB, animatedBytes: 4 * MB });
    expect(PROFILE_IMAGE_LIMITS.banner).toMatchObject({ minWidth: 300, minHeight: 100, maxSide: 4096, bytes: 6 * MB, animatedBytes: 6 * MB });
  });
});

describe('mensagem quando o app não consegue abrir o arquivo', () => {
  it('cita a extensão e sugere JPG ou PNG', () => {
    expect(unreadableMessage('IMG_0001.HEIC')).toMatch(/\.heic.*JPG ou PNG/i);
    expect(unreadableMessage('sem-extensao')).toMatch(/JPG ou PNG/);
  });
});
