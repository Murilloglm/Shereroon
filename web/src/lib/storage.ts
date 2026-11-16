/** Preferências guardadas só neste navegador. Tudo tolera armazenamento bloqueado ou corrompido. */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // modo anônimo ou cota cheia: segue sem persistir
  }
}

export interface SavedRoom {
  name: string;
  /** Só existe no navegador de quem criou a sala. */
  hostKey?: string;
  /** Guardada para reconectar sem perguntar de novo (e para o dono poder copiar). */
  password?: string;
  session?: { identity: string; proof: string };
  lastSeen: number;
}

const ROOMS_KEY = 'shareroom:salas';
const MAX_ROOMS = 30;

function allRooms(): Record<string, SavedRoom> {
  const value = read<Record<string, SavedRoom>>(ROOMS_KEY, {});
  return value && typeof value === 'object' ? value : {};
}

export const storage = {
  getName: (): string => read<string>('shareroom:nome', ''),
  setName: (name: string): void => write('shareroom:nome', name),

  getRoom: (invite: string): SavedRoom | undefined => allRooms()[invite],

  saveRoom(invite: string, patch: Partial<SavedRoom>): void {
    const rooms = allRooms();
    rooms[invite] = { name: '', ...rooms[invite], ...patch, lastSeen: Date.now() };
    // Mantém só as salas mais recentes.
    const kept = Object.entries(rooms)
      .sort(([, a], [, b]) => b.lastSeen - a.lastSeen)
      .slice(0, MAX_ROOMS);
    write(ROOMS_KEY, Object.fromEntries(kept));
  },

  forgetSession(invite: string): void {
    const rooms = allRooms();
    if (rooms[invite]) {
      delete rooms[invite].session;
      write(ROOMS_KEY, rooms);
    }
  },

  recentRooms(): { invite: string; room: SavedRoom }[] {
    return Object.entries(allRooms())
      .map(([invite, room]) => ({ invite, room }))
      .sort((a, b) => b.room.lastSeen - a.room.lastSeen);
  },

  removeRoom(invite: string): void {
    const rooms = allRooms();
    delete rooms[invite];
    write(ROOMS_KEY, rooms);
  },

  get: read,
  set: write,
};
