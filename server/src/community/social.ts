/**
 * Vida social entre contas: perfis, fotos e banners, notas e apelidos pessoais, amizades, bloqueios e
 * mensagens privadas. Nada daqui passa pelas regras de um grupo, e nenhuma rota de grupo lê estas tabelas:
 * administradores de servidores não enxergam conversas privadas.
 */
import { isCosmicAdmin } from './global-admin.ts';
import { iso, isoOrNull, num, type Db, type Row } from '../db/db.ts';
import { ApiError } from '../errors.ts';
import { imageInfo } from '../../../shared/image-info.ts';
import { cleanText, newId, type User } from './auth.ts';
import type { Community } from './core.ts';
import type { Hub } from './hub.ts';

export type FriendState = 'nenhuma' | 'enviada' | 'recebida' | 'amigos';
type Privacy = 'todos' | 'membros' | 'amigos';

export interface UserCard {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  banner: string | null;
  bot: boolean;
}

export interface DmMessage {
  id: string;
  dmId: string;
  author: { id: string | null; name: string; username: string | null };
  content: string;
  createdAt: string;
  editedAt: string | null;
  reply: { id: string; authorId: string | null; authorName: string; excerpt: string } | null;
  attachments: { id: string; name: string; mime: string; size: number; width: number | null; height: number | null }[];
  reactions: { emoji: string; users: string[] }[];
  meta: DmMeta | null;
}

/** Cartão de convite para um grupo, enviado dentro da conversa. */
export interface DmMeta {
  type: 'convite';
  code: string;
  group: { id: string; name: string; description: string; icon: string | null };
  expiresAt: string | null;
}

export const SOCIAL_LIMITS = {
  bio: 190,
  status: 60,
  note: 256,
  nickname: 32,
  message: 4000,
  friends: 500,
  avatarBytes: 2 * 1024 * 1024,
  animatedAvatarBytes: 4 * 1024 * 1024,
  bannerBytes: 6 * 1024 * 1024,
  defaultAvatars: 12,
};

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const NOT_FOUND = () => new ApiError(404, 'usuario_inexistente', 'Essa conta não existe ou não está disponível para você.');
const NOT_ALLOWED = () => new ApiError(403, 'nao_disponivel', 'Não foi possível fazer isso com essa conta.');
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const MESSAGE_ID = /^\d{1,18}$/;

function card(row: Row, prefix = ''): UserCard {
  return {
    id: String(row[`${prefix}id`]),
    username: String(row[`${prefix}username`]),
    displayName: String(row[`${prefix}display_name`]),
    avatar: row[`${prefix}avatar`] === null || row[`${prefix}avatar`] === undefined ? null : String(row[`${prefix}avatar`]),
    banner: row[`${prefix}banner`] === null || row[`${prefix}banner`] === undefined ? null : String(row[`${prefix}banner`]),
    bot: row[`${prefix}is_bot`] === true,
  };
}

export class Social {
  readonly #db: Db;
  readonly #hub: Hub;
  readonly #community: Community;

  constructor(db: Db, hub: Hub, community: Community) {
    this.#db = db;
    this.#hub = hub;
    this.#community = community;
  }

  // --- Relações ---------------------------------------------------------------------------

  async #user(id: string): Promise<Row | null> {
    if (!ID.test(id)) return null;
    const [row] = await this.#db.query('SELECT * FROM users WHERE id = $1', [id]);
    return row ?? null;
  }

  async #friendship(a: string, b: string): Promise<{ state: FriendState; since: string | null }> {
    const [low, high] = pair(a, b);
    const [row] = await this.#db.query('SELECT * FROM friendships WHERE user_low = $1 AND user_high = $2', [low, high]);
    if (!row) return { state: 'nenhuma', since: null };
    if (row.status === 'amigos') return { state: 'amigos', since: isoOrNull(row.accepted_at) };
    return { state: String(row.requested_by) === a ? 'enviada' : 'recebida', since: null };
  }

  async #blocked(by: string, target: string): Promise<boolean> {
    const [row] = await this.#db.query('SELECT 1 FROM user_blocks WHERE user_id = $1 AND blocked_id = $2', [by, target]);
    return row !== undefined;
  }

  async #shareGroup(a: string, b: string): Promise<boolean> {
    const [row] = await this.#db.query('SELECT 1 FROM members x JOIN members y ON y.group_id = x.group_id WHERE x.user_id = $1 AND y.user_id = $2 LIMIT 1', [a, b]);
    return row !== undefined;
  }

  /** Quem pode ver que a conta existe: ela mesma, quem divide um grupo, amigos e pedidos, ou perfil aberto a todos. */
  async #visible(viewer: string, target: Row, friendship: FriendState): Promise<boolean> {
    if (String(target.id) === viewer) return true;
    if (friendship !== 'nenhuma') return true;
    if (target.profile_privacy === 'todos') return true;
    return this.#shareGroup(viewer, String(target.id));
  }

  // --- Perfis -----------------------------------------------------------------------------

  async profile(viewer: User, targetId: string) {
    const target = await this.#user(targetId);
    if (!target) throw NOT_FOUND();
    const { state, since } = await this.#friendship(viewer.id, targetId);
    if (!(await this.#visible(viewer.id, target, state))) throw NOT_FOUND();
    const self = viewer.id === targetId;
    const blockedMe = !self && (await this.#blocked(targetId, viewer.id));
    const iBlocked = !self && (await this.#blocked(viewer.id, targetId));
    const shared = self || (await this.#shareGroup(viewer.id, targetId));
    const privacy = String(target.profile_privacy) as Privacy;
    // Bio, status e grupos em comum seguem a privacidade escolhida pela conta (e somem para quem ela bloqueou).
    const open = self || (!blockedMe && (privacy === 'todos' || (privacy === 'membros' && (shared || state === 'amigos')) || (privacy === 'amigos' && state === 'amigos')));
    const mutual = open && !self
      ? (await this.#db.query('SELECT g.id, g.name, g.icon FROM groups g JOIN members a ON a.group_id = g.id AND a.user_id = $1 JOIN members b ON b.group_id = g.id AND b.user_id = $2 ORDER BY g.name LIMIT 25', [viewer.id, targetId])).map((row) => ({ id: String(row.id), name: String(row.name), icon: row.icon === null ? null : String(row.icon) }))
      : null;
    const [note] = await this.#db.query('SELECT note, nickname FROM user_notes WHERE owner_id = $1 AND target_id = $2', [viewer.id, targetId]);
    return {
      ...card(target),
      cosmicAdmin: await isCosmicAdmin(this.#db, targetId),
      createdAt: iso(target.created_at),
      bio: open ? String(target.bio) : null,
      status: open ? String(target.status_text) : null,
      friendship: state,
      friendSince: since,
      blocked: iBlocked,
      mutualGroups: mutual,
      note: note ? String(note.note) : '',
      nickname: note ? String(note.nickname) : '',
      canMessage: !self && (await this.#canMessage(viewer.id, target)),
      ...(self ? { profilePrivacy: privacy, dmPrivacy: String(target.dm_privacy), activityPrivacy: String(target.activity_privacy) } : {}),
    };
  }

  async updateProfile(user: User, input: Record<string, unknown>) {
    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length + 1}`);
    };
    if (input.displayName !== undefined) {
      const name = cleanText(input.displayName, 32);
      if (!name) throw new ApiError(400, 'nome_invalido', 'Escolha um nome para aparecer para os outros.');
      set('display_name', name);
    }
    if (input.bio !== undefined) set('bio', cleanText(input.bio, SOCIAL_LIMITS.bio, true));
    if (input.status !== undefined) set('status_text', cleanText(input.status, SOCIAL_LIMITS.status));
    if (input.avatar !== undefined) {
      if (input.avatar !== null && !(typeof input.avatar === 'string' && /^padrao:(\d{1,2})$/.test(input.avatar) && Number(input.avatar.slice(7)) < SOCIAL_LIMITS.defaultAvatars)) {
        throw new ApiError(400, 'avatar_invalido', 'Escolha um dos avatares padrão ou envie uma imagem.');
      }
      set('avatar', input.avatar);
    }
    if (input.banner !== undefined) {
      if (input.banner !== null && !(typeof input.banner === 'string' && /^cor:#[0-9a-f]{6}$/i.test(input.banner))) throw new ApiError(400, 'banner_invalido', 'Escolha uma cor ou envie uma imagem.');
      set('banner', input.banner);
    }
    if (input.profilePrivacy !== undefined) {
      if (!['todos', 'membros', 'amigos'].includes(String(input.profilePrivacy))) throw new ApiError(400, 'privacidade_invalida', 'Escolha quem pode ver seu perfil.');
      set('profile_privacy', input.profilePrivacy);
    }
    if (input.activityPrivacy !== undefined) {
      if (!['amigos', 'membros', 'ninguem'].includes(String(input.activityPrivacy))) throw new ApiError(400, 'privacidade_invalida', 'Escolha quem pode ver o que você está jogando.');
      set('activity_privacy', input.activityPrivacy);
    }
    if (input.dmPrivacy !== undefined) {
      if (!['amigos', 'membros'].includes(String(input.dmPrivacy))) throw new ApiError(400, 'privacidade_invalida', 'Escolha quem pode mandar mensagem.');
      set('dm_privacy', input.dmPrivacy);
    }
    if (sets.length > 0) await this.#db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, [user.id, ...values]);
    // Avatar ou banner padrão no lugar de uma imagem enviada: a imagem antiga sai do banco.
    await this.#db.query(
      `DELETE FROM user_media m WHERE m.user_id = $1 AND NOT EXISTS (
         SELECT 1 FROM users u WHERE u.id = $1 AND (u.avatar = 'arquivo:' || m.id OR u.banner = 'arquivo:' || m.id))`,
      [user.id],
    );
    await this.#community.userChanged(user.id);
    void this.#notifyRelated(user.id, { t: 'profile.changed', userId: user.id }).catch(() => undefined);
    return this.profile(user, user.id);
  }

  /** Foto de perfil ou banner enviados. O formato e as dimensões são lidos do próprio arquivo. */
  async uploadMedia(user: User, kind: unknown, bytes: Uint8Array) {
    if (kind !== 'avatar' && kind !== 'banner') throw new ApiError(400, 'tipo_invalido', 'Envie uma foto de perfil ou um banner.');
    const info = imageInfo(bytes);
    if (!info) throw new ApiError(400, 'imagem_invalida', 'Use uma imagem PNG, JPEG, GIF ou WebP.');
    const max = kind === 'banner' ? SOCIAL_LIMITS.bannerBytes : info.animated ? SOCIAL_LIMITS.animatedAvatarBytes : SOCIAL_LIMITS.avatarBytes;
    if (bytes.length > max) throw new ApiError(413, 'imagem_grande', `A imagem passa de ${Math.round(max / 1024 / 1024)} MB.`);
    if (kind === 'avatar' && (info.width < 32 || info.height < 32 || info.width > 2048 || info.height > 2048)) {
      throw new ApiError(400, 'dimensoes_invalidas', 'A foto de perfil deve ter de 32 a 2048 pixels de lado.');
    }
    if (kind === 'banner' && (info.width < 300 || info.height < 100 || info.width > 4096 || info.height > 4096)) {
      throw new ApiError(400, 'dimensoes_invalidas', 'O banner deve ter pelo menos 300 × 100 pixels (e no máximo 4096).');
    }
    const id = newId(16);
    await this.#db.tx(async (tx) => {
      await tx.query('INSERT INTO user_media (id, user_id, kind, mime, size, width, height, animated, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
        id,
        user.id,
        kind,
        info.mime,
        bytes.length,
        info.width,
        info.height,
        info.animated,
        bytes,
      ]);
      await tx.query(`UPDATE users SET ${kind === 'avatar' ? 'avatar' : 'banner'} = $2 WHERE id = $1`, [user.id, `arquivo:${id}`]);
      await tx.query('DELETE FROM user_media WHERE user_id = $1 AND kind = $2 AND id <> $3', [user.id, kind, id]);
    });
    await this.#community.userChanged(user.id);
    void this.#notifyRelated(user.id, { t: 'profile.changed', userId: user.id }).catch(() => undefined);
    return this.profile(user, user.id);
  }

  async media(id: string): Promise<{ mime: string; data: Uint8Array }> {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) throw new ApiError(404, 'arquivo_inexistente', 'Imagem não encontrada.');
    const [row] = await this.#db.query('SELECT mime, data FROM user_media WHERE id = $1', [id]);
    if (!row) throw new ApiError(404, 'arquivo_inexistente', 'Imagem não encontrada.');
    return { mime: String(row.mime), data: row.data as Uint8Array };
  }

  // --- Notas e apelidos pessoais ----------------------------------------------------------

  async notes(user: User) {
    return (await this.#db.query('SELECT target_id, note, nickname FROM user_notes WHERE owner_id = $1', [user.id])).map((row) => ({
      userId: String(row.target_id),
      note: String(row.note),
      nickname: String(row.nickname),
    }));
  }

  /** Nota e apelido que só quem escreveu vê. Não muda o nome de ninguém para os outros. */
  async setNote(user: User, targetId: string, input: Record<string, unknown>) {
    const target = await this.#user(targetId);
    if (!target || targetId === user.id) throw NOT_FOUND();
    const { state } = await this.#friendship(user.id, targetId);
    if (!(await this.#visible(user.id, target, state))) throw NOT_FOUND();
    const [current] = await this.#db.query('SELECT note, nickname FROM user_notes WHERE owner_id = $1 AND target_id = $2', [user.id, targetId]);
    const note = input.note === undefined ? String(current?.note ?? '') : cleanText(input.note, SOCIAL_LIMITS.note, true);
    const nickname = input.nickname === undefined ? String(current?.nickname ?? '') : cleanText(input.nickname, SOCIAL_LIMITS.nickname);
    if (!note && !nickname) {
      await this.#db.query('DELETE FROM user_notes WHERE owner_id = $1 AND target_id = $2', [user.id, targetId]);
    } else {
      await this.#db.query(
        `INSERT INTO user_notes (owner_id, target_id, note, nickname) VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_id, target_id) DO UPDATE SET note = EXCLUDED.note, nickname = EXCLUDED.nickname, updated_at = now()`,
        [user.id, targetId, note, nickname],
      );
    }
    this.#hub.toUser(user.id, { t: 'note.changed', userId: targetId });
    return { userId: targetId, note, nickname };
  }

  // --- Amizades e bloqueios ---------------------------------------------------------------

  async friends(user: User) {
    const rows = await this.#db.query(
      `SELECT f.*, u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name, u.avatar AS u_avatar, u.banner AS u_banner, u.is_bot AS u_is_bot, u.status_text AS u_status
         FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_low = $1 THEN f.user_high ELSE f.user_low END
        WHERE f.user_low = $1 OR f.user_high = $1
        ORDER BY u.display_name`,
      [user.id],
    );
    return rows.map((row) => {
      const friend = row.status === 'amigos';
      return {
        user: card(row, 'u_'),
        state: (friend ? 'amigos' : String(row.requested_by) === user.id ? 'enviada' : 'recebida') as FriendState,
        since: friend ? isoOrNull(row.accepted_at) : iso(row.created_at),
        online: friend && this.#hub.isOnline(String(row.u_id)),
        status: friend ? String(row.u_status ?? '') : '',
      };
    });
  }

  /** Pede amizade por nome de usuário (ou id). Se a outra pessoa já tinha pedido, vira amizade na hora. */
  async requestFriend(user: User, input: Record<string, unknown>) {
    let target: Row | null = null;
    if (typeof input.userId === 'string') target = await this.#user(input.userId);
    else if (typeof input.username === 'string') {
      const [row] = await this.#db.query('SELECT * FROM users WHERE username_key = $1', [input.username.trim().replace(/^@/, '').toLowerCase()]);
      target = row ?? null;
    }
    if (!target || String(target.id) === user.id || target.is_bot === true) throw new ApiError(404, 'usuario_inexistente', 'Não encontramos essa conta. Confira o nome de usuário.');
    const targetId = String(target.id);
    if ((await this.#blocked(targetId, user.id)) || (await this.#blocked(user.id, targetId))) throw NOT_ALLOWED();
    const { state } = await this.#friendship(user.id, targetId);
    if (state === 'amigos') throw new ApiError(409, 'ja_amigos', 'Vocês já são amigos.');
    if (state === 'enviada') return { state };
    if (state === 'recebida') return this.acceptFriend(user, targetId);
    const [count] = await this.#db.query('SELECT count(*) AS total FROM friendships WHERE user_low = $1 OR user_high = $1', [user.id]);
    if (num(count?.total) >= SOCIAL_LIMITS.friends) throw new ApiError(409, 'amigos_demais', `Cada conta tem no máximo ${SOCIAL_LIMITS.friends} amigos e pedidos.`);
    const [low, high] = pair(user.id, targetId);
    await this.#db.query("INSERT INTO friendships (user_low, user_high, requested_by, status) VALUES ($1, $2, $3, 'pendente') ON CONFLICT DO NOTHING", [low, high, user.id]);
    this.#friendEvent(user.id, targetId);
    return { state: 'enviada' as FriendState };
  }

  async acceptFriend(user: User, targetId: string) {
    const { state } = await this.#friendship(user.id, targetId);
    if (state !== 'recebida') throw new ApiError(409, 'sem_pedido', 'Não há pedido de amizade dessa conta.');
    const [low, high] = pair(user.id, targetId);
    await this.#db.query("UPDATE friendships SET status = 'amigos', accepted_at = now() WHERE user_low = $1 AND user_high = $2", [low, high]);
    this.#friendEvent(user.id, targetId);
    return { state: 'amigos' as FriendState };
  }

  /** Recusa um pedido, cancela o que enviou ou desfaz a amizade. */
  async removeFriend(user: User, targetId: string) {
    if (!ID.test(targetId)) throw NOT_FOUND();
    const [low, high] = pair(user.id, targetId);
    await this.#db.query('DELETE FROM friendships WHERE user_low = $1 AND user_high = $2', [low, high]);
    this.#friendEvent(user.id, targetId);
    return { state: 'nenhuma' as FriendState };
  }

  async blocks(user: User) {
    return (await this.#db.query('SELECT u.* FROM user_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = $1 ORDER BY u.display_name', [user.id])).map((row) => card(row));
  }

  /** Bloquear desfaz a amizade e impede mensagens e pedidos nos dois sentidos. */
  async block(user: User, targetId: string) {
    const target = await this.#user(targetId);
    if (!target || targetId === user.id) throw NOT_FOUND();
    const [low, high] = pair(user.id, targetId);
    await this.#db.tx(async (tx) => {
      await tx.query('INSERT INTO user_blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, targetId]);
      await tx.query('DELETE FROM friendships WHERE user_low = $1 AND user_high = $2', [low, high]);
    });
    this.#friendEvent(user.id, targetId);
    return { blocked: true };
  }

  async unblock(user: User, targetId: string) {
    await this.#db.query('DELETE FROM user_blocks WHERE user_id = $1 AND blocked_id = $2', [user.id, targetId]);
    this.#hub.toUser(user.id, { t: 'friend.changed', userId: targetId });
    return { blocked: false };
  }

  #friendEvent(a: string, b: string): void {
    this.#hub.toUser(a, { t: 'friend.changed', userId: b });
    this.#hub.toUser(b, { t: 'friend.changed', userId: a });
  }

  /** Algo que aparece em volta do perfil mudou (itens equipados): grupos e amigos recarregam. */
  async announceProfileChange(userId: string): Promise<void> {
    await this.#community.userChanged(userId);
    await this.#notifyRelated(userId, { t: 'profile.changed', userId });
  }

  async #notifyRelated(userId: string, event: { t: string; [key: string]: unknown }): Promise<void> {
    const rows = await this.#db.query(
      "SELECT CASE WHEN user_low = $1 THEN user_high ELSE user_low END AS other FROM friendships WHERE (user_low = $1 OR user_high = $1) AND status = 'amigos'",
      [userId],
    );
    for (const row of rows) this.#hub.toUser(String(row.other), event);
    this.#hub.toUser(userId, event);
  }

  // --- Mensagens privadas -----------------------------------------------------------------

  /** Pode mandar mensagem: ninguém bloqueou ninguém e a outra pessoa aceita (amigos, ou quem divide um grupo). */
  async #canMessage(from: string, target: Row): Promise<boolean> {
    const targetId = String(target.id);
    if (from === targetId || target.is_bot === true) return false;
    if ((await this.#blocked(targetId, from)) || (await this.#blocked(from, targetId))) return false;
    const { state } = await this.#friendship(from, targetId);
    if (state === 'amigos') return true;
    return target.dm_privacy === 'membros' && (await this.#shareGroup(from, targetId));
  }

  async #dm(user: User, dmId: string): Promise<{ id: string; other: string }> {
    if (!ID.test(dmId)) throw new ApiError(404, 'conversa_inexistente', 'Conversa não encontrada.');
    const [row] = await this.#db.query('SELECT * FROM dm_channels WHERE id = $1 AND (user_low = $2 OR user_high = $2)', [dmId, user.id]);
    if (!row) throw new ApiError(404, 'conversa_inexistente', 'Conversa não encontrada.');
    return { id: dmId, other: String(row.user_low) === user.id ? String(row.user_high) : String(row.user_low) };
  }

  async openDm(user: User, targetId: string) {
    const target = await this.#user(targetId);
    if (!target) throw NOT_FOUND();
    const [low, high] = pair(user.id, targetId);
    const [existing] = await this.#db.query('SELECT id FROM dm_channels WHERE user_low = $1 AND user_high = $2', [low, high]);
    // Sem relação nenhuma, a conta "não existe" para quem pergunta (não confirma nomes de usuário).
    if (!existing && !(await this.#visible(user.id, target, (await this.#friendship(user.id, targetId)).state))) throw NOT_FOUND();
    if (!existing && !(await this.#canMessage(user.id, target))) {
      throw new ApiError(403, 'mensagem_bloqueada', 'Essa pessoa só recebe mensagens de amigos (ou vocês não dividem um grupo).');
    }
    const id = existing ? String(existing.id) : newId();
    if (!existing) {
      await this.#db.query('INSERT INTO dm_channels (id, user_low, user_high) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, low, high]);
    }
    const [row] = await this.#db.query('SELECT id FROM dm_channels WHERE user_low = $1 AND user_high = $2', [low, high]);
    const dmId = String(row!.id);
    await this.#db.query('INSERT INTO dm_states (dm_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING', [dmId, user.id, targetId]);
    return { id: dmId };
  }

  /** Conversas recentes, com a última mensagem e quantas não lidas. */
  async conversations(user: User) {
    const rows = await this.#db.query(
      `SELECT d.id, d.last_message_id, s.last_read_id, s.notify,
              u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name, u.avatar AS u_avatar, u.banner AS u_banner, u.is_bot AS u_is_bot,
              m.content AS last_content, m.author_id AS last_author, m.created_at AS last_at, m.meta AS last_meta,
              (SELECT count(*) FROM dm_messages x WHERE x.dm_id = d.id AND x.id > coalesce(s.last_read_id, 0) AND x.author_id IS DISTINCT FROM $1) AS unread
         FROM dm_channels d
         JOIN dm_states s ON s.dm_id = d.id AND s.user_id = $1
         JOIN users u ON u.id = CASE WHEN d.user_low = $1 THEN d.user_high ELSE d.user_low END
         LEFT JOIN dm_messages m ON m.id = d.last_message_id
        WHERE d.user_low = $1 OR d.user_high = $1
        ORDER BY d.last_message_id DESC, d.created_at DESC
        LIMIT 100`,
      [user.id],
    );
    return rows.map((row) => ({
      id: String(row.id),
      user: card(row, 'u_'),
      online: this.#hub.isOnline(String(row.u_id)),
      last: row.last_at
        ? { content: row.last_meta ? 'Convite para um grupo' : String(row.last_content).slice(0, 120), mine: String(row.last_author) === user.id, at: iso(row.last_at) }
        : null,
      unread: num(row.unread),
      notify: String(row.notify) as 'tudo' | 'nada',
    }));
  }

  async #hydrate(rows: Row[]): Promise<DmMessage[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => String(row.id));
    const [files, reactions, replies] = await Promise.all([
      this.#db.query('SELECT id, message_id, name, mime, size, width, height FROM dm_files WHERE message_id = ANY($1::bigint[]) ORDER BY created_at', [ids]),
      this.#db.query('SELECT message_id, emoji, user_id FROM dm_reactions WHERE message_id = ANY($1::bigint[]) ORDER BY created_at', [ids]),
      this.#db.query(
        'SELECT m.id, m.author_id, m.content, u.display_name FROM dm_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ANY($1::bigint[])',
        [rows.map((row) => row.reply_to).filter((value) => value !== null && value !== undefined).map(String)],
      ),
    ]);
    return rows.map((row) => {
      const id = String(row.id);
      const reply = row.reply_to === null || row.reply_to === undefined ? undefined : replies.find((item) => String(item.id) === String(row.reply_to));
      const grouped = new Map<string, string[]>();
      for (const reaction of reactions.filter((item) => String(item.message_id) === id)) {
        const list = grouped.get(String(reaction.emoji)) ?? [];
        list.push(String(reaction.user_id));
        grouped.set(String(reaction.emoji), list);
      }
      return {
        id,
        dmId: String(row.dm_id),
        author: { id: row.author_id === null ? null : String(row.author_id), name: String(row.author_name ?? 'Conta removida'), username: row.author_username === null || row.author_username === undefined ? null : String(row.author_username) },
        content: String(row.content),
        createdAt: iso(row.created_at),
        editedAt: isoOrNull(row.edited_at),
        reply: reply ? { id: String(reply.id), authorId: reply.author_id === null ? null : String(reply.author_id), authorName: String(reply.display_name ?? 'Conta removida'), excerpt: String(reply.content).slice(0, 120) } : null,
        attachments: files
          .filter((file) => String(file.message_id) === id)
          .map((file) => ({ id: String(file.id), name: String(file.name), mime: String(file.mime), size: num(file.size), width: file.width === null ? null : num(file.width), height: file.height === null ? null : num(file.height) })),
        reactions: [...grouped].map(([emoji, users]) => ({ emoji, users })),
        meta: (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta) as DmMeta | null,
      };
    });
  }

  async #messageRows(where: string, params: unknown[]): Promise<Row[]> {
    return this.#db.query(
      `SELECT m.*, u.display_name AS author_name, u.username AS author_username FROM dm_messages m LEFT JOIN users u ON u.id = m.author_id WHERE ${where}`,
      params,
    );
  }

  async messages(user: User, dmId: string, options: { before?: unknown; limit?: unknown } = {}) {
    await this.#dm(user, dmId);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
    const before = typeof options.before === 'string' && MESSAGE_ID.test(options.before) ? options.before : null;
    const rows = await this.#messageRows(`m.dm_id = $1 AND ($2::bigint IS NULL OR m.id < $2::bigint) ORDER BY m.id DESC LIMIT ${limit}`, [dmId, before]);
    return (await this.#hydrate(rows)).reverse();
  }

  async send(user: User, dmId: string, input: Record<string, unknown>): Promise<DmMessage> {
    const dm = await this.#dm(user, dmId);
    const other = await this.#user(dm.other);
    if (!other || !(await this.#canMessage(user.id, other))) throw new ApiError(403, 'mensagem_bloqueada', 'Você não pode mandar mensagens para essa pessoa agora.');
    const content = cleanText(input.content, SOCIAL_LIMITS.message, true);
    const attachments = Array.isArray(input.attachments) ? [...new Set(input.attachments.filter((item): item is string => typeof item === 'string' && ID.test(item)))].slice(0, 10) : [];
    let meta: DmMeta | null = null;
    if (input.invite && typeof input.invite === 'object') {
      // Convite visual para um grupo: criado com as permissões de quem envia (precisa poder convidar).
      const groupId = String((input.invite as Record<string, unknown>).groupId ?? '');
      const invite = await this.#community.createInvite(user, groupId, { expiresInHours: 168 });
      const snap = await this.#community.snapshot(groupId);
      meta = {
        type: 'convite',
        code: invite.code,
        group: { id: snap.group.id, name: snap.group.name, description: snap.group.description, icon: snap.group.icon },
        expiresAt: invite.expiresAt,
      };
    }
    if (!content && attachments.length === 0 && !meta) throw new ApiError(400, 'mensagem_vazia', 'Escreva algo ou anexe um arquivo.');
    let replyTo: string | null = null;
    if (typeof input.replyTo === 'string' && MESSAGE_ID.test(input.replyTo)) {
      const [target] = await this.#db.query('SELECT id FROM dm_messages WHERE id = $1 AND dm_id = $2', [input.replyTo, dmId]);
      replyTo = target ? String(target.id) : null;
    }
    const id = await this.#db.tx(async (tx) => {
      const [row] = await tx.query('INSERT INTO dm_messages (dm_id, author_id, content, reply_to, meta) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id', [dmId, user.id, content, replyTo, meta ? JSON.stringify(meta) : null]);
      const messageId = String(row!.id);
      if (attachments.length > 0) {
        const linked = await tx.query('UPDATE dm_files SET message_id = $1 WHERE id = ANY($2::text[]) AND dm_id = $3 AND uploader_id = $4 AND message_id IS NULL RETURNING id', [messageId, attachments, dmId, user.id]);
        if (linked.length !== attachments.length) throw new ApiError(400, 'anexo_invalido', 'Um dos anexos não pôde ser usado. Envie de novo.');
      }
      await tx.query('UPDATE dm_channels SET last_message_id = $2 WHERE id = $1', [dmId, messageId]);
      await tx.query('INSERT INTO dm_states (dm_id, user_id, last_read_id) VALUES ($1, $2, $3) ON CONFLICT (dm_id, user_id) DO UPDATE SET last_read_id = EXCLUDED.last_read_id', [dmId, user.id, messageId]);
      await tx.query('INSERT INTO dm_states (dm_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [dmId, dm.other]);
      return messageId;
    });
    const [message] = await this.#hydrate(await this.#messageRows('m.id = $1', [id]));
    this.#deliver(user.id, dm.other, { t: 'dm.message', message });
    return message!;
  }

  async edit(user: User, messageId: string, input: Record<string, unknown>): Promise<DmMessage> {
    const row = await this.#own(user, messageId);
    const content = cleanText(input.content, SOCIAL_LIMITS.message, true);
    if (!content) throw new ApiError(400, 'mensagem_vazia', 'A mensagem não pode ficar vazia.');
    await this.#db.query('UPDATE dm_messages SET content = $2, edited_at = now() WHERE id = $1', [messageId, content]);
    const [message] = await this.#hydrate(await this.#messageRows('m.id = $1', [messageId]));
    const dm = await this.#dm(user, String(row.dm_id));
    this.#deliver(user.id, dm.other, { t: 'dm.updated', message });
    return message!;
  }

  async remove(user: User, messageId: string): Promise<void> {
    const row = await this.#own(user, messageId);
    const dm = await this.#dm(user, String(row.dm_id));
    await this.#db.tx(async (tx) => {
      await tx.query('DELETE FROM dm_messages WHERE id = $1', [messageId]);
      await tx.query('UPDATE dm_channels SET last_message_id = coalesce((SELECT max(id) FROM dm_messages WHERE dm_id = $1), 0) WHERE id = $1', [dm.id]);
    });
    this.#deliver(user.id, dm.other, { t: 'dm.deleted', dmId: dm.id, id: messageId });
  }

  async #own(user: User, messageId: string): Promise<Row> {
    if (!MESSAGE_ID.test(messageId)) throw new ApiError(404, 'mensagem_inexistente', 'Mensagem não encontrada.');
    const [row] = await this.#db.query('SELECT * FROM dm_messages WHERE id = $1', [messageId]);
    if (!row) throw new ApiError(404, 'mensagem_inexistente', 'Mensagem não encontrada.');
    await this.#dm(user, String(row.dm_id));
    if (String(row.author_id) !== user.id) throw new ApiError(403, 'sem_permissao', 'Você só pode mudar as suas mensagens.');
    return row;
  }

  async react(user: User, messageId: string, emoji: string, on: boolean): Promise<DmMessage> {
    if (!MESSAGE_ID.test(messageId)) throw new ApiError(404, 'mensagem_inexistente', 'Mensagem não encontrada.');
    const clean = cleanText(emoji, 32);
    if (!clean || clean.length > 32) throw new ApiError(400, 'emoji_invalido', 'Emoji inválido.');
    const [row] = await this.#db.query('SELECT dm_id FROM dm_messages WHERE id = $1', [messageId]);
    if (!row) throw new ApiError(404, 'mensagem_inexistente', 'Mensagem não encontrada.');
    const dm = await this.#dm(user, String(row.dm_id));
    if (on) await this.#db.query('INSERT INTO dm_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [messageId, user.id, clean]);
    else await this.#db.query('DELETE FROM dm_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [messageId, user.id, clean]);
    const [message] = await this.#hydrate(await this.#messageRows('m.id = $1', [messageId]));
    this.#deliver(user.id, dm.other, { t: 'dm.updated', message });
    return message!;
  }

  async markRead(user: User, dmId: string, messageId: unknown): Promise<void> {
    await this.#dm(user, dmId);
    if (typeof messageId !== 'string' || !MESSAGE_ID.test(messageId)) throw new ApiError(400, 'mensagem_invalida', 'Informe a última mensagem lida.');
    await this.#db.query(
      `INSERT INTO dm_states (dm_id, user_id, last_read_id) VALUES ($1, $2, LEAST($3::bigint, (SELECT coalesce(max(id), 0) FROM dm_messages WHERE dm_id = $1)))
       ON CONFLICT (dm_id, user_id) DO UPDATE SET last_read_id = GREATEST(dm_states.last_read_id, EXCLUDED.last_read_id)`,
      [dmId, user.id, messageId],
    );
    this.#hub.toUser(user.id, { t: 'dm.read', dmId });
  }

  async setNotify(user: User, dmId: string, level: unknown): Promise<void> {
    await this.#dm(user, dmId);
    if (level !== 'tudo' && level !== 'nada') throw new ApiError(400, 'nivel_invalido', 'Escolha "tudo" ou "nada".');
    await this.#db.query('UPDATE dm_states SET notify = $3 WHERE dm_id = $1 AND user_id = $2', [dmId, user.id, level]);
  }

  async uploadFile(user: User, dmId: string, input: { name: unknown; mime: unknown; bytes: Uint8Array; width?: unknown; height?: unknown }) {
    const dm = await this.#dm(user, dmId);
    const other = await this.#user(dm.other);
    if (!other || !(await this.#canMessage(user.id, other))) throw new ApiError(403, 'mensagem_bloqueada', 'Você não pode mandar arquivos para essa pessoa agora.');
    if (input.bytes.length === 0) throw new ApiError(400, 'arquivo_vazio', 'O arquivo está vazio.');
    if (input.bytes.length > this.#community.limits.fileBytes) throw this.#community.fileTooBig();
    const name = cleanText(input.name, 120).replace(/[\\/:*?"<>|]/g, '_') || 'arquivo';
    // O tipo vem do conteúdo quando é imagem; o resto é guardado como dado genérico (vira download).
    const image = imageInfo(input.bytes);
    const mime = image?.mime ?? (typeof input.mime === 'string' && /^(video\/(mp4|webm)|audio\/(mpeg|ogg|wav|webm|mp4)|application\/pdf|text\/plain)$/.test(input.mime) ? input.mime : 'application/octet-stream');
    const id = newId(16);
    await this.#db.query('INSERT INTO dm_files (id, dm_id, uploader_id, name, mime, size, width, height, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
      id,
      dmId,
      user.id,
      name,
      mime,
      input.bytes.length,
      image?.width ?? null,
      image?.height ?? null,
      input.bytes,
    ]);
    return { id, name, mime, size: input.bytes.length, width: image?.width ?? null, height: image?.height ?? null };
  }

  async readFile(user: User, fileId: string): Promise<{ name: string; mime: string; data: Uint8Array }> {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(fileId)) throw new ApiError(404, 'arquivo_inexistente', 'Arquivo não encontrado.');
    const [row] = await this.#db.query('SELECT dm_id, name, mime, data FROM dm_files WHERE id = $1', [fileId]);
    if (!row) throw new ApiError(404, 'arquivo_inexistente', 'Arquivo não encontrado.');
    // Quem não está na conversa recebe o mesmo "não encontrado": nem a existência do arquivo é revelada.
    await this.#dm(user, String(row.dm_id)).catch(() => {
      throw new ApiError(404, 'arquivo_inexistente', 'Arquivo não encontrado.');
    });
    return { name: String(row.name), mime: String(row.mime), data: row.data as Uint8Array };
  }

  #deliver(a: string, b: string, event: { t: string; [key: string]: unknown }): void {
    this.#hub.toUser(a, event);
    this.#hub.toUser(b, event);
  }
}
