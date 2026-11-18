// Atividades: o que os amigos estão jogando, os jogos vinculados da conta e a detecção do jogo aberto.
//
// A detecção só existe no aplicativo de Windows e só roda se a pessoa ligar (vem desligada): a cada 30 s lê os
// nomes dos programas abertos, reconhece o jogo (lib/games.ts) e informa ao servidor, que renova enquanto o jogo
// está aberto. Nada é enviado além do nome do jogo e do executável; quem vê segue a privacidade escolhida.
import { desktop } from './desktop.ts';
import { detectGame, type LinkedGame } from './games.ts';
import { groups } from './groups/client.ts';
import type { UserCard } from './social/client.ts';
import { storage } from './storage.ts';
import { Store } from './store.ts';

export interface CurrentActivity {
  name: string;
  startedAt: string;
  icon: string | null;
}

export interface FriendActivity {
  user: UserCard;
  online: boolean;
  inVoice: boolean;
  activity: CurrentActivity | null;
  recent: { name: string; endedAt: string | null }[];
}

export interface ActivityState {
  friends: FriendActivity[] | null;
  games: LinkedGame[] | null;
  /** Detecção de jogos ligada neste aparelho. */
  detection: boolean;
  /** Jogo detectado agora (só neste aparelho). */
  detected: string | null;
}

const DETECTION_KEY = 'cosmic:deteccao-jogos';
const SCAN_MS = 30_000;

export const detectionAvailable = (): boolean => Boolean(desktop?.activity);

class ActivityClient {
  readonly store = new Store<ActivityState>({ friends: null, games: null, detection: storage.get<boolean>(DETECTION_KEY, false) === true, detected: null });
  #timer: ReturnType<typeof setInterval> | null = null;
  #reported: string | null = null;
  #reload: ReturnType<typeof setTimeout> | null = null;
  #account: string | null = null;

  constructor() {
    groups.onEvent((event) => {
      // profile.changed: a privacidade das atividades pode ter mudado (quem vê passa a ver ou deixa de ver).
      if (event.t === 'activity.changed' || event.t === 'friend.changed' || event.t === 'profile.changed' || event.t === 'ready') this.#scheduleReload();
    });
    groups.store.subscribe(() => this.#sync());
    this.#sync();
  }

  async loadFriends(): Promise<void> {
    const { friends } = await groups.call<{ friends: FriendActivity[] }>('GET', '/api/activities');
    this.store.set({ friends });
  }

  async loadGames(): Promise<LinkedGame[]> {
    const { games } = await groups.call<{ games: LinkedGame[] }>('GET', '/api/me/games');
    this.store.set({ games });
    return games;
  }

  async addGame(input: { name: string; exe?: string | null; icon?: string | null }): Promise<void> {
    await groups.call('POST', '/api/me/games', input);
    await this.loadGames();
  }

  async updateGame(id: string, patch: { name?: string; showOnProfile?: boolean; hidden?: boolean }): Promise<void> {
    await groups.call('PATCH', `/api/me/games/${id}`, patch);
    await this.loadGames();
    if (patch.hidden !== undefined) void this.#scan();
  }

  async removeGame(id: string): Promise<void> {
    await groups.call('DELETE', `/api/me/games/${id}`);
    await this.loadGames();
  }

  forProfile(userId: string): Promise<{ activity: CurrentActivity | null; games: { name: string; icon: string | null }[] }> {
    return groups.call('GET', `/api/users/${userId}/activity`);
  }

  setDetection(on: boolean): void {
    storage.set(DETECTION_KEY, on);
    this.store.set({ detection: on, detected: on ? this.store.get().detected : null });
    if (!on) void this.#report(null);
    this.#sync();
  }

  #scheduleReload(): void {
    if (!this.store.get().friends || this.#reload) return;
    this.#reload = setTimeout(() => {
      this.#reload = null;
      void this.loadFriends().catch(() => undefined);
    }, 300);
  }

  /** Liga ou desliga o laço de detecção conforme a conta, o aparelho e a escolha da pessoa. */
  #sync(): void {
    const account = groups.store.get().account?.id ?? null;
    if (account !== this.#account) {
      this.#account = account;
      this.#reported = null;
      this.store.set({ friends: null, games: null, detected: null });
    }
    const wanted = Boolean(account && desktop?.activity && this.store.get().detection);
    if (wanted && !this.#timer) {
      this.#timer = setInterval(() => void this.#scan(), SCAN_MS);
      void this.#scan();
    } else if (!wanted && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async #scan(): Promise<void> {
    if (!this.#timer || !desktop?.activity) return;
    try {
      const running = await desktop.activity.running();
      const games = this.store.get().games ?? (await this.loadGames());
      const found = detectGame(running, games);
      this.store.set({ detected: found?.name ?? null });
      await this.#report(found);
    } catch {
      // sem conexão: tenta de novo na próxima leitura
    }
  }

  async #report(found: { name: string; exe: string } | null): Promise<void> {
    if (found) {
      // Renova a cada leitura enquanto o jogo está aberto (o servidor some com a atividade se parar de renovar).
      await groups.call('PUT', '/api/me/activity', found);
      this.#reported = found.name;
    } else if (this.#reported) {
      this.#reported = null;
      await groups.call('DELETE', '/api/me/activity').catch(() => undefined);
    }
  }
}

export const activities = new ActivityClient();

/** "há 25 min", "há 2 h 10 min" desde o começo da atividade. */
export function playingFor(startedAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000));
  if (minutes < 1) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `há ${hours} h` : `há ${hours} h ${minutes % 60} min`;
}
