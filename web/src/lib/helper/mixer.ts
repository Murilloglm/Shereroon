/**
 * Mixer por aplicativo: o que o usuário QUER transmitir (por nome de programa) e a tradução disso em
 * comandos para o app auxiliar. Guardar por nome de programa — e não por processo — é o que permite
 * perfis salvos e religar sozinho um app que fechou e abriu de novo.
 */
import type { RoomSession } from '../session.ts';
import { storage } from '../storage.ts';
import { Store } from '../store.ts';
import { HelperClient, type HelperApp, type HelperSource } from './client.ts';

export const SYSTEM_KEY = 'system';

export interface MixerEntry {
  enabled: boolean;
  /** Volume de transmissão, de 0 a 1. Não altera o que você escuta no PC. */
  volume: number;
}

/** Chave: nome do executável em minúsculas (ex.: "discord.exe"), ou SYSTEM_KEY. */
export type Desired = Record<string, MixerEntry>;

export interface AudioProfile {
  name: string;
  entries: Desired;
}

export interface SourceCommand {
  id: string;
  enabled?: boolean;
  volume?: number;
  /** Entregar a fonte separada (sem misturar), para receber filtros antes da mixagem. */
  solo?: boolean;
}

export const keyOf = (exe: string) => exe.toLowerCase();

/**
 * Compara o desejado com o estado real e devolve os comandos que faltam. Função pura.
 * Nunca pede o navegador desta sala (eco) e não insiste em fonte que deu erro.
 */
export function planCommands(
  desired: Desired,
  apps: readonly HelperApp[],
  sources: readonly HelperSource[],
  /** Chaves (programas) que devem ir em faixa separada porque têm filtro de ruído ligado. */
  soloKeys: ReadonlySet<string> = new Set(),
): SourceCommand[] {
  const commands: SourceCommand[] = [];
  const plan = (id: string, key: string, allowed: boolean) => {
    const entry = desired[key];
    const source = sources.find((item) => item.id === id);
    const want = entry?.enabled === true && allowed;
    const solo = soloKeys.has(key);
    if (want && entry) {
      if (!source) commands.push({ id, enabled: true, volume: entry.volume, ...(solo ? { solo } : {}) });
      else if (source.state === 'error' || source.state === 'ended') return;
      else if (!source.enabled) commands.push({ id, enabled: true, volume: entry.volume, solo });
      else {
        const command: SourceCommand = { id };
        if (Math.abs(source.volume - entry.volume) > 0.004) command.volume = entry.volume;
        if (source.solo !== solo) command.solo = solo;
        if (command.volume !== undefined || command.solo !== undefined) commands.push(command);
      }
    } else if (source?.enabled) {
      commands.push({ id, enabled: false });
    }
  };
  for (const app of apps) plan(app.id, keyOf(app.exe), !app.browserHost);
  plan(SYSTEM_KEY, SYSTEM_KEY, true);
  return commands;
}

const CATEGORIES: [RegExp, string][] = [
  [/valorant|cs2|csgo|fortnite|league|riot|overwatch|apex|minecraft|javaw|gta|rocketleague|r5apex|dota|eldenring|cyberpunk|pubg|tslgame|robloxplayer/i, 'Jogo'],
  [/discord|teamspeak|ts3client|mumble|skype|zoom|teams|slack|whatsapp|telegram/i, 'Voz e chamada'],
  [/spotify|music|itunes|deezer|tidal|foobar|winamp|musicbee|aimp/i, 'Música'],
  [/chrome|msedge|firefox|opera|brave|vivaldi|browser/i, 'Navegador'],
  [/vlc|mpv|mpc-|wmplayer|video\.ui|netflix|plex|stremio|kodi/i, 'Vídeo'],
  [/steam|epicgameslauncher|battle\.net|origin|eadesktop|ubisoft|galaxyclient/i, 'Loja de jogos'],
  [/obs|streamlabs/i, 'Transmissão'],
];

/** Rótulo de tipo, só para ajudar a reconhecer a linha. Não muda nenhum comportamento. */
export function categoryOf(exe: string): string {
  return CATEGORIES.find(([pattern]) => pattern.test(exe))?.[1] ?? 'Aplicativo';
}

/**
 * Nome para mostrar na lista. Jogos feitos na Unreal Engine não trazem descrição no executável e aparecem
 * como "VALORANT-Win64-Shipping"; aqui o sufixo técnico sai.
 */
export function displayName(name: string): string {
  return name.replace(/[-_ ]?Win(64|32|GDK)[-_ ]?Shipping$/i, '').trim() || name;
}

/** Apps de voz: se os amigos da sala estão na mesma chamada, vão se ouvir de volta com atraso. */
export function isVoiceApp(exe: string): boolean {
  return categoryOf(exe) === 'Voz e chamada';
}

export interface MixerState {
  desired: Desired;
  profiles: AudioProfile[];
  activeProfile: string | null;
  /** Apps sem áudio detectado que o usuário adicionou à lista à mão. */
  pinned: string[];
}

const PROFILES_KEY = 'shareroom:perfis-audio';
const VOLUMES_KEY = 'shareroom:mixer-volumes';

function cleanEntries(value: unknown): Desired {
  const out: Desired = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, entry] of Object.entries(value as Record<string, Partial<MixerEntry>>)) {
    if (typeof key !== 'string' || key.length > 120 || !entry || typeof entry !== 'object') continue;
    const volume = typeof entry.volume === 'number' && Number.isFinite(entry.volume) ? Math.min(1, Math.max(0, entry.volume)) : 1;
    out[key.toLowerCase()] = { enabled: entry.enabled === true, volume };
  }
  return out;
}

function loadProfiles(): AudioProfile[] {
  const raw = storage.get<unknown>(PROFILES_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is { name: string; entries: unknown } => Boolean(item) && typeof (item as { name?: unknown }).name === 'string')
    .map((item) => ({ name: item.name.slice(0, 40), entries: cleanEntries(item.entries) }))
    .slice(0, 20);
}

export class AppMixer {
  readonly helper = new HelperClient();
  readonly store: Store<MixerState>;
  readonly #session: RoomSession;
  readonly #sentAt = new Map<string, number>();
  #streaming = false;
  #soloKeys: ReadonlySet<string> = new Set();

  constructor(session: RoomSession) {
    this.#session = session;
    // Os volumes ficam lembrados entre visitas; quais apps ficam LIGADOS, não: capturar exige uma ação sua
    // (marcar o app ou aplicar um perfil) a cada vez que o mixer é aberto.
    const remembered = cleanEntries(storage.get<unknown>(VOLUMES_KEY, {}));
    for (const entry of Object.values(remembered)) entry.enabled = false;
    this.store = new Store<MixerState>({ desired: remembered, profiles: loadProfiles(), activeProfile: null, pinned: [] });

    this.helper.store.subscribe(() => this.#sync());
    this.helper.onError = ({ id, message }) => {
      // O auxiliar recusou uma fonte (por exemplo, o navegador da sala): desmarca para não insistir.
      const app = this.helper.store.get().apps.find((item) => item.id === id);
      if (app) this.#patch(keyOf(app.exe), { enabled: false });
      session.notify(message);
    };
    session.store.subscribe(() => this.#onSession());
  }

  /** Conecta ao auxiliar. Chame a partir de um clique (abre o áudio do navegador). */
  open(): void {
    void this.helper.connect();
  }

  /** Liga o som do computador inteiro (menos este programa), conectando ao auxiliar se for preciso. */
  async enableSystem(): Promise<void> {
    await this.helper.connect();
    this.setEnabled(SYSTEM_KEY, true);
  }

  /** Desliga tudo e solta o auxiliar. */
  shutdown(): void {
    this.helper.disconnect();
  }

  get active(): boolean {
    return this.#session.store.get().audioSource === 'apps' && this.helper.store.get().phase === 'conectado';
  }

  entry(key: string): MixerEntry {
    return this.store.get().desired[key] ?? { enabled: false, volume: 1 };
  }

  setEnabled(key: string, enabled: boolean): void {
    this.#patch(key, { enabled });
    this.store.set({ activeProfile: null });
    if (enabled) this.#useAsAudioSource();
    this.#sentAt.clear();
    this.#sync();
  }

  setVolume(key: string, volume: number): void {
    this.#patch(key, { volume: Math.min(1, Math.max(0, volume)) });
    this.store.set({ activeProfile: null });
    this.#sync();
  }

  pin(exe: string): void {
    const key = keyOf(exe);
    this.store.set((state) => (state.pinned.includes(key) ? {} : { pinned: [...state.pinned, key] }));
  }

  saveProfile(name: string): void {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    const entries = structuredClone(this.store.get().desired);
    const profiles = [...this.store.get().profiles.filter((profile) => profile.name !== clean), { name: clean, entries }];
    storage.set(PROFILES_KEY, profiles);
    this.store.set({ profiles, activeProfile: clean });
  }

  /** Aplica um perfil salvo: liga o que ele liga e desliga o resto. É a sua autorização para esses apps. */
  applyProfile(name: string): void {
    const profile = this.store.get().profiles.find((item) => item.name === name);
    if (!profile) return;
    const desired: Desired = {};
    for (const [key, entry] of Object.entries(this.store.get().desired)) desired[key] = { ...entry, enabled: false };
    for (const [key, entry] of Object.entries(profile.entries)) desired[key] = { ...entry };
    this.store.set({ desired, activeProfile: name, pinned: Object.keys(profile.entries).filter((key) => key !== SYSTEM_KEY) });
    this.#rememberVolumes(desired);
    if (Object.values(desired).some((entry) => entry.enabled)) this.#useAsAudioSource();
    this.#sentAt.clear();
    this.#sync();
  }

  deleteProfile(name: string): void {
    const profiles = this.store.get().profiles.filter((profile) => profile.name !== name);
    storage.set(PROFILES_KEY, profiles);
    this.store.set((state) => ({ profiles, activeProfile: state.activeProfile === name ? null : state.activeProfile }));
  }

  /** Define quais programas vão em faixa separada (os que têm filtro de ruído ligado). */
  setSoloKeys(keys: ReadonlySet<string>): void {
    this.#soloKeys = keys;
    this.#sync();
  }

  /** Desliga todas as fontes de uma vez. */
  disableAll(): void {
    const desired: Desired = {};
    for (const [key, entry] of Object.entries(this.store.get().desired)) desired[key] = { ...entry, enabled: false };
    this.store.set({ desired, activeProfile: null });
    this.#sync();
  }

  #patch(key: string, patch: Partial<MixerEntry>): void {
    const desired = { ...this.store.get().desired, [key]: { ...this.entry(key), ...patch } };
    this.store.set({ desired });
    this.#rememberVolumes(desired);
  }

  #rememberVolumes(desired: Desired): void {
    storage.set(VOLUMES_KEY, Object.fromEntries(Object.entries(desired).map(([key, entry]) => [key, { volume: entry.volume }])));
  }

  /** O mixer passa a ser o áudio que acompanha a tela (no lugar do áudio do navegador, para não duplicar). */
  #useAsAudioSource(): void {
    const track = this.helper.track;
    if (!track) return;
    void this.#session.setAppAudioTrack(track);
    if (this.#session.store.get().audioSource !== 'apps') void this.#session.setAudioSource('apps');
  }

  #onSession(): void {
    // Se o usuário escolheu outro áudio (ou nenhum) na barra, o mixer para de capturar: nada fica ligado à toa.
    if (this.#session.store.get().audioSource !== 'apps' && Object.values(this.store.get().desired).some((entry) => entry.enabled)) {
      this.disableAll();
    }
    this.#updateStreaming();
  }

  #updateStreaming(): void {
    const streaming = this.active;
    if (streaming !== this.#streaming) {
      this.#streaming = streaming;
      this.helper.setStreaming(streaming);
    }
  }

  #sync(): void {
    const helper = this.helper.store.get();
    if (helper.phase !== 'conectado') {
      this.#streaming = false;
      this.#sentAt.clear();
      return;
    }
    this.#updateStreaming();
    const now = Date.now();
    for (const command of planCommands(this.store.get().desired, helper.apps, helper.sources, this.#soloKeys)) {
      // Ligar/desligar leva um instante para o auxiliar confirmar: não repete o mesmo pedido nesse meio-tempo.
      if (command.enabled !== undefined) {
        const key = `${command.id}:${command.enabled}`;
        if (now - (this.#sentAt.get(key) ?? 0) < 1500) continue;
        this.#sentAt.set(key, now);
      }
      this.helper.setSource(command.id, command);
    }
  }
}
