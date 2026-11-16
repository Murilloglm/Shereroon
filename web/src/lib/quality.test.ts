import { describe, expect, it } from 'vitest';
import {
  AUTO_LADDER,
  BAD_TO_DROP,
  BASE_GOOD_TO_RISE,
  buildLadder,
  captureConstraints,
  contentHintFor,
  DEFAULT_QUALITY,
  DEGRADATION,
  diagnose,
  effectiveBitrateKbps,
  FRAME_RATES,
  initialAutoState,
  isRamping,
  isStruggling,
  presetBitrateKbps,
  RESOLUTIONS,
  sanitizeQuality,
  shortfallCause,
  stepAuto,
  type AutoSample,
  type AutoState,
  type RealQuality,
} from './quality.ts';

const healthy: AutoSample = { limitation: 'none', captureFps: 120, encodedFps: 118, lossPct: 0, ramping: false };
// Com "maintain-resolution" o navegador não declara limitação: o sinal é sair menos quadros do que entram.
const cpuBound: AutoSample = { limitation: 'none', captureFps: 120, encodedFps: 70, lossPct: 0, ramping: false };

function run(state: AutoState, sample: AutoSample, times: number, length = AUTO_LADDER.length) {
  const changes: string[] = [];
  for (let index = 0; index < times; index++) {
    const result = stepAuto(state, sample, length);
    state = result.state;
    if (result.change) changes.push(result.change);
  }
  return { state, changes };
}

describe('presets', () => {
  it('toda combinação de resolução e FPS tem bitrate, e ele cresce com ambos', () => {
    for (const height of RESOLUTIONS) {
      let previous = 0;
      for (const fps of FRAME_RATES) {
        const kbps = presetBitrateKbps({ height, fps }, 'h264');
        expect(kbps).toBeGreaterThan(previous);
        previous = kbps;
      }
    }
    expect(presetBitrateKbps({ height: 1080, fps: 120 }, 'h264')).toBeGreaterThan(presetBitrateKbps({ height: 720, fps: 120 }, 'h264'));
  });

  it('codecs mais eficientes pedem menos banda', () => {
    const target = { height: 1080, fps: 60 } as const;
    expect(presetBitrateKbps(target, 'av1')).toBeLessThan(presetBitrateKbps(target, 'vp9'));
    expect(presetBitrateKbps(target, 'vp9')).toBeLessThan(presetBitrateKbps(target, 'h264'));
  });

  it('o teto manual só vale no modo manual', () => {
    const target = { height: 720, fps: 60 } as const;
    expect(effectiveBitrateKbps({ ...DEFAULT_QUALITY, mode: 'manual', bitrateKbps: 1234 }, target, 'h264')).toBe(1234);
    expect(effectiveBitrateKbps({ ...DEFAULT_QUALITY, mode: 'auto', bitrateKbps: 1234 }, target, 'h264')).toBe(5000);
  });

  it('a captura pede no máximo a caixa escolhida, sem ampliar a fonte', () => {
    expect(captureConstraints({ height: 900, fps: 90 })).toEqual({
      width: { max: 1600 },
      height: { max: 900 },
      frameRate: { ideal: 90, max: 90 },
    });
  });

  it('o WebRTC nunca troca a resolução sozinho; o tipo de conteúdo vira dica para o codificador', () => {
    expect(DEGRADATION).toBe('maintain-resolution');
    expect(contentHintFor('movimento')).toBe('motion');
    expect(contentHintFor('texto')).toBe('detail');
  });
});

describe('sanitizeQuality', () => {
  it('descarta valores inválidos guardados no navegador', () => {
    expect(sanitizeQuality({ mode: 'turbo', resolution: 4320, fps: 240, codec: 'h265', bitrateKbps: 'muito' })).toEqual(DEFAULT_QUALITY);
    expect(sanitizeQuality(null)).toEqual(DEFAULT_QUALITY);
  });

  it('mantém escolhas válidas e limita o bitrate', () => {
    const value = sanitizeQuality({ mode: 'manual', resolution: 900, fps: 90, codec: 'av1', content: 'texto', bitrateKbps: 999_999, lightLayer: true });
    expect(value).toEqual({ mode: 'manual', resolution: 900, fps: 90, codec: 'av1', content: 'texto', bitrateKbps: 50_000, lightLayer: true });
  });
});

describe('degraus do modo automático', () => {
  it('começa em 1080p120 e desce em pixels por segundo', () => {
    expect(AUTO_LADDER[0]).toEqual({ height: 1080, fps: 120 });
    const load = AUTO_LADDER.map((step) => step.height * step.height * (16 / 9) * step.fps);
    for (let index = 1; index < load.length; index++) expect(load[index]!).toBeLessThan(load[index - 1]!);
  });

  it('respeita o teto de FPS da captura (cai para 60 quando não há 120)', () => {
    const ladder = buildLadder({ maxHeight: 1080, maxFps: 60 });
    expect(ladder[0]).toEqual({ height: 1080, fps: 60 });
    expect(ladder.every((step) => step.fps <= 60)).toBe(true);
    expect(buildLadder({ maxHeight: 1080, maxFps: 30 }).every((step) => step.fps === 30)).toBe(true);
  });

  it('não gasta degraus que não mudam nada numa janela pequena', () => {
    const ladder = buildLadder({ maxHeight: 720, maxFps: 120 });
    const effective = ladder.map((step) => `${Math.min(step.height, 720)}@${step.fps}`);
    expect(new Set(effective).size).toBe(effective.length);
  });
});

describe('controlador automático', () => {
  it('fica no topo enquanto tudo vai bem', () => {
    const { state, changes } = run(initialAutoState(), healthy, 100);
    expect(state.level).toBe(0);
    expect(changes).toEqual([]);
  });

  it('só desce depois de amostras ruins seguidas', () => {
    let state = initialAutoState();
    for (let index = 0; index < BAD_TO_DROP - 1; index++) state = stepAuto(state, cpuBound, 7).state;
    expect(state.level).toBe(0);
    const result = stepAuto(state, cpuBound, 7);
    expect(result.change).toBe('down');
    expect(result.state.level).toBe(1);
  });

  it('uma amostra boa no meio zera a contagem', () => {
    let state = initialAutoState();
    state = stepAuto(state, cpuBound, 7).state;
    state = stepAuto(state, cpuBound, 7).state;
    state = stepAuto(state, healthy, 7).state;
    state = stepAuto(state, cpuBound, 7).state;
    expect(state.level).toBe(0);
  });

  it('nunca passa do último degrau', () => {
    const { state } = run(initialAutoState(), cpuBound, 500);
    expect(state.level).toBe(AUTO_LADDER.length - 1);
  });

  it('volta a subir depois de um período estável', () => {
    const down = run(initialAutoState(), cpuBound, BAD_TO_DROP * 2).state;
    expect(down.level).toBe(2);
    const { state, changes } = run(down, healthy, BASE_GOOD_TO_RISE * 2);
    expect(changes).toEqual(['up', 'up']);
    expect(state.level).toBe(0);
  });

  it('se subir e não aguentar, espera o dobro antes de tentar de novo', () => {
    let state = run(initialAutoState(), cpuBound, BAD_TO_DROP).state;
    state = run(state, healthy, BASE_GOOD_TO_RISE).state;
    expect(state.level).toBe(0);
    state = run(state, cpuBound, BAD_TO_DROP).state;
    expect(state.level).toBe(1);
    expect(state.goodNeeded).toBe(BASE_GOOD_TO_RISE * 2);
    expect(run(state, healthy, BASE_GOOD_TO_RISE).state.level).toBe(1);
    expect(run(state, healthy, BASE_GOOD_TO_RISE * 2).state.level).toBe(0);
  });

  it('tela parada (poucos quadros capturados) não conta como problema', () => {
    expect(isStruggling({ limitation: 'none', captureFps: 2, encodedFps: 1, lossPct: 0, ramping: false })).toBe(false);
    expect(isStruggling({ limitation: 'none', captureFps: null, encodedFps: null, lossPct: null, ramping: false })).toBe(false);
  });

  it('perda alta de pacotes, codificador atrasado e limitação declarada contam', () => {
    expect(isStruggling({ limitation: 'none', captureFps: 120, encodedFps: 119, lossPct: 12, ramping: false })).toBe(true);
    expect(isStruggling({ limitation: 'none', captureFps: 120, encodedFps: 60, lossPct: 0, ramping: false })).toBe(true);
    expect(isStruggling({ limitation: 'bandwidth', captureFps: 60, encodedFps: 60, lossPct: 0, ramping: false })).toBe(true);
    expect(isStruggling({ limitation: 'cpu', captureFps: 60, encodedFps: 60, lossPct: 0, ramping: false })).toBe(true);
  });

  it('enquanto a banda estimada sobe, quadros a menos não derrubam a qualidade', () => {
    const climbing: AutoSample = { limitation: 'none', captureFps: 120, encodedFps: 30, lossPct: 0, ramping: true };
    expect(isStruggling(climbing)).toBe(false);
    expect(run(initialAutoState(), climbing, 30).state.level).toBe(0);
  });
});

describe('subida da banda estimada', () => {
  it('reconhece a subida inicial (medida real: 5,3 → 6,5 → 8,0 → 10,0 Mbps rumo a 16)', () => {
    expect(isRamping([5339, 6489, 7970, 9979], 16000)).toBe(true);
  });

  it('banda estável ou caindo não é subida', () => {
    expect(isRamping([6000, 6050, 5990, 6020], 16000)).toBe(false);
    expect(isRamping([9000, 7000, 6000, 5000], 16000)).toBe(false);
  });

  it('depois de passar do alvo com folga, a subida acabou', () => {
    expect(isRamping([15000, 19000, 23700, 28100], 16000)).toBe(false);
  });

  it('precisa de pelo menos três leituras', () => {
    expect(isRamping([5000, 9000], 16000)).toBe(false);
    expect(isRamping([null, null, 5000, 9000], 16000)).toBe(false);
    expect(isRamping([5000, 7000, 9000], null)).toBe(false);
  });
});

describe('pedido × real', () => {
  const asRequested: RealQuality = {
    captureWidth: 1920,
    captureHeight: 1080,
    captureFps: 120,
    captureFpsPeak: 120,
    encodedWidth: 1920,
    encodedHeight: 1080,
    encodedFps: 119,
    limitation: 'none',
    bitrateKbps: 15000,
    targetKbps: 16000,
    availableKbps: 28000,
    encodeMs: 2.1,
    ramping: false,
  };
  const requested = { height: 1080, fps: 120 } as const;
  const codes = (real: RealQuality) => diagnose(requested, real).map((item) => item.code);

  it('não avisa nada quando o real bate com o pedido', () => {
    expect(diagnose(requested, asRequested)).toEqual([]);
  });

  it('avisa quando a captura não passa de 60 fps', () => {
    const result = diagnose(requested, { ...asRequested, captureFps: 60, captureFpsPeak: 60, encodedFps: 60 });
    expect(result.map((item) => item.code)).toEqual(['captura_fps']);
    expect(result[0]!.message).toContain('60 fps');
    expect(result[0]!.message).toContain('120');
  });

  it('tela inteira parada em 60 fps com pedido de 120: aponta o limite e o que fazer', () => {
    const stuck = { ...asRequested, captureFps: 60, captureFpsPeak: 61, encodedFps: 60, surface: 'monitor' as const };
    const result = diagnose(requested, stuck);
    expect(result.map((item) => item.code)).toEqual(['monitor_60']);
    expect(result[0]!.level).toBe('aviso');
    expect(result[0]!.message).toContain('aba do navegador');
    // Janela de outro programa tem o mesmo limite (medido); o aviso não manda "compartilhar a janela do jogo".
    expect(codes({ ...stuck, surface: 'window' })).toEqual(['janela_60']);
    expect(diagnose(requested, { ...stuck, surface: 'window' })[0]!.message).not.toContain('janela do jogo');
    // Aba em 60 fps não é esse limite: cai no aviso genérico de captura.
    expect(codes({ ...stuck, surface: 'browser' })).toEqual(['captura_fps']);
    // Janela do próprio navegador rendendo 120 fps não recebe aviso nenhum.
    expect(codes({ ...stuck, surface: 'window', captureFps: 120, captureFpsPeak: 120, encodedFps: 120 })).toEqual([]);
    // Tela parada (poucos quadros) também não.
    expect(codes({ ...stuck, captureFps: 3, captureFpsPeak: 5, encodedFps: 3 })).toEqual(['captura_fps']);
    // Pedindo 60, não há o que avisar.
    expect(diagnose({ height: 1080, fps: 60 }, stuck)).toEqual([]);
  });

  it('durante a subida da banda, explica em vez de alarmar', () => {
    const result = diagnose(requested, { ...asRequested, encodedFps: 44, availableKbps: 7756, ramping: true });
    expect(result.map((item) => item.code)).toEqual(['subindo']);
    expect(result[0]!.level).toBe('info');
    expect(result[0]!.message).toContain('7,8 Mbps de 16,0 Mbps');
    expect(result[0]!.message).toContain('44 fps');
  });

  it('culpa a conexão quando a banda estimada fica abaixo do pedido', () => {
    const real = { ...asRequested, encodedFps: 19, availableKbps: 1300, bitrateKbps: 1200 };
    expect(shortfallCause(real)).toBe('banda');
    const result = diagnose(requested, real);
    expect(result.map((item) => item.code)).toEqual(['banda']);
    expect(result[0]!.level).toBe('aviso');
    expect(result[0]!.message).toContain('1,3 Mbps');
    expect(result[0]!.message).toContain('16,0 Mbps');
    expect(result[0]!.message).toContain('19 fps dos 120 fps');
  });

  it('culpa o codificador quando ele gasta mais tempo por quadro do que o disponível', () => {
    // A 120 fps cada quadro tem 8,3 ms; gastar 14 ms não fecha a conta.
    const real = { ...asRequested, encodedFps: 68, encodeMs: 14 };
    expect(shortfallCause(real)).toBe('cpu');
    const result = diagnose(requested, real);
    expect(result.map((item) => item.code)).toEqual(['cpu']);
    expect(result[0]!.message).toContain('68 fps dos 120 fps');
    expect(result[0]!.message).toContain('8,3 ms');
    expect(result[0]!.message).toContain('14,0 ms');
  });

  it('sem causa mensurável, relata só o fato', () => {
    const real = { ...asRequested, encodedFps: 55 };
    expect(shortfallCause(real)).toBe('indefinido');
    expect(codes(real)).toEqual(['fps_reduzido']);
  });

  it('repassa a limitação declarada pelo navegador mesmo sem queda de FPS', () => {
    const cpu = diagnose(requested, { ...asRequested, limitation: 'cpu' });
    expect(cpu.map((item) => item.code)).toEqual(['cpu']);
    expect(cpu[0]!.message).toContain('1920×1080');
    const band = diagnose(requested, { ...asRequested, limitation: 'bandwidth', bitrateKbps: 4200 });
    expect(band[0]!.code).toBe('banda');
    expect(band[0]!.message).toContain('4,2 Mbps de 16,0 Mbps');
  });

  it('informa quando a fonte é menor que o pedido, mas não quando é só outra proporção', () => {
    expect(codes({ ...asRequested, captureWidth: 1280, captureHeight: 720, encodedWidth: 1280, encodedHeight: 720 })).toContain('fonte_menor');
    // Ultrawide: bate na largura máxima, então a altura menor é esperada.
    expect(codes({ ...asRequested, captureWidth: 1920, captureHeight: 804, encodedWidth: 1920, encodedHeight: 804 })).not.toContain('fonte_menor');
  });

  it('aponta resolução enviada menor que a capturada', () => {
    expect(codes({ ...asRequested, encodedWidth: 1280, encodedHeight: 720 })).toContain('resolucao_reduzida');
  });

  it('sem medição, não inventa aviso', () => {
    const blank: RealQuality = {
      captureWidth: null,
      captureHeight: null,
      captureFps: null,
      captureFpsPeak: null,
      encodedWidth: null,
      encodedHeight: null,
      encodedFps: null,
      limitation: 'none',
      bitrateKbps: null,
      targetKbps: null,
      availableKbps: null,
      encodeMs: null,
      ramping: false,
    };
    expect(diagnose(requested, blank)).toEqual([]);
  });
});
