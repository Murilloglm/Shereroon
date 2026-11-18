// Detecção do jogo aberto: a partir dos programas rodando no Windows, com os jogos que a pessoa vinculou tendo
// prioridade sobre a lista conhecida, e jogos ocultos nunca aparecendo.
import { describe, expect, it } from 'vitest';
import { detectGame, KNOWN_GAMES } from './games.ts';

const game = (name: string, exe: string | null, extra: { hidden?: boolean } = {}) => ({ id: name, name, exe, icon: null, showOnProfile: true, hidden: extra.hidden ?? false });

describe('detecção do jogo aberto', () => {
  it('reconhece jogos conhecidos pelo executável, sem diferença de maiúsculas', () => {
    expect(detectGame(['explorer.exe', 'VALORANT-Win64-Shipping.exe'], [])).toEqual({ name: 'VALORANT', exe: 'valorant-win64-shipping.exe' });
    expect(detectGame(['robloxplayerbeta.exe'], [])).toEqual({ name: 'Roblox', exe: 'robloxplayerbeta.exe' });
    expect(detectGame(['chrome.exe', 'explorer.exe', 'Discord.exe'], [])).toBeNull();
  });

  it('o jogo vinculado pela pessoa tem prioridade e usa o nome que ela deu', () => {
    const linked = [game('Meu servidor de Minecraft', 'javaw.exe')];
    expect(detectGame(['javaw.exe', 'cs2.exe'], linked)).toEqual({ name: 'Meu servidor de Minecraft', exe: 'javaw.exe' });
  });

  it('jogo oculto não é informado, nem pela lista conhecida', () => {
    expect(detectGame(['cs2.exe'], [game('Counter-Strike 2', 'cs2.exe', { hidden: true })])).toBeNull();
    expect(detectGame(['cs2.exe', 'robloxplayerbeta.exe'], [game('Counter-Strike 2', 'cs2.exe', { hidden: true })])).toEqual({ name: 'Roblox', exe: 'robloxplayerbeta.exe' });
  });

  it('a lista conhecida só tem nomes de jogos (nada de marcas ou imagens) e executáveis válidos', () => {
    for (const [exe, name] of Object.entries(KNOWN_GAMES)) {
      expect(exe).toMatch(/^[a-z0-9 ._()+&'-]+\.exe$/);
      expect(name.length).toBeGreaterThan(1);
    }
    // Programas genéricos não entram (javaw.exe roda muita coisa além de Minecraft).
    expect(KNOWN_GAMES['javaw.exe']).toBeUndefined();
  });
});
