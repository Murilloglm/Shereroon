/**
 * Atividades: o que cada conta está jogando e jogou há pouco, e os jogos que ela vinculou.
 *
 * Quem informa é o próprio aplicativo de Windows da pessoa (que detecta o jogo aberto, só se ela deixar) ou ela
 * mesma, à mão. Nada é buscado em plataformas de terceiros e nenhuma senha é pedida. Quem vê segue a privacidade
 * escolhida: só amigos (padrão), também quem divide um grupo, ou ninguém.
 */
import { iso, isoOrNull, type Db, type Row } from '../db/db.ts';
import { ApiError } from '../errors.ts';
import { cleanText, newId, type User } from './auth.ts';
import type { Hub } from './hub.ts';

export type ActivityPrivacy = 'amigos' | 'membros' | 'ninguem';
export const ACTIVITY_PRIVACY: readonly ActivityPrivacy[] = ['amigos', 'membros', 'ninguem'];

const LIMITS = { games: 60, name: 60, iconBytes: 12_000, recent: 3 };
/** A atividade atual vale enquanto o aplicativo renova (ele renova a cada ~30 s com o jogo aberto). */
const STALE_MS = 3 * 60_000;
/** Atividades recentes: as terminadas nas últimas 24 horas. */
const RECENT_MS = 24 * 60 * 60_000;
const EXE = /^[A-Za-z0-9 ._()+&'-]{1,80}\.exe$/i;
const ICON = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

const INVALID = (message = 'Informe o nome do jogo (até 60 caracteres).') => new ApiError(400, 'jogo_invalido', message);
const NOT_FOUND = () => new ApiError(404, 'jogo_inexistente', 'Esse jogo não está na sua lista.');

const key = (name: string) => name.normalize('NFKC').toLowerCase();

function gameName(value: unknown): string {
  const name = cleanText(value, 200);
  if (!name || name.length > LIMITS.name) throw INVALID();
  return name;
}

function exeName(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !EXE.test(value)) throw INVALID('Executável inválido: use só o nome do arquivo .exe, sem pastas.');
  return value.toLowerCase();
}

function toGame(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name),
    exe: row.exe === null ? null : String(row.exe),
    icon: row.icon === null ? null : String(row.icon),
    showOnProfile: row.show_on_profile === true,
    hidden: row.hidden === true,
  };
}

export class Activities {
  readonly #db: Db;
  readonly #hub: Hub;

  constructor(db: Db, hub: Hub) {
    this.#db = db;
    this.#hub = hub;
  }

  // --- Jogos vinculados ---------------------------------------------------------------------

  async games(user: User) {
    return (await this.#db.query('SELECT * FROM user_games WHERE user_id = $1 ORDER BY name_key', [user.id])).map(toGame);
  }

  async addGame(user: User, input: Record<string, unknown>) {
    const name = gameName(input.name);
    const exe = exeName(input.exe);
    let icon: string | null = null;
    if (input.icon !== undefined && input.icon !== null) {
      if (typeof input.icon !== 'string' || !ICON.test(input.icon) || input.icon.length > LIMITS.iconBytes) throw INVALID('Ícone inválido (PNG pequeno).');
      icon = input.icon;
    }
    const [count] = await this.#db.query('SELECT count(*) AS total FROM user_games WHERE user_id = $1', [user.id]);
    if (Number(count?.total ?? 0) >= LIMITS.games) throw new ApiError(409, 'jogos_demais', `Cada conta vincula no máximo ${LIMITS.games} jogos.`);
    const [taken] = await this.#db.query('SELECT 1 FROM user_games WHERE user_id = $1 AND name_key = $2', [user.id, key(name)]);
    if (taken) throw new ApiError(409, 'jogo_repetido', 'Esse jogo já está na sua lista.');
    const [row] = await this.#db.query(
      'INSERT INTO user_games (id, user_id, name, name_key, exe, icon) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [newId(12), user.id, name, key(name), exe, icon],
    );
    return toGame(row!);
  }

  async updateGame(user: User, gameId: string, input: Record<string, unknown>) {
    if (!ID.test(gameId)) throw NOT_FOUND();
    const [current] = await this.#db.query('SELECT * FROM user_games WHERE id = $1 AND user_id = $2', [gameId, user.id]);
    if (!current) throw NOT_FOUND();
    const name = input.name === undefined ? String(current.name) : gameName(input.name);
    const showOnProfile = typeof input.showOnProfile === 'boolean' ? input.showOnProfile : current.show_on_profile === true;
    const hidden = typeof input.hidden === 'boolean' ? input.hidden : current.hidden === true;
    if (key(name) !== String(current.name_key)) {
      const [taken] = await this.#db.query('SELECT 1 FROM user_games WHERE user_id = $1 AND name_key = $2', [user.id, key(name)]);
      if (taken) throw new ApiError(409, 'jogo_repetido', 'Esse jogo já está na sua lista.');
    }
    const [row] = await this.#db.query('UPDATE user_games SET name = $3, name_key = $4, show_on_profile = $5, hidden = $6 WHERE id = $1 AND user_id = $2 RETURNING *', [
      gameId,
      user.id,
      name,
      key(name),
      showOnProfile,
      hidden,
    ]);
    // Ocultou o jogo que está aberto: a atividade some na hora.
    if (hidden) await this.#endWhere(user.id, 'game_id = $2', [gameId]);
    void this.#notify(user.id);
    return toGame(row!);
  }

  async removeGame(user: User, gameId: string) {
    if (!ID.test(gameId)) throw NOT_FOUND();
    const rows = await this.#db.query('DELETE FROM user_games WHERE id = $1 AND user_id = $2 RETURNING id', [gameId, user.id]);
    if (rows.length === 0) throw NOT_FOUND();
  }

  // --- Atividade atual ----------------------------------------------------------------------

  /**
   * O aplicativo informa o jogo aberto (e renova enquanto ele estiver aberto). O mesmo jogo só renova; outro jogo
   * fecha o anterior. Jogo marcado como oculto não vira atividade (`shared: false`).
   */
  async setActivity(user: User, input: Record<string, unknown>) {
    const name = gameName(input.name);
    const exe = exeName(input.exe);
    const [game] = await this.#db.query('SELECT * FROM user_games WHERE user_id = $1 AND ((exe IS NOT NULL AND exe = $2) OR name_key = $3) ORDER BY (exe = $2) DESC LIMIT 1', [
      user.id,
      exe,
      key(name),
    ]);
    if (game?.hidden === true) {
      await this.#endWhere(user.id, 'true', []);
      void this.#notify(user.id);
      return { shared: false };
    }
    const shownName = game ? String(game.name) : name;
    const [open] = await this.#db.query('SELECT * FROM user_activities WHERE user_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1', [user.id]);
    const fresh = open && Date.now() - Date.parse(iso(open.seen_at)) < STALE_MS;
    if (open && fresh && key(String(open.game_name)) === key(shownName)) {
      await this.#db.query('UPDATE user_activities SET seen_at = now() WHERE id = $1', [open.id]);
      return { shared: true };
    }
    await this.#db.tx(async (tx) => {
      // Fecha a anterior: no último momento em que foi vista, se tinha ficado parada (aplicativo fechado de repente).
      await tx.query("UPDATE user_activities SET ended_at = CASE WHEN seen_at < now() - interval '3 minutes' THEN seen_at ELSE now() END WHERE user_id = $1 AND ended_at IS NULL", [user.id]);
      await tx.query('INSERT INTO user_activities (id, user_id, game_name, game_id) VALUES ($1, $2, $3, $4)', [newId(14), user.id, shownName, game ? String(game.id) : null]);
    });
    void this.#notify(user.id);
    return { shared: true };
  }

  async clearActivity(user: User) {
    await this.#endWhere(user.id, 'true', []);
    void this.#notify(user.id);
  }

  async #endWhere(userId: string, condition: string, params: unknown[]): Promise<void> {
    await this.#db.query(`UPDATE user_activities SET ended_at = now() WHERE user_id = $1 AND ended_at IS NULL AND ${condition}`, [userId, ...params]);
  }

  // --- Quem vê ------------------------------------------------------------------------------

  async #friends(userId: string): Promise<Set<string>> {
    const rows = await this.#db.query(
      "SELECT CASE WHEN user_low = $1 THEN user_high ELSE user_low END AS other FROM friendships WHERE (user_low = $1 OR user_high = $1) AND status = 'amigos'",
      [userId],
    );
    return new Set(rows.map((row) => String(row.other)));
  }

  async #shareGroup(a: string, b: string): Promise<boolean> {
    const [row] = await this.#db.query('SELECT 1 FROM members x JOIN members y ON y.group_id = x.group_id WHERE x.user_id = $1 AND y.user_id = $2 LIMIT 1', [a, b]);
    return row !== undefined;
  }

  /** A conta `target` deixa `viewer` ver o que ela joga? */
  async #canSee(viewer: string, target: Row, friend: boolean): Promise<boolean> {
    if (viewer === String(target.id)) return true;
    const privacy = String(target.activity_privacy) as ActivityPrivacy;
    if (privacy === 'ninguem') return false;
    if (friend) return true;
    return privacy === 'membros' && (await this.#shareGroup(viewer, String(target.id)));
  }

  async #current(userId: string) {
    const [row] = await this.#db.query(
      `SELECT a.*, g.icon FROM user_activities a LEFT JOIN user_games g ON g.id = a.game_id
        WHERE a.user_id = $1 AND a.ended_at IS NULL ORDER BY a.started_at DESC LIMIT 1`,
      [userId],
    );
    if (!row || Date.now() - Date.parse(iso(row.seen_at)) > STALE_MS || !this.#hub.isOnline(userId)) return null;
    return { name: String(row.game_name), startedAt: iso(row.started_at), icon: row.icon === null || row.icon === undefined ? null : String(row.icon) };
  }

  async #recent(userId: string) {
    const rows = await this.#db.query(
      `SELECT game_name, max(coalesce(ended_at, seen_at)) AS ended FROM user_activities
        WHERE user_id = $1 AND coalesce(ended_at, seen_at) > $2 AND (ended_at IS NOT NULL OR seen_at < $3)
        GROUP BY game_name ORDER BY ended DESC LIMIT ${LIMITS.recent}`,
      [userId, new Date(Date.now() - RECENT_MS).toISOString(), new Date(Date.now() - STALE_MS).toISOString()],
    );
    return rows.map((row) => ({ name: String(row.game_name), endedAt: isoOrNull(row.ended) }));
  }

  /** Atividade e jogos do perfil, se a privacidade deixar. */
  async forProfile(viewer: User, targetId: string) {
    if (!ID.test(targetId)) return { activity: null, games: [] };
    const [target] = await this.#db.query('SELECT id, activity_privacy FROM users WHERE id = $1', [targetId]);
    if (!target) return { activity: null, games: [] };
    const friend = (await this.#friends(viewer.id)).has(targetId);
    if (!(await this.#canSee(viewer.id, target, friend))) return { activity: null, games: [] };
    const games = (await this.#db.query('SELECT * FROM user_games WHERE user_id = $1 AND show_on_profile AND NOT hidden ORDER BY name_key LIMIT 20', [targetId])).map((row) => ({
      name: String(row.name),
      icon: row.icon === null ? null : String(row.icon),
    }));
    return { activity: await this.#current(targetId), games };
  }

  /** A lista "Atividades": os amigos, quem está online, em chamada, jogando o quê e há quanto tempo. */
  async list(viewer: User) {
    const friends = [...(await this.#friends(viewer.id))];
    if (friends.length === 0) return [];
    const marks = friends.map((_, index) => `$${index + 1}`).join(', ');
    const rows = await this.#db.query(`SELECT id, username, display_name, avatar, banner, is_bot, activity_privacy FROM users WHERE id IN (${marks})`, friends);
    const out = [];
    for (const row of rows) {
      const id = String(row.id);
      const visible = await this.#canSee(viewer.id, row, true);
      out.push({
        user: { id, username: String(row.username), displayName: String(row.display_name), avatar: row.avatar === null ? null : String(row.avatar), banner: row.banner === null ? null : String(row.banner), bot: row.is_bot === true },
        online: this.#hub.isOnline(id),
        // Só "em chamada", sem dizer onde (o grupo e o canal são de quem está nele).
        inVoice: visible && this.#hub.voiceOf(id) !== null,
        activity: visible ? await this.#current(id) : null,
        recent: visible ? await this.#recent(id) : [],
      });
    }
    // Jogando primeiro, depois online, depois por nome.
    return out.sort((a, b) => Number(Boolean(b.activity)) - Number(Boolean(a.activity)) || Number(b.online) - Number(a.online) || a.user.displayName.localeCompare(b.user.displayName));
  }

  /** Amigos (e a própria conta) recarregam a lista quando algo muda. */
  async #notify(userId: string): Promise<void> {
    const event = { t: 'activity.changed', userId };
    for (const friend of await this.#friends(userId)) this.#hub.toUser(friend, event);
    this.#hub.toUser(userId, event);
  }
}
