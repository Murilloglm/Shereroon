import { describe, expect, it } from 'vitest';
import type { HelperApp, HelperSource } from './client.ts';
import { categoryOf, displayName, isVoiceApp, planCommands, SYSTEM_KEY, type Desired } from './mixer.ts';

const app = (id: string, exe: string, extra: Partial<HelperApp> = {}): HelperApp => ({
  id,
  pid: Number(id.slice(1)),
  exe,
  name: exe,
  hasSession: true,
  playing: true,
  browserHost: false,
  ...extra,
});

const source = (id: string, extra: Partial<HelperSource> = {}): HelperSource => ({
  id,
  slot: 1,
  exe: '',
  enabled: true,
  volume: 1,
  solo: false,
  state: 'capturing',
  coveredBy: null,
  error: null,
  ...extra,
});

const valorant = app('p100', 'VALORANT-Win64-Shipping.exe');
const discord = app('p200', 'Discord.exe');
const apps = [valorant, discord, app('p300', 'Spotify.exe')];

describe('planejamento dos comandos do mixer', () => {
  it('o exemplo obrigatório: só VALORANT, depois + Discord, depois só Discord', () => {
    let desired: Desired = { 'valorant-win64-shipping.exe': { enabled: true, volume: 1 } };
    expect(planCommands(desired, apps, [])).toEqual([{ id: 'p100', enabled: true, volume: 1 }]);

    // VALORANT já capturando; o usuário liga o Discord no meio da partida.
    desired = { ...desired, 'discord.exe': { enabled: true, volume: 0.7 } };
    expect(planCommands(desired, apps, [source('p100')])).toEqual([{ id: 'p200', enabled: true, volume: 0.7 }]);

    // Desliga o VALORANT: só ele recebe comando; o Discord segue intacto.
    desired = { ...desired, 'valorant-win64-shipping.exe': { enabled: false, volume: 1 } };
    expect(planCommands(desired, apps, [source('p100'), source('p200', { volume: 0.7 })])).toEqual([{ id: 'p100', enabled: false }]);
  });

  it('nada marcado, nada capturado', () => {
    expect(planCommands({}, apps, [])).toEqual([]);
    expect(planCommands({ 'spotify.exe': { enabled: false, volume: 0.6 } }, apps, [])).toEqual([]);
  });

  it('tudo como desejado: nenhum comando (não fica reenviando)', () => {
    const desired: Desired = { 'discord.exe': { enabled: true, volume: 0.7 } };
    expect(planCommands(desired, apps, [source('p200', { volume: 0.7 })])).toEqual([]);
  });

  it('mudança de volume manda só o volume, sem religar', () => {
    const desired: Desired = { 'discord.exe': { enabled: true, volume: 0.35 } };
    expect(planCommands(desired, apps, [source('p200', { volume: 0.7 })])).toEqual([{ id: 'p200', volume: 0.35 }]);
  });

  it('nunca pede o navegador que está com a sala aberta (eco)', () => {
    const browser = app('p900', 'chrome.exe', { browserHost: true });
    const desired: Desired = { 'chrome.exe': { enabled: true, volume: 1 } };
    expect(planCommands(desired, [browser], [])).toEqual([]);
    // E se por algum motivo estiver ligado, desliga.
    expect(planCommands(desired, [browser], [source('p900')])).toEqual([{ id: 'p900', enabled: false }]);
  });

  it('app que fechou e abriu de novo (outro processo) é religado pelo nome', () => {
    const desired: Desired = { 'discord.exe': { enabled: true, volume: 0.7 } };
    const reopened = app('p777', 'Discord.exe');
    const commands = planCommands(desired, [valorant, reopened], [source('p200', { state: 'ended', enabled: false })]);
    expect(commands).toEqual([{ id: 'p777', enabled: true, volume: 0.7 }]);
  });

  it('não insiste em fonte que o Windows recusou', () => {
    const desired: Desired = { 'discord.exe': { enabled: true, volume: 1 } };
    expect(planCommands(desired, apps, [source('p200', { state: 'error', enabled: true, error: 'recusado' })])).toEqual([]);
  });

  it('duas janelas do mesmo programa seguem a mesma escolha', () => {
    const second = app('p201', 'Discord.exe');
    const commands = planCommands({ 'discord.exe': { enabled: true, volume: 1 } }, [discord, second], []);
    expect(commands.map((command) => command.id)).toEqual(['p200', 'p201']);
  });

  it('fonte com filtro de ruído vai em faixa separada; sem filtro, volta para a mixagem', () => {
    const desired: Desired = { 'discord.exe': { enabled: true, volume: 0.7 } };
    const filtered = new Set(['discord.exe']);
    // Ligando já com o filtro: nasce separada.
    expect(planCommands(desired, apps, [], filtered)).toEqual([{ id: 'p200', enabled: true, volume: 0.7, solo: true }]);
    // Filtro ligado com a fonte já no ar: só a marca muda, sem religar nem mexer no volume.
    expect(planCommands(desired, apps, [source('p200', { volume: 0.7 })], filtered)).toEqual([{ id: 'p200', solo: true }]);
    // Filtro desligado: volta para a mixagem comum.
    expect(planCommands(desired, apps, [source('p200', { volume: 0.7, solo: true })])).toEqual([{ id: 'p200', solo: false }]);
    // As outras fontes não recebem comando nenhum.
    expect(planCommands({ ...desired, 'spotify.exe': { enabled: true, volume: 1 } }, apps, [source('p200', { volume: 0.7, solo: true }), source('p300')], filtered)).toEqual([]);
  });

  it('a fonte "Sistema" é tratada à parte', () => {
    const desired: Desired = { [SYSTEM_KEY]: { enabled: true, volume: 0.8 } };
    expect(planCommands(desired, apps, [])).toEqual([{ id: 'system', enabled: true, volume: 0.8 }]);
    expect(planCommands({}, apps, [source('system')])).toEqual([{ id: 'system', enabled: false }]);
  });
});

describe('rótulos', () => {
  it('reconhece os tipos mais comuns', () => {
    expect(categoryOf('VALORANT-Win64-Shipping.exe')).toBe('Jogo');
    expect(categoryOf('Discord.exe')).toBe('Voz e chamada');
    expect(categoryOf('Spotify.exe')).toBe('Música');
    expect(categoryOf('opera.exe')).toBe('Navegador');
    expect(categoryOf('qualquercoisa.exe')).toBe('Aplicativo');
    expect(isVoiceApp('Discord.exe')).toBe(true);
    expect(isVoiceApp('Spotify.exe')).toBe(false);
  });

  it('tira o sufixo técnico do nome de jogos da Unreal Engine', () => {
    expect(displayName('VALORANT-Win64-Shipping')).toBe('VALORANT');
    expect(displayName('Discord')).toBe('Discord');
    expect(displayName('Win64-Shipping')).toBe('Win64-Shipping');
  });
});
