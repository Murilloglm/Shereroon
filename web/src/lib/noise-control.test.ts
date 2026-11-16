import { describe, expect, it } from 'vitest';
import { cleanSettings, defaultSetting, MIC_KEY, noiseAdvice } from './noise-control.ts';

describe('supressão de ruído: o que é recomendado para cada fonte', () => {
  it('microfone é o uso indicado', () => {
    expect(noiseAdvice(MIC_KEY).kind).toBe('voz');
    expect(defaultSetting(MIC_KEY)).toEqual({ on: false, level: 'equilibrado' });
  });

  it('jogos, música e vídeo exigem confirmação', () => {
    for (const exe of ['valorant-win64-shipping.exe', 'cs2.exe', 'spotify.exe', 'vlc.exe']) {
      expect(noiseAdvice(exe).kind, exe).toBe('risco');
    }
    expect(noiseAdvice('valorant-win64-shipping.exe').text).toMatch(/passos, tiros/);
  });

  it('programas de chamada recebem o aviso de filtro duplicado e começam no modo Leve', () => {
    expect(noiseAdvice('discord.exe').kind).toBe('chamada');
    expect(noiseAdvice('discord.exe').text).toMatch(/Krisp/);
    expect(defaultSetting('discord.exe')).toEqual({ on: false, level: 'leve' });
  });

  it('nada vem ligado por padrão, em fonte nenhuma', () => {
    for (const key of [MIC_KEY, 'discord.exe', 'valorant.exe', 'spotify.exe', 'obs64.exe', 'qualquer.exe']) {
      expect(defaultSetting(key).on, key).toBe(false);
    }
  });
});

describe('supressão de ruído: escolhas guardadas', () => {
  it('microfone e chamada voltam como foram deixados', () => {
    expect(cleanSettings({ mic: { on: true, level: 'forte' }, 'Discord.exe': { on: true, level: 'leve' } })).toEqual({
      mic: { on: true, level: 'forte' },
      'discord.exe': { on: true, level: 'leve' },
    });
  });

  it('jogo, música e vídeo nunca voltam ligados sozinhos (a intensidade continua lembrada)', () => {
    expect(cleanSettings({ 'valorant.exe': { on: true, level: 'leve' }, 'spotify.exe': { on: true, level: 'forte' } })).toEqual({
      'valorant.exe': { on: false, level: 'leve' },
      'spotify.exe': { on: false, level: 'forte' },
    });
  });

  it('dados corrompidos são descartados', () => {
    expect(cleanSettings(null)).toEqual({});
    expect(cleanSettings('x')).toEqual({});
    expect(cleanSettings({ mic: { on: true, level: 'máximo' }, a: null, b: 3, c: { on: 'sim', level: 'leve' } })).toEqual({ c: { on: false, level: 'leve' } });
  });
});
