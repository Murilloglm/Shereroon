import { describe, expect, it } from 'vitest';
import { AvSyncController, MAX_TARGET_MS } from './av-sync.ts';

/** Modelo do navegador medido no experimento: o buffer do vídeo fica 20 ms abaixo do alvo pedido. */
function browserBuffer(target: number | null, natural: number): number {
  return target === null ? natural : Math.max(natural, target - 20);
}

describe('AvSyncController', () => {
  it('sem áudio de aplicativo (ou com atraso imperceptível) não mexe na imagem', () => {
    const sync = new AvSyncController();
    expect(sync.update({ videoBufferMs: 30, audioDelayMs: null })).toBeNull();
    expect(sync.update({ videoBufferMs: 30, audioDelayMs: 8 })).toBeNull();
    expect(sync.compensationMs).toBe(0);
  });

  it('segura o vídeo o mesmo tanto que o áudio chega atrasado, corrigindo pelo buffer medido', () => {
    const sync = new AvSyncController();
    const natural = 30;
    const delay = 150;
    let target: number | null = null;
    for (let second = 0; second < 12; second++) {
      target = sync.update({ videoBufferMs: browserBuffer(target, natural), audioDelayMs: delay });
    }
    const added = browserBuffer(target, natural) - natural;
    expect(Math.abs(added - delay)).toBeLessThan(10);
    expect(Math.abs(sync.compensationMs - delay)).toBeLessThan(10);
  });

  it('acompanha quando o atraso do áudio muda e desliga quando o áudio some', () => {
    const sync = new AvSyncController();
    let target: number | null = null;
    for (let i = 0; i < 10; i++) target = sync.update({ videoBufferMs: browserBuffer(target, 20), audioDelayMs: 120 });
    for (let i = 0; i < 12; i++) target = sync.update({ videoBufferMs: browserBuffer(target, 20), audioDelayMs: 60 });
    expect(Math.abs(browserBuffer(target, 20) - 20 - 60)).toBeLessThan(10);
    expect(sync.update({ videoBufferMs: 80, audioDelayMs: null })).toBeNull();
  });

  it('nunca passa do teto, mesmo com atraso absurdo', () => {
    const sync = new AvSyncController();
    let target: number | null = null;
    for (let i = 0; i < 20; i++) target = sync.update({ videoBufferMs: browserBuffer(target, 50), audioDelayMs: 2000 });
    expect(target).toBe(MAX_TARGET_MS);
  });
});
