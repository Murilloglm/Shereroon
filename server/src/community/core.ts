/**
 * Grupos, canais, cargos e mensagens. TODA regra de permissão e de hierarquia é decidida aqui, no backend:
 * a interface só mostra o resultado. As rotas HTTP (routes.ts) apenas traduzem requisições em chamadas a
 * esta classe, e os bots usam os mesmos métodos, sujeitos às mesmas regras.
 */
import {
  ALL_PERMISSIONS,
  basePermissions,
  canActOnMember,
  canManageRole,
  channelPermissions,
  DEFAULT_EVERYONE,
  forbiddenChanges,
  GROUP_WIDE,
  has,
  P,
  parsePermissions,
  PERMISSIONS,
  ROLE_TEMPLATES,
  topPosition,
  type OverrideLike,
  type RoleLike,
  type Subject,
} from '../../../shared/permissions.ts';
import { big, iso, isoOrNull, num, type Db, type Row } from '../db/db.ts';
import { ApiError } from '../errors.ts';
import { RateLimiter } from '../ratelimit.ts';
import type { PublishRights, Sfu } from '../sfu.ts';
import { describeSfuError, sfuError } from '../sfu-errors.ts';
import { cleanText, newId, type User } from './auth.ts';
import type { Hub } from './hub.ts';
import { Social } from './social.ts';
import { Activities } from './activities.ts';
import { adminAudit, isCosmicAdmin } from './global-admin.ts';
import { imageInfo } from '../../../shared/image-info.ts';
import { checkMessageRequest, messageRequest } from './message-request.ts';
import { timed } from '../timing.ts';

export type ChannelKind = 'categoria' | 'texto' | 'voz';

export interface Group {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  isPublic: boolean;
  ownerId: string;
  createdAt: string;
}

export interface Role extends RoleLike {
  groupId: string;
  name: string;
  color: string | null;
  /** Cargo criado para um bot instalado. Só a Central de Bots mexe nele; a posição pode ser mudada como a de qualquer cargo. */
  botId: string | null;
}

export interface Channel {
  id: string;
  groupId: string;
  kind: ChannelKind;
  name: string;
  topic: string;
  parentId: string | null;
  position: number;
  userLimit: number;
  /** Só canais de voz: as mensagens do chat da chamada somem quando o canal esvazia. */
  temporaryChat: boolean;
}

export interface Override extends OverrideLike {
  channelId: string;
}

export interface Member {
  userId: string;
  cosmicAdmin?: boolean;
  username: string;
  displayName: string;
  nickname: string | null;
  joinedAt: string;
  timeoutUntil: string | null;
  roleIds: Set<string>;
  /** Conta de um bot instalado no grupo. */
  bot: boolean;
  /** 'padrao:<n>' ou 'arquivo:<id>' (null = iniciais). */
  avatar: string | null;
}

/** Tudo de um grupo que as regras de permissão precisam, carregado de uma vez e guardado até a próxima mudança. */
export interface Snapshot {
  group: Group;
  roles: Role[];
  everyone: Role;
  channels: Map<string, Channel>;
  overrides: Map<string, Override[]>;
  members: Map<string, Member>;
}

interface Ctx {
  user: User;
  snap: Snapshot;
  me: Member;
  subject: Subject;
  base: bigint;
}

export interface Message {
  id: string;
  clientId?: string | null;
  channelId: string;
  author: { id: string | null; name: string; username: string | null; bot: boolean };
  content: string;
  mentionEveryone: boolean;
  pinned: boolean;
  createdAt: string;
  editedAt: string | null;
  meta: MessageMeta | null;
  /** Mensagem à qual esta responde (null se não é resposta ou se a original foi apagada). */
  reply: { id: string; authorId: string | null; authorName: string; excerpt: string } | null;
  /** Contas mencionadas (por @usuario ou por serem o autor da mensagem respondida). */
  mentions: string[];
  attachments: Attachment[];
  reactions: { emoji: string; users: string[] }[];
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

export type NotifyLevel = 'tudo' | 'mencoes' | 'nada';
const NOTIFY_LEVELS: readonly NotifyLevel[] = ['tudo', 'mencoes', 'nada'];

export interface UnreadState {
  /** Última mensagem do canal. */
  last: string | null;
  /** Até onde esta pessoa leu. */
  read: string | null;
  /** Menções a ela depois disso. */
  mentions: number;
  /** Mensagens novas de outras pessoas (até 100). */
  count: number;
}

/** Complementos de uma mensagem de bot. Um botão, ao ser clicado, envia `command` como se a pessoa tivesse digitado. */
export interface MessageMeta {
  buttons?: { label: string; command: string; style?: 'primario' | 'perigo' }[];
  /** Mensagem que só faz sentido para uma pessoa (resposta a um comando dela). Todos do canal ainda a veem. */
  replyTo?: string;
  /** Destaques Cósmicos: mensagem em destaque (pedida por um membro) e efeito visual. Só bots publicam isso. */
  style?: 'destaque';
  highlightOf?: string;
  effect?: 'confete' | 'estrelas' | 'aurora';
}

export interface CommunityOptions {
  livekitUrl: string;
  tokenTtlSeconds: number;
  /** Tamanho máximo de um arquivo enviado no chat. */
  maxFileBytes?: number;
  /** Quanto cada grupo pode guardar em arquivos, somando todos os canais. */
  groupStorageBytes?: number;
}

export const LIMITS = {
  groupsPerUser: 100,
  rolesPerGroup: 250,
  channelsPerGroup: 300,
  messageChars: 4000,
  nameChars: 48,
  topicChars: 300,
  descriptionChars: 300,
  iconChars: 140_000,
  voiceUsers: 99,
  fileBytes: 10 * 1024 * 1024,
  groupStorageBytes: 400 * 1024 * 1024,
  fileNameChars: 120,
  attachmentsPerMessage: 10,
  reactionsPerMessage: 20,
  excerptChars: 140,
};

/** Tipos que o navegador pode mostrar dentro da conversa. Todo o resto só sai como download. */
const INLINE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4']);
const MIME = /^[a-z0-9][a-z0-9.+-]{0,60}\/[a-z0-9][a-z0-9.+-]{0,80}$/;
/** Um emoji: bandeira, tecla numerada ou pictograma (com tom de pele e junções, como 👨‍👩‍👧). */
const EMOJI = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;
const MENTION = /(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{3,24})/g;
const MESSAGE_ID = /^\d{1,18}$/;
const FILE_COLUMNS = 'id, name, mime, size, width, height';

const toAttachment = (row: Row): Attachment => ({
  id: String(row.id),
  name: String(row.name),
  mime: String(row.mime),
  size: num(row.size),
  width: row.width === null || row.width === undefined ? null : num(row.width),
  height: row.height === null || row.height === undefined ? null : num(row.height),
});

const jsonArray = (value: unknown): unknown[] => {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
};

/** Lado de uma imagem informado por quem enviou. Serve só para reservar o espaço na tela. */
const dimension = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 20_000 ? parsed : null;
};

const NOT_FOUND = () => new ApiError(404, 'grupo_inexistente', 'Grupo não encontrado.');
const NO_CHANNEL = () => new ApiError(404, 'canal_inexistente', 'Canal não encontrado.');
const LINK = /\bhttps?:\/\/\S|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;
const CHANNEL_SCOPED = ALL_PERMISSIONS & ~GROUP_WIDE;
export const voiceRoom = (channelId: string): string => `sr-vc-${channelId}`;

const str = (set: bigint): string => set.toString();

function permissionName(bit: bigint): string {
  return PERMISSIONS.find((item) => 1n << BigInt(item.bit) === bit)?.name ?? 'necessária';
}

function requiredName(value: unknown, what: string, max = LIMITS.nameChars): string {
  const clean = cleanText(value, max);
  if (!clean) throw new ApiError(400, 'nome_invalido', `Informe ${what}.`);
  return clean;
}

function optionalColor(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new ApiError(400, 'cor_invalida', 'A cor deve estar no formato #rrggbb.');
  return value.toLowerCase();
}

function optionalIcon(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > LIMITS.iconChars || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) {
    throw new ApiError(400, 'icone_invalido', 'O ícone deve ser uma imagem PNG, JPEG ou WebP de até 100 KB.');
  }
  return value;
}

const toGroup = (row: Row): Group => ({
  id: String(row.id),
  name: String(row.name),
  description: String(row.description),
  icon: row.icon === null ? null : String(row.icon),
  isPublic: row.is_public === true,
  ownerId: String(row.owner_id),
  createdAt: iso(row.created_at),
});

const toMessage = (row: Row): Message => ({
  id: String(row.id),
  clientId: row.client_id == null ? null : String(row.client_id),
  channelId: String(row.channel_id),
  author: {
    id: row.author_id === null ? null : String(row.author_id),
    name: String(row.author_name ?? row.display_name ?? 'Conta removida'),
    username: row.username === null || row.username === undefined ? null : String(row.username),
    bot: row.is_bot === true,
  },
  content: String(row.content),
  mentionEveryone: row.mention_everyone === true,
  pinned: row.pinned === true,
  createdAt: iso(row.created_at),
  editedAt: isoOrNull(row.edited_at),
  meta: row.meta === null || row.meta === undefined ? null : ((typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta) as MessageMeta),
  reply:
    row.reply_id === null || row.reply_id === undefined
      ? null
      : {
          id: String(row.reply_id),
          authorId: row.reply_author_id === null ? null : String(row.reply_author_id),
          authorName: String(row.reply_author_name ?? 'Conta removida'),
          excerpt: Array.from(String(row.reply_content ?? '')).slice(0, LIMITS.excerptChars).join(''),
        },
  mentions: jsonArray(row.mentions).map(String),
  attachments: [],
  reactions: [],
});

const MESSAGE_SELECT = `SELECT m.*, u.display_name, u.username, u.is_bot,
       r.id AS reply_id, r.author_id AS reply_author_id, r.content AS reply_content, coalesce(r.author_name, ru.display_name) AS reply_author_name
  FROM messages m
  LEFT JOIN users u ON u.id = m.author_id
  LEFT JOIN messages r ON r.id = m.reply_to
  LEFT JOIN users ru ON ru.id = r.author_id`;

/** O que acontece nos grupos e interessa aos bots. Sai depois de a mudança já estar gravada. */
export type CommunityEvent =
  | { type: 'message'; groupId: string; channel: Channel; message: Message; author: User; fromBot: boolean }
  | { type: 'member.join'; groupId: string; userId: string }
  | { type: 'member.leave'; groupId: string; userId: string; reason: 'saiu' | 'expulso' | 'banido' }
  | { type: 'member.roles'; groupId: string; userId: string; added: string[]; removed: string[] }
  | { type: 'voice.join'; groupId: string; channelId: string; userId: string }
  | { type: 'voice.leave'; groupId: string; channelId: string; userId: string };

export class Community {
  readonly hub: Hub;
  readonly #db: Db;
  readonly #sfu: Sfu;
  readonly #options: CommunityOptions;
  readonly #limiter: RateLimiter;
  readonly #cache = new Map<string, Promise<Snapshot>>();
  readonly #channelGroup = new Map<string, string>();
  /** Quem foi movido por um moderador pode entrar no canal de destino uma vez, mesmo sem a permissão "Conectar". */
  readonly #movePass = new Map<string, { channelId: string; expires: number }>();
  /** Limites de arquivos desta instalação (vêm da configuração; os testes ajustam). */
  readonly limits: { fileBytes: number; groupStorageBytes: number };
  /** Perfis, amizades e mensagens privadas (fora das regras dos grupos). */
  readonly social: Social;
  readonly activities: Activities;

  constructor(db: Db, hub: Hub, sfu: Sfu, options: CommunityOptions, limiter = new RateLimiter()) {
    this.#db = db;
    this.hub = hub;
    this.#sfu = sfu;
    this.#options = options;
    this.#limiter = limiter;
    this.limits = { fileBytes: options.maxFileBytes ?? LIMITS.fileBytes, groupStorageBytes: options.groupStorageBytes ?? LIMITS.groupStorageBytes };
    this.social = new Social(db, hub, this);
    this.activities = new Activities(db, hub);
    hub.canSeeChannel = (groupId, channelId, userId) => this.canSee(groupId, channelId, userId);
    hub.onVoiceDropped = (userId, place) => void sfu.removeParticipant(voiceRoom(place.channelId), userId).catch(() => undefined);
    hub.onVoiceChanged = (userId, before, after) => {
      if (before) this.#emit({ type: 'voice.leave', groupId: before.groupId, channelId: before.channelId, userId });
      if (after) this.#emit({ type: 'voice.join', groupId: after.groupId, channelId: after.channelId, userId });
      if (before && before.channelId !== after?.channelId) void this.#voiceEmptied(before.groupId, before.channelId).catch(() => undefined);
    };
  }

  /** O último saiu de um canal de voz com chat temporário: as mensagens dele são apagadas (para todos). */
  async #voiceEmptied(groupId: string, channelId: string): Promise<void> {
    if ((this.hub.voiceIn(groupId)[channelId] ?? []).length > 0) return;
    const channel = (await this.snapshot(groupId)).channels.get(channelId);
    if (!channel?.temporaryChat) return;
    const removed = await this.#db.query('DELETE FROM messages WHERE channel_id = $1 RETURNING id', [channelId]);
    if (removed.length > 0) await this.hub.publishToChannel(groupId, channelId, { t: 'channel.cleared', groupId, channelId });
  }

  // --- Eventos internos (para os bots) -----------------------------------------------------

  readonly #listeners = new Set<(event: CommunityEvent) => void>();

  /** Registra um ouvinte dos eventos dos grupos. Um ouvinte que falha não atrapalha a ação que gerou o evento. */
  onEvent(listener: (event: CommunityEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: CommunityEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[eventos]', error);
      }
    }
  }

  /** Para quem altera o grupo por fora desta classe (a Central de Bots): invalida o estado guardado e avisa os conectados. */
  touch(groupId: string): void {
    this.#changed(groupId);
  }

  // --- Leitura do estado e contas de permissão ---------------------------------------------

  snapshot(groupId: string): Promise<Snapshot> {
    let pending = this.#cache.get(groupId);
    if (!pending) {
      pending = this.#load(groupId);
      this.#cache.set(groupId, pending);
      pending.catch(() => this.#cache.get(groupId) === pending && this.#cache.delete(groupId));
    }
    return pending;
  }

  async #load(groupId: string): Promise<Snapshot> {
    const [group] = await this.#db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
    if (!group) throw NOT_FOUND();
    const [roleRows, channelRows, overrideRows, memberRows, memberRoleRows] = await Promise.all([
      this.#db.query('SELECT * FROM roles WHERE group_id = $1 ORDER BY position DESC', [groupId]),
      this.#db.query('SELECT * FROM channels WHERE group_id = $1 ORDER BY position, created_at', [groupId]),
      this.#db.query('SELECT o.* FROM overrides o JOIN channels c ON c.id = o.channel_id WHERE c.group_id = $1', [groupId]),
      this.#db.query(
        'SELECT m.*, u.username, u.display_name, u.is_bot, u.avatar, EXISTS (SELECT 1 FROM global_permissions gp WHERE gp.user_id = u.id) AS cosmic_admin FROM members m JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 ORDER BY m.joined_at',
        [groupId],
      ),
      this.#db.query('SELECT user_id, role_id FROM member_roles WHERE group_id = $1', [groupId]),
    ]);
    const roles: Role[] = roleRows.map((row) => ({
      id: String(row.id),
      groupId,
      name: String(row.name),
      color: row.color === null ? null : String(row.color),
      position: num(row.position),
      permissions: big(row.permissions),
      isEveryone: row.is_everyone === true,
      botId: row.bot_id === null || row.bot_id === undefined ? null : String(row.bot_id),
    }));
    const everyone = roles.find((role) => role.isEveryone);
    if (!everyone) throw new Error(`grupo ${groupId} sem o cargo @everyone`);
    const channels = new Map<string, Channel>();
    for (const row of channelRows) {
      const channel: Channel = {
        id: String(row.id),
        groupId,
        kind: String(row.kind) as ChannelKind,
        name: String(row.name),
        topic: String(row.topic),
        parentId: row.parent_id === null ? null : String(row.parent_id),
        position: num(row.position),
        userLimit: num(row.user_limit),
        temporaryChat: row.temporary_chat === true,
      };
      channels.set(channel.id, channel);
      this.#channelGroup.set(channel.id, groupId);
    }
    const overrides = new Map<string, Override[]>();
    for (const row of overrideRows) {
      const item: Override = {
        channelId: String(row.channel_id),
        targetKind: String(row.target_kind) as Override['targetKind'],
        targetId: String(row.target_id),
        allow: big(row.allow),
        deny: big(row.deny),
      };
      overrides.set(item.channelId, [...(overrides.get(item.channelId) ?? []), item]);
    }
    const members = new Map<string, Member>();
    for (const row of memberRows) {
      members.set(String(row.user_id), {
        userId: String(row.user_id),
        cosmicAdmin: row.cosmic_admin === true,
        username: String(row.username),
        displayName: String(row.display_name),
        nickname: row.nickname === null ? null : String(row.nickname),
        joinedAt: iso(row.joined_at),
        timeoutUntil: isoOrNull(row.timeout_until),
        roleIds: new Set(),
        bot: row.is_bot === true,
        avatar: row.avatar === null || row.avatar === undefined ? null : String(row.avatar),
      });
    }
    for (const row of memberRoleRows) members.get(String(row.user_id))?.roleIds.add(String(row.role_id));
    return { group: toGroup(group), roles, everyone, channels, overrides, members };
  }

  /** Depois de qualquer mudança: a próxima leitura busca de novo, e quem está conectado é avisado. */
  #changed(groupId: string): void {
    this.#cache.delete(groupId);
    this.hub.publish(groupId, { t: 'group.changed', groupId });
  }

  subjectOf(snap: Snapshot, member: Member): Subject {
    return {
      userId: member.userId,
      isOwner: snap.group.ownerId === member.userId,
      isCosmicAdmin: member.cosmicAdmin === true,
      roleIds: member.roleIds,
      timedOut: member.timeoutUntil !== null && Date.parse(member.timeoutUntil) > Date.now(),
    };
  }

  permissionsIn(snap: Snapshot, subject: Subject, channel: Channel): bigint {
    const parent = channel.parentId ? (snap.overrides.get(channel.parentId) ?? []) : [];
    return channelPermissions(subject, snap.roles, [parent, snap.overrides.get(channel.id) ?? []]);
  }

  async canSee(groupId: string, channelId: string, userId: string): Promise<boolean> {
    const snap = await this.snapshot(groupId);
    const member = snap.members.get(userId);
    if (member) member.cosmicAdmin = await isCosmicAdmin(this.#db, userId);
    const channel = snap.channels.get(channelId);
    return Boolean(member && channel) && has(this.permissionsIn(snap, this.subjectOf(snap, member!), channel!), P.VIEW_CHANNEL);
  }

  async groupIdsOf(userId: string): Promise<string[]> {
    return (await this.#db.query('SELECT group_id FROM members WHERE user_id = $1', [userId])).map((row) => String(row.group_id));
  }

  async #ctx(user: User, groupId: string): Promise<Ctx> {
    const snap = await this.snapshot(groupId);
    const admins = new Set((await this.#db.query('SELECT user_id FROM global_permissions')).map((row) => String(row.user_id)));
    for (const member of snap.members.values()) member.cosmicAdmin = admins.has(member.userId);
    const me = snap.members.get(user.id);
    // Quem não é membro recebe a mesma resposta de "grupo não existe": não dá para sondar grupos privados.
    if (!me) throw NOT_FOUND();
    if (me.cosmicAdmin && !user.adminVerified) throw new ApiError(403, 'mfa_necessario', 'Confirme o segundo fator para acessar servidores como Cosmic Admin.');
    const subject = this.subjectOf(snap, me);
    return { user, snap, me, subject, base: basePermissions(subject, snap.roles) };
  }

  /** Quem é esta pessoa neste grupo e o que ela pode nele. A Central de Bots usa para aplicar as próprias permissões. */
  async access(user: User, groupId: string): Promise<{ snap: Snapshot; me: Member; subject: Subject; base: bigint }> {
    return this.#ctx(user, groupId);
  }

  #need(ctx: Ctx, permission: bigint, set = ctx.base): void {
    if (ctx.subject.isCosmicAdmin && !ctx.user.adminVerified) throw new ApiError(403, 'mfa_necessario', 'Confirme o segundo fator em Administração Cosmic.');
    if (!has(set, permission)) {
      throw new ApiError(403, 'sem_permissao', `Você não tem a permissão “${permissionName(permission)}”.`);
    }
  }

  async #channelCtx(user: User, channelId: string): Promise<{ ctx: Ctx; channel: Channel; perms: bigint }> {
    let groupId = this.#channelGroup.get(channelId);
    if (!groupId) {
      const [row] = await this.#db.query('SELECT group_id FROM channels WHERE id = $1', [channelId]);
      if (!row) throw NO_CHANNEL();
      groupId = String(row.group_id);
    }
    let ctx: Ctx;
    try {
      ctx = await this.#ctx(user, groupId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw NO_CHANNEL();
      throw error;
    }
    const channel = ctx.snap.channels.get(channelId);
    if (!channel) throw NO_CHANNEL();
    const perms = this.permissionsIn(ctx.snap, ctx.subject, channel);
    // Canal que a pessoa não pode ver "não existe" para ela.
    if (!has(perms, P.VIEW_CHANNEL)) throw NO_CHANNEL();
    return { ctx, channel, perms };
  }

  #targetMember(ctx: Ctx, userId: string): { member: Member; subject: Subject } {
    const member = ctx.snap.members.get(userId);
    if (!member) throw new ApiError(404, 'membro_inexistente', 'Essa pessoa não é membro do grupo.');
    return { member, subject: this.subjectOf(ctx.snap, member) };
  }

  #needRank(ctx: Ctx, target: Subject): void {
    if (!canActOnMember(ctx.subject, target, ctx.snap.roles)) {
      throw new ApiError(403, 'hierarquia', 'Você só pode fazer isso com membros que estão abaixo do seu cargo mais alto.');
    }
  }

  async #audit(db: Db, ctx: Ctx, action: string, target: { kind: string; id: string; name: string }, detail: Record<string, unknown> = {}): Promise<void> {
    if (ctx.subject.isCosmicAdmin) {
      if (!ctx.user.adminVerified) throw new ApiError(403, 'mfa_necessario', 'Confirme o segundo fator.');
      detail = { ...detail, cosmicAdmin: true };
      await adminAudit(db, ctx.user.id, action, target.id, 'Ação administrativa global em servidor', { groupId: ctx.snap.group.id, ...detail });
    }
    await db.query(
      `INSERT INTO audit_log (group_id, actor_id, actor_name, action, target_kind, target_id, target_name, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [ctx.snap.group.id, ctx.user.id, ctx.user.displayName, action, target.kind, target.id, target.name, JSON.stringify(detail)],
    );
  }

  // --- Grupos -----------------------------------------------------------------------------

  /** Os grupos da pessoa, cada um dizendo se tem novidade para ela (respeitando o que ela silenciou). */
  async myGroups(user: User): Promise<(Group & { unread: boolean; mentions: number; notify: { level: NotifyLevel; channels: Record<string, NotifyLevel> } })[]> {
    const rows = await this.#db.query('SELECT g.* FROM groups g JOIN members m ON m.group_id = g.id WHERE m.user_id = $1 ORDER BY m.joined_at', [user.id]);
    const list = rows.map(toGroup);
    const [unread, notify] = await Promise.all([this.#unread(user.id, list.map((group) => group.id)), this.#notify(user.id)]);
    return Promise.all(
      list.map(async (group) => {
        const snap = await this.snapshot(group.id);
        const me = snap.members.get(user.id);
        const settings = notify.get(group.id) ?? { level: 'tudo' as NotifyLevel, channels: {} };
        let lit = false;
        let mentions = 0;
        for (const [channelId, state] of unread.get(group.id) ?? []) {
          const channel = snap.channels.get(channelId);
          if (!me || !channel || !has(this.permissionsIn(snap, this.subjectOf(snap, me), channel), P.VIEW_CHANNEL)) continue;
          const level = settings.channels[channelId] ?? settings.level;
          if (level === 'nada') continue;
          mentions += state.mentions;
          if (state.mentions > 0 || (level === 'tudo' && Number(state.last ?? 0) > Number(state.read ?? 0))) lit = true;
        }
        return { ...group, unread: lit, mentions, notify: settings };
      }),
    );
  }

  /** Por grupo e canal de texto: última mensagem, até onde a pessoa leu e menções pendentes. */
  async #unread(userId: string, groupIds: readonly string[]): Promise<Map<string, Map<string, UnreadState>>> {
    const result = new Map<string, Map<string, UnreadState>>();
    if (groupIds.length === 0) return result;
    const rows = await this.#db.query(
      `SELECT c.id, c.group_id, r.last_read_id AS read,
              (SELECT max(m.id) FROM messages m WHERE m.channel_id = c.id) AS last,
              (SELECT count(*) FROM messages m
                WHERE m.channel_id = c.id AND m.id > coalesce(r.last_read_id, 0) AND m.author_id IS DISTINCT FROM $1
                  AND (m.mention_everyone OR m.mentions @> $2::jsonb)) AS mentions,
              (SELECT count(*) FROM (SELECT 1 FROM messages m
                WHERE m.channel_id = c.id AND m.id > coalesce(r.last_read_id, 0) AND m.author_id IS DISTINCT FROM $1 LIMIT 100) AS novas) AS fresh
         FROM channels c LEFT JOIN read_states r ON r.channel_id = c.id AND r.user_id = $1
        WHERE c.group_id = ANY($3::text[]) AND c.kind IN ('texto', 'voz')`,
      [userId, JSON.stringify([userId]), groupIds],
    );
    for (const row of rows) {
      const groupId = String(row.group_id);
      if (!result.has(groupId)) result.set(groupId, new Map());
      result.get(groupId)!.set(String(row.id), {
        last: row.last === null || row.last === undefined ? null : String(row.last),
        read: row.read === null || row.read === undefined ? null : String(row.read),
        mentions: num(row.mentions),
        count: num(row.fresh),
      });
    }
    return result;
  }

  /** O que a pessoa escolheu de notificação, por grupo. */
  async #notify(userId: string, groupId?: string): Promise<Map<string, { level: NotifyLevel; channels: Record<string, NotifyLevel> }>> {
    const rows = await this.#db.query('SELECT group_id, channel_id, level FROM notify_settings WHERE user_id = $1 AND ($2::text IS NULL OR group_id = $2)', [userId, groupId ?? null]);
    const result = new Map<string, { level: NotifyLevel; channels: Record<string, NotifyLevel> }>();
    for (const row of rows) {
      const id = String(row.group_id);
      if (!result.has(id)) result.set(id, { level: 'tudo', channels: {} });
      const entry = result.get(id)!;
      if (row.channel_id === '') entry.level = String(row.level) as NotifyLevel;
      else entry.channels[String(row.channel_id)] = String(row.level) as NotifyLevel;
    }
    return result;
  }

  async setNotify(user: User, groupId: string, input: Record<string, unknown>): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    const level = input.level;
    if (level !== null && !NOTIFY_LEVELS.includes(level as NotifyLevel)) {
      throw new ApiError(400, 'nivel_invalido', 'Escolha entre todas as mensagens, só menções ou nada.');
    }
    let channelId = '';
    if (input.channelId !== undefined && input.channelId !== null) {
      const channel = typeof input.channelId === 'string' ? ctx.snap.channels.get(input.channelId) : undefined;
      if (!channel || !has(this.permissionsIn(ctx.snap, ctx.subject, channel), P.VIEW_CHANNEL)) throw NO_CHANNEL();
      channelId = channel.id;
    }
    if (level === null) {
      await this.#db.query('DELETE FROM notify_settings WHERE user_id = $1 AND group_id = $2 AND channel_id = $3', [user.id, groupId, channelId]);
    } else {
      await this.#db.query(
        `INSERT INTO notify_settings (user_id, group_id, channel_id, level) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, group_id, channel_id) DO UPDATE SET level = EXCLUDED.level`,
        [user.id, groupId, channelId, level],
      );
    }
  }

  /** Marca o canal como lido até uma mensagem. Nunca volta atrás. */
  async markRead(user: User, channelId: string, messageId: unknown): Promise<void> {
    await this.#channelCtx(user, channelId);
    if (typeof messageId !== 'string' || !MESSAGE_ID.test(messageId)) throw new ApiError(400, 'mensagem_invalida', 'Informe a última mensagem lida.');
    await this.#read(this.#db, user.id, channelId, messageId);
  }

  async #read(db: Db, userId: string, channelId: string, messageId: string): Promise<void> {
    await db.query(
      `INSERT INTO read_states (user_id, channel_id, last_read_id)
       VALUES ($1, $2, LEAST($3::bigint, (SELECT coalesce(max(id), 0) FROM messages)))
       ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = GREATEST(read_states.last_read_id, EXCLUDED.last_read_id)`,
      [userId, channelId, messageId],
    );
  }

  async publicGroups(user: User, search: unknown): Promise<(Group & { memberCount: number; joined: boolean })[]> {
    const term = cleanText(search, 40).replace(/[\\%_]/g, (char) => `\\${char}`);
    const rows = await this.#db.query(
      `SELECT g.*, (SELECT count(*) FROM members m WHERE m.group_id = g.id) AS member_count,
              EXISTS (SELECT 1 FROM members m WHERE m.group_id = g.id AND m.user_id = $2) AS joined
         FROM groups g
        WHERE g.is_public AND (g.name ILIKE $1 OR g.description ILIKE $1)
          AND NOT EXISTS (SELECT 1 FROM bans b WHERE b.group_id = g.id AND b.user_id = $2)
        ORDER BY member_count DESC, g.created_at LIMIT 50`,
      [`%${term}%`, user.id],
    );
    return rows.map((row) => ({ ...toGroup(row), memberCount: num(row.member_count), joined: row.joined === true }));
  }

  async createGroup(user: User, input: Record<string, unknown>): Promise<Group> {
    const name = requiredName(input.name, 'o nome do grupo');
    const description = cleanText(input.description, LIMITS.descriptionChars);
    const icon = optionalIcon(input.icon);
    const [count] = await this.#db.query('SELECT count(*) AS total FROM members WHERE user_id = $1', [user.id]);
    if (num(count?.total) >= LIMITS.groupsPerUser) throw new ApiError(409, 'grupos_demais', `Cada conta participa de no máximo ${LIMITS.groupsPerUser} grupos.`);
    const id = newId();
    await this.#db.tx(async (tx) => {
      await tx.query('INSERT INTO groups (id, name, description, icon, is_public, owner_id) VALUES ($1, $2, $3, $4, $5, $6)', [
        id,
        name,
        description,
        icon,
        input.isPublic === true,
        user.id,
      ]);
      await tx.query("INSERT INTO members (group_id, user_id, joined_via) VALUES ($1, $2, 'criador')", [id, user.id]);
      await tx.query(`INSERT INTO roles (id, group_id, name, color, position, permissions, is_everyone) VALUES ($1, $2, '@everyone', NULL, 0, $3, true)`, [
        newId(),
        id,
        str(DEFAULT_EVERYONE),
      ]);
      // Cargos iniciais, do mais alto para o mais baixo. São cargos comuns: dá para editar e excluir.
      const starters = ROLE_TEMPLATES.filter((template) => template.name === 'Administrador' || template.name === 'Moderador');
      for (const [index, template] of starters.entries()) {
        await tx.query('INSERT INTO roles (id, group_id, name, color, position, permissions) VALUES ($1, $2, $3, $4, $5, $6)', [
          newId(),
          id,
          template.name,
          template.color,
          starters.length - index,
          str(template.permissions),
        ]);
      }
      const text = newId();
      const voice = newId();
      await tx.query(`INSERT INTO channels (id, group_id, kind, name, position) VALUES ($1, $2, 'categoria', 'Canais de texto', 0), ($3, $2, 'categoria', 'Canais de voz', 1)`, [
        text,
        id,
        voice,
      ]);
      await tx.query(
        `INSERT INTO channels (id, group_id, kind, name, parent_id, position) VALUES ($1, $2, 'texto', 'geral', $3, 0), ($4, $2, 'voz', 'Sala de voz', $5, 0)`,
        [newId(), id, text, newId(), voice],
      );
      await tx.query(
        `INSERT INTO audit_log (group_id, actor_id, actor_name, action, target_kind, target_id, target_name) VALUES ($1, $2, $3, 'grupo.criado', 'grupo', $1, $4)`,
        [id, user.id, user.displayName, name],
      );
      if (await isCosmicAdmin(tx, user.id)) await adminAudit(tx, user.id, 'grupo.criado', id, 'Criação de servidor pela administração oficial', { name });
    });
    this.hub.subscribe(user.id, id);
    return (await this.snapshot(id)).group;
  }

  /** O grupo como ESTA pessoa o vê: só os canais que ela pode ver, com as permissões dela em cada um. */
  async viewGroup(user: User, groupId: string) {
    const ctx = await this.#ctx(user, groupId);
    const { snap, subject } = ctx;
    const online = new Set(this.hub.online(groupId));
    const voice = this.hub.voiceIn(groupId);
    const counts = new Map<string, number>();
    for (const member of snap.members.values()) for (const roleId of member.roleIds) counts.set(roleId, (counts.get(roleId) ?? 0) + 1);

    const visible = new Map<string, bigint>();
    for (const channel of snap.channels.values()) {
      if (channel.kind === 'categoria') continue;
      const perms = this.permissionsIn(snap, subject, channel);
      if (has(perms, P.VIEW_CHANNEL)) visible.set(channel.id, perms);
    }
    const everyoneId = snap.everyone.id;
    const isPrivate = (channel: Channel): boolean =>
      [channel.id, channel.parentId].some((id) =>
        (id ? (snap.overrides.get(id) ?? []) : []).some((item) => item.targetKind === 'cargo' && item.targetId === everyoneId && has(item.deny, P.VIEW_CHANNEL)),
      );
    const channels = [...snap.channels.values()]
      // Categorias primeiro, cada grupo na ordem definida pelo grupo.
      .sort((a, b) => Number(a.kind !== 'categoria') - Number(b.kind !== 'categoria') || a.position - b.position || a.name.localeCompare(b.name))
      .filter((channel) => {
        if (channel.kind !== 'categoria') return visible.has(channel.id);
        // Categoria aparece se tiver algum canal visível, ou vazia para quem gerencia canais.
        const children = [...snap.channels.values()].filter((item) => item.parentId === channel.id);
        return children.some((item) => visible.has(item.id)) || (has(ctx.base, P.MANAGE_CHANNELS) && has(this.permissionsIn(snap, subject, channel), P.VIEW_CHANNEL));
      })
      .map((channel) => ({
        id: channel.id,
        kind: channel.kind,
        name: channel.name,
        topic: channel.topic,
        parentId: channel.parentId,
        position: channel.position,
        userLimit: channel.userLimit,
        temporaryChat: channel.temporaryChat,
        private: isPrivate(channel),
        permissions: str(channel.kind === 'categoria' ? this.permissionsIn(snap, subject, channel) : visible.get(channel.id)!),
      }));

    const top = topPosition(subject, snap.roles);
    const [unread, notify, botRows, emojis] = await Promise.all([
      this.#unread(user.id, [groupId]),
      this.#notify(user.id, groupId),
      this.#db.query('SELECT user_id, member_list FROM bot_installs WHERE group_id = $1', [groupId]),
      this.#emojis(groupId),
    ]);
    // Como cada bot aparece na lista de membros (aparência escolhida pelos administradores).
    const botList = Object.fromEntries(botRows.map((row) => [String(row.user_id), String(row.member_list)]));
    const settings = notify.get(groupId) ?? { level: 'tudo' as NotifyLevel, channels: {} };
    return {
      group: snap.group,
      unread: Object.fromEntries([...(unread.get(groupId) ?? [])].filter(([channelId]) => visible.has(channelId))),
      notify: { level: settings.level, channels: Object.fromEntries(Object.entries(settings.channels).filter(([channelId]) => visible.has(channelId))) },
      me: {
        userId: user.id,
        isOwner: subject.isOwner,
        isCosmicAdmin: subject.isCosmicAdmin === true,
        roleIds: [...ctx.me.roleIds],
        permissions: str(ctx.base),
        /** Posição do cargo mais alto (null para o dono, que está acima de todos). */
        top: Number.isFinite(top) ? top : null,
        timeoutUntil: ctx.me.timeoutUntil,
      },
      roles: snap.roles.map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        permissions: str(role.permissions),
        isEveryone: role.isEveryone,
        botId: role.botId,
        memberCount: role.isEveryone ? snap.members.size : (counts.get(role.id) ?? 0),
      })),
      channels,
      members: [...snap.members.values()].map((member) => ({
        userId: member.userId,
        cosmicAdmin: member.cosmicAdmin === true,
        username: member.username,
        displayName: member.displayName,
        nickname: member.nickname,
        roleIds: [...member.roleIds],
        joinedAt: member.joinedAt,
        timeoutUntil: member.timeoutUntil,
        online: online.has(member.userId) || member.bot,
        bot: member.bot,
        avatar: member.avatar,
        ...(member.bot ? { botList: botList[member.userId] ?? 'categoria' } : {}),
      })),
      voice: Object.fromEntries(Object.entries(voice).filter(([channelId]) => visible.has(channelId))),
      emojis,
    };
  }

  async updateGroup(user: User, groupId: string, input: Record<string, unknown>): Promise<Group> {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.MANAGE_GROUP);
    const before = ctx.snap.group;
    const next = {
      name: input.name === undefined ? before.name : requiredName(input.name, 'o nome do grupo'),
      description: input.description === undefined ? before.description : cleanText(input.description, LIMITS.descriptionChars),
      icon: input.icon === undefined ? before.icon : optionalIcon(input.icon),
      isPublic: typeof input.isPublic === 'boolean' ? input.isPublic : before.isPublic,
    };
    await this.#db.tx(async (tx) => {
      await tx.query('UPDATE groups SET name = $2, description = $3, icon = $4, is_public = $5 WHERE id = $1', [groupId, next.name, next.description, next.icon, next.isPublic]);
      await this.#audit(tx, ctx, 'grupo.atualizado', { kind: 'grupo', id: groupId, name: next.name }, {
        ...(next.name !== before.name ? { nome: [before.name, next.name] } : {}),
        ...(next.description !== before.description ? { descricao: [before.description, next.description] } : {}),
        ...(next.isPublic !== before.isPublic ? { publico: [before.isPublic, next.isPublic] } : {}),
        ...(next.icon !== before.icon ? { icone: 'alterado' } : {}),
      });
    });
    this.#changed(groupId);
    return (await this.snapshot(groupId)).group;
  }

  async deleteGroup(user: User, groupId: string): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    if (!ctx.subject.isOwner && !ctx.subject.isCosmicAdmin) throw new ApiError(403, 'so_o_dono', 'Só o dono pode excluir o grupo.');
    await this.#db.tx(async (tx) => {
      await this.#audit(tx, ctx, 'grupo.excluido', { kind: 'grupo', id: groupId, name: ctx.snap.group.name });
      await tx.query('DELETE FROM groups WHERE id = $1', [groupId]);
    });
    this.#cache.delete(groupId);
    this.hub.publish(groupId, { t: 'group.removed', groupId, reason: 'excluido' });
    this.hub.dropGroup(groupId);
    for (const channel of ctx.snap.channels.values()) {
      this.#channelGroup.delete(channel.id);
      if (channel.kind === 'voz') void this.#sfu.closeRoom(voiceRoom(channel.id)).catch(() => undefined);
    }
  }

  async transferOwnership(user: User, groupId: string, targetId: unknown): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    if (!ctx.subject.isOwner && !ctx.subject.isCosmicAdmin) throw new ApiError(403, 'so_o_dono', 'Só o dono pode passar o grupo para outra pessoa.');
    const { member } = this.#targetMember(ctx, String(targetId));
    this.#human(member);
    if (member.userId === user.id) return;
    await this.#db.tx(async (tx) => {
      await tx.query('UPDATE groups SET owner_id = $2 WHERE id = $1', [groupId, member.userId]);
      await this.#audit(tx, ctx, 'grupo.dono_transferido', { kind: 'membro', id: member.userId, name: member.displayName });
    });
    this.#changed(groupId);
  }

  // --- Entrar e sair ----------------------------------------------------------------------

  /** `via`: como a pessoa entrou ('publico', 'convite:<código>'); fica registrado para a moderação. */
  async #addMember(db: Db, groupId: string, user: User, via: string, invitedBy: string | null = null): Promise<void> {
    const [banned] = await db.query('SELECT 1 FROM bans WHERE group_id = $1 AND user_id = $2', [groupId, user.id]);
    if (banned) throw new ApiError(403, 'banido', 'Você foi banido deste grupo.');
    const [count] = await db.query('SELECT count(*) AS total FROM members WHERE user_id = $1', [user.id]);
    if (num(count?.total) >= LIMITS.groupsPerUser) throw new ApiError(409, 'grupos_demais', `Cada conta participa de no máximo ${LIMITS.groupsPerUser} grupos.`);
    const global = await isCosmicAdmin(db, user.id);
    const inserted = await db.query('INSERT INTO members (group_id, user_id, joined_via, invited_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING user_id', [groupId, user.id, global ? 'cosmic_admin' : via, invitedBy]);
    if (global && inserted.length) {
      await db.query("INSERT INTO audit_log (group_id,actor_id,actor_name,action,target_kind,target_id,target_name,detail) VALUES ($1,$2,$3,'cosmic_admin.entrada','membro',$2,$3,$4::jsonb)", [groupId, user.id, user.displayName, JSON.stringify({ cosmicAdmin: true, via })]);
      await adminAudit(db, user.id, 'servidor.entrada_global', groupId, 'Entrada oficial pela navegação de servidores', { via });
    }
    // Quem entra agora não recebe o histórico inteiro como "não lido".
    await db.query(
      `INSERT INTO read_states (user_id, channel_id, last_read_id)
       SELECT $2, c.id, (SELECT coalesce(max(id), 0) FROM messages) FROM channels c WHERE c.group_id = $1 AND c.kind IN ('texto', 'voz')
       ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = GREATEST(read_states.last_read_id, EXCLUDED.last_read_id)`,
      [groupId, user.id],
    );
  }

  #joined(groupId: string, user: User): void {
    this.#changed(groupId);
    this.hub.subscribe(user.id, groupId);
    this.#emit({ type: 'member.join', groupId, userId: user.id });
  }

  #human(member: Member): void {
    if (member.bot) throw new ApiError(400, 'bot_gerenciado', 'Esta conta é um bot. Para tirar ou configurar, use a Central de Bots.');
  }

  #notManaged(role: Role): void {
    if (role.botId) {
      throw new ApiError(400, 'cargo_de_bot', 'Este cargo pertence a um bot instalado e só muda pela Central de Bots. A posição dele na hierarquia você pode mudar.');
    }
  }

  async joinAsAdmin(user: User, groupId: string, reason: string): Promise<Group> {
    if (!(await isCosmicAdmin(this.#db, user.id)) || !user.adminVerified) throw new ApiError(403, 'mfa_necessario', 'Acesso global exige autenticação multifator.');
    await this.#db.tx(async (tx) => {
      const [group] = await tx.query('SELECT id FROM groups WHERE id = $1 FOR SHARE', [groupId]);
      if (!group) throw NOT_FOUND();
      await tx.query("INSERT INTO members (group_id, user_id, joined_via) VALUES ($1,$2,'cosmic_admin') ON CONFLICT (group_id,user_id) DO UPDATE SET joined_via = 'cosmic_admin', timeout_until = NULL", [groupId, user.id]);
      await tx.query('DELETE FROM bans WHERE group_id = $1 AND user_id = $2', [groupId, user.id]);
      await tx.query("INSERT INTO audit_log (group_id,actor_id,actor_name,action,target_kind,target_id,target_name,detail) VALUES ($1,$2,$3,'cosmic_admin.entrada','membro',$2,$3,$4::jsonb)", [groupId,user.id,user.displayName,JSON.stringify({ cosmicAdmin: true, reason })]);
      await adminAudit(tx, user.id, 'servidor.entrada_global', groupId, reason);
    });
    this.#joined(groupId, user);
    return (await this.snapshot(groupId)).group;
  }

  async joinPublic(user: User, groupId: string): Promise<Group> {
    const snap = await this.snapshot(groupId);
    if (snap.members.has(user.id)) return snap.group;
    if (!snap.group.isPublic) throw NOT_FOUND();
    await this.#addMember(this.#db, groupId, user, 'publico');
    this.#joined(groupId, user);
    return snap.group;
  }

  async leave(user: User, groupId: string): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    if (ctx.snap.group.ownerId === user.id) throw new ApiError(409, 'dono_nao_sai', 'O dono não pode sair do grupo. Passe o grupo para outra pessoa ou exclua-o.');
    await this.#db.tx((tx) => this.#removeMember(tx, ctx.snap, user.id));
    this.#afterRemoval(groupId, user.id, 'saiu');
  }

  async #removeMember(db: Db, snap: Snapshot, userId: string): Promise<void> {
    await db.query('DELETE FROM members WHERE group_id = $1 AND user_id = $2', [snap.group.id, userId]);
    const channelIds = [...snap.channels.keys()];
    if (channelIds.length > 0) {
      const marks = channelIds.map((_, index) => `$${index + 2}`).join(', ');
      await db.query(`DELETE FROM overrides WHERE target_kind = 'membro' AND target_id = $1 AND channel_id IN (${marks})`, [userId, ...channelIds]);
      await db.query(`DELETE FROM voice_blocks WHERE user_id = $1 AND channel_id IN (${marks})`, [userId, ...channelIds]);
    }
  }

  #afterRemoval(groupId: string, userId: string, reason: 'saiu' | 'expulso' | 'banido'): void {
    const place = this.hub.voiceOf(userId);
    if (place?.groupId === groupId) void this.#sfu.removeParticipant(voiceRoom(place.channelId), userId).catch(() => undefined);
    this.hub.toUser(userId, { t: 'group.removed', groupId, reason });
    this.hub.unsubscribe(userId, groupId);
    this.#changed(groupId);
    this.#emit({ type: 'member.leave', groupId, userId, reason });
  }

  // --- Convites ---------------------------------------------------------------------------

  async createInvite(user: User, groupId: string, input: Record<string, unknown>) {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.CREATE_INVITE);
    const maxUses = input.maxUses === undefined ? 0 : Number(input.maxUses);
    const hours = input.expiresInHours === undefined ? 24 * 7 : Number(input.expiresInHours);
    if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > 1000) throw new ApiError(400, 'usos_invalidos', 'O número de usos deve ficar entre 0 (sem limite) e 1000.');
    if (!Number.isInteger(hours) || hours < 0 || hours > 24 * 30) throw new ApiError(400, 'validade_invalida', 'A validade deve ficar entre 0 (não vence) e 720 horas.');
    const code = newId(9);
    const expires = hours === 0 ? null : new Date(Date.now() + hours * 3_600_000).toISOString();
    await this.#db.tx(async (tx) => {
      await tx.query('INSERT INTO invites (code, group_id, created_by, max_uses, expires_at) VALUES ($1, $2, $3, $4, $5)', [code, groupId, user.id, maxUses, expires]);
      await this.#audit(tx, ctx, 'convite.criado', { kind: 'convite', id: code, name: code }, { usos: maxUses, vence: expires });
    });
    return { code, maxUses, uses: 0, expiresAt: expires, createdBy: user.id };
  }

  async listInvites(user: User, groupId: string) {
    const ctx = await this.#ctx(user, groupId);
    // Quem gerencia o grupo vê todos; os demais, só os convites que criaram.
    const all = has(ctx.base, P.MANAGE_GROUP);
    if (!all) this.#need(ctx, P.CREATE_INVITE);
    const rows = await this.#db.query(
      `SELECT i.*, u.display_name FROM invites i JOIN users u ON u.id = i.created_by
        WHERE i.group_id = $1 AND ($2 OR i.created_by = $3) ORDER BY i.created_at DESC`,
      [groupId, all, user.id],
    );
    return rows.map((row) => ({
      code: String(row.code),
      maxUses: num(row.max_uses),
      uses: num(row.uses),
      expiresAt: isoOrNull(row.expires_at),
      createdBy: String(row.created_by),
      createdByName: String(row.display_name),
      createdAt: iso(row.created_at),
    }));
  }

  async revokeInvite(user: User, code: string): Promise<void> {
    const [row] = await this.#db.query('SELECT * FROM invites WHERE code = $1', [code]);
    if (!row) throw new ApiError(404, 'convite_inexistente', 'Convite não encontrado.');
    let ctx: Ctx;
    try {
      ctx = await this.#ctx(user, String(row.group_id));
    } catch {
      throw new ApiError(404, 'convite_inexistente', 'Convite não encontrado.');
    }
    if (String(row.created_by) !== user.id) this.#need(ctx, P.MANAGE_GROUP);
    await this.#db.tx(async (tx) => {
      await tx.query('DELETE FROM invites WHERE code = $1', [code]);
      await this.#audit(tx, ctx, 'convite.revogado', { kind: 'convite', id: code, name: code });
    });
  }

  async #usableInvite(db: Db, code: string): Promise<Row> {
    const [row] = await db.query('SELECT * FROM invites WHERE code = $1', [code]);
    const expired = row && row.expires_at !== null && new Date(String(row.expires_at)).getTime() <= Date.now();
    const spent = row && num(row.max_uses) > 0 && num(row.uses) >= num(row.max_uses);
    if (!row || expired || spent) throw new ApiError(404, 'convite_invalido', 'Este convite não existe, venceu ou já foi usado o máximo de vezes.');
    return row;
  }

  /**
   * O que um convite mostra antes de aceitar: nome, ícone, descrição e tamanho do grupo, e a validade. Funciona
   * sem conta (quem recebe o link vê para onde vai antes de criar uma). Nada de membros, canais ou mensagens.
   */
  async previewInvite(user: User | null, code: string) {
    const row = await this.#usableInvite(this.#db, code);
    const snap = await this.snapshot(String(row.group_id));
    const { id, name, description, icon } = snap.group;
    return {
      code,
      group: { id, name, description, icon, memberCount: snap.members.size },
      joined: user ? snap.members.has(user.id) : false,
      invite: {
        expiresAt: row.expires_at === null ? null : new Date(String(row.expires_at)).toISOString(),
        maxUses: num(row.max_uses),
        uses: num(row.uses),
      },
    };
  }

  async acceptInvite(user: User, code: string): Promise<Group> {
    const groupId = await this.#db.tx(async (tx) => {
      // FOR UPDATE: dois aceites simultâneos não passam do limite de usos.
      const [locked] = await tx.query('SELECT group_id FROM invites WHERE code = $1 FOR UPDATE', [code]);
      // Quem já é do grupo só é levado até ele: não gasta um uso, nem esbarra em convite vencido.
      const [already] = locked ? await tx.query('SELECT 1 FROM members WHERE group_id = $1 AND user_id = $2', [String(locked.group_id), user.id]) : [];
      if (locked && already) return String(locked.group_id);
      const row = await this.#usableInvite(tx, code);
      const id = String(row.group_id);
      await this.#addMember(tx, id, user, `convite:${code}`, String(row.created_by));
      await tx.query('UPDATE invites SET uses = uses + 1 WHERE code = $1', [code]);
      return id;
    });
    this.#joined(groupId, user);
    return (await this.snapshot(groupId)).group;
  }

  // --- Membros ----------------------------------------------------------------------------

  async setNickname(user: User, groupId: string, value: unknown): Promise<void> {
    await this.#ctx(user, groupId);
    const nickname = cleanText(value, 32) || null;
    await this.#db.query('UPDATE members SET nickname = $3 WHERE group_id = $1 AND user_id = $2', [groupId, user.id, nickname]);
    this.#changed(groupId);
  }

  /**
   * Define os cargos de um membro. Cada cargo dado ou tirado precisa estar abaixo do cargo mais alto de quem
   * mexe, e ninguém entrega um cargo com permissões que não tem: é o que fecha o caminho do autopromover-se.
   */
  async setMemberRoles(user: User, groupId: string, targetId: string, roleIds: unknown): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.MANAGE_ROLES);
    const { member, subject } = this.#targetMember(ctx, targetId);
    this.#human(member);
    if (member.userId !== user.id) this.#needRank(ctx, subject);
    if (!Array.isArray(roleIds) || roleIds.some((id) => typeof id !== 'string')) throw new ApiError(400, 'cargos_invalidos', 'Informe a lista de cargos.');
    const wanted = new Set(roleIds as string[]);
    const byId = new Map(ctx.snap.roles.map((role) => [role.id, role]));
    const added = [...wanted].filter((id) => !member.roleIds.has(id));
    const removed = [...member.roleIds].filter((id) => !wanted.has(id));
    for (const id of [...added, ...removed]) {
      const role = byId.get(id);
      if (!role || role.isEveryone) throw new ApiError(400, 'cargo_inexistente', 'Um dos cargos não existe neste grupo.');
      this.#notManaged(role);
      if (!canManageRole(ctx.subject, ctx.snap.roles, role)) {
        throw new ApiError(403, 'hierarquia', `O cargo “${role.name}” não está abaixo do seu cargo mais alto.`);
      }
    }
    for (const id of added) {
      const role = byId.get(id)!;
      if ((role.permissions & ~ctx.base) !== 0n) {
        throw new ApiError(403, 'escalonamento', `O cargo “${role.name}” tem permissões que você não tem, então você não pode entregá-lo.`);
      }
    }
    if (added.length === 0 && removed.length === 0) return;
    await this.#db.tx(async (tx) => {
      for (const id of removed) await tx.query('DELETE FROM member_roles WHERE group_id = $1 AND user_id = $2 AND role_id = $3', [groupId, targetId, id]);
      for (const id of added) await tx.query('INSERT INTO member_roles (group_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [groupId, targetId, id]);
      await this.#audit(tx, ctx, 'membro.cargos', { kind: 'membro', id: targetId, name: member.displayName }, {
        adicionados: added.map((id) => byId.get(id)!.name),
        removidos: removed.map((id) => byId.get(id)!.name),
      });
    });
    this.#changed(groupId);
    await this.#syncVoiceRights(groupId, targetId);
    this.#emit({ type: 'member.roles', groupId, userId: targetId, added, removed });
  }

  async kick(user: User, groupId: string, targetId: string, reason?: unknown): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.KICK_MEMBERS);
    const { member, subject } = this.#targetMember(ctx, targetId);
    this.#human(member);
    this.#needRank(ctx, subject);
    await this.#db.tx(async (tx) => {
      await this.#removeMember(tx, ctx.snap, targetId);
      await this.#audit(tx, ctx, 'membro.expulso', { kind: 'membro', id: targetId, name: member.displayName }, { motivo: cleanText(reason, 200) });
    });
    this.#afterRemoval(groupId, targetId, 'expulso');
  }

  async ban(user: User, groupId: string, targetId: string, reason?: unknown): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.BAN_MEMBERS);
    const { member, subject } = this.#targetMember(ctx, targetId);
    this.#human(member);
    this.#needRank(ctx, subject);
    const why = cleanText(reason, 200);
    await this.#db.tx(async (tx) => {
      await this.#removeMember(tx, ctx.snap, targetId);
      await tx.query('INSERT INTO bans (group_id, user_id, banned_by, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (group_id, user_id) DO UPDATE SET reason = $4', [groupId, targetId, user.id, why]);
      await this.#audit(tx, ctx, 'membro.banido', { kind: 'membro', id: targetId, name: member.displayName }, { motivo: why });
    });
    this.#afterRemoval(groupId, targetId, 'banido');
  }

  async unban(user: User, groupId: string, targetId: string): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.BAN_MEMBERS);
    const [row] = await this.#db.query('SELECT u.display_name FROM bans b JOIN users u ON u.id = b.user_id WHERE b.group_id = $1 AND b.user_id = $2', [groupId, targetId]);
    if (!row) throw new ApiError(404, 'banimento_inexistente', 'Essa pessoa não está banida.');
    await this.#db.tx(async (tx) => {
      await tx.query('DELETE FROM bans WHERE group_id = $1 AND user_id = $2', [groupId, targetId]);
      await this.#audit(tx, ctx, 'membro.desbanido', { kind: 'membro', id: targetId, name: String(row.display_name) });
    });
  }

  async listBans(user: User, groupId: string) {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.BAN_MEMBERS);
    const rows = await this.#db.query(
      'SELECT b.*, u.display_name, u.username FROM bans b JOIN users u ON u.id = b.user_id WHERE b.group_id = $1 ORDER BY b.created_at DESC',
      [groupId],
    );
    return rows.map((row) => ({ userId: String(row.user_id), displayName: String(row.display_name), username: String(row.username), reason: String(row.reason), createdAt: iso(row.created_at) }));
  }

  /** Castigo (timeout): por um tempo a pessoa lê, mas não escreve, não fala e não transmite. 0 minutos desfaz. */
  async timeout(user: User, groupId: string, targetId: string, minutes: unknown): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.KICK_MEMBERS);
    const { member, subject } = this.#targetMember(ctx, targetId);
    this.#human(member);
    this.#needRank(ctx, subject);
    const amount = Number(minutes);
    if (!Number.isFinite(amount) || amount < 0 || amount > 60 * 24 * 28) throw new ApiError(400, 'tempo_invalido', 'O castigo vai de 0 (desfazer) a 28 dias.');
    const until = amount === 0 ? null : new Date(Date.now() + amount * 60_000).toISOString();
    await this.#db.tx(async (tx) => {
      await tx.query('UPDATE members SET timeout_until = $3 WHERE group_id = $1 AND user_id = $2', [groupId, targetId, until]);
      await this.#audit(tx, ctx, 'membro.castigo', { kind: 'membro', id: targetId, name: member.displayName }, { ate: until });
    });
    this.#changed(groupId);
    await this.#syncVoiceRights(groupId, targetId);
  }

  /** Permissões efetivas de um membro: no grupo e em cada canal, já com cargos e regras por canal aplicados. */
  async effectivePermissions(user: User, groupId: string, targetId: string) {
    const ctx = await this.#ctx(user, groupId);
    if (targetId !== user.id) this.#need(ctx, P.MANAGE_ROLES);
    const { subject } = this.#targetMember(ctx, targetId);
    const channels: Record<string, string> = {};
    for (const channel of ctx.snap.channels.values()) {
      // Só entram canais que quem pergunta também pode ver.
      if (has(this.permissionsIn(ctx.snap, ctx.subject, channel), P.VIEW_CHANNEL)) channels[channel.id] = str(this.permissionsIn(ctx.snap, subject, channel));
    }
    return { userId: targetId, isOwner: subject.isOwner, isCosmicAdmin: subject.isCosmicAdmin === true, timedOut: subject.timedOut === true, base: str(basePermissions(subject, ctx.snap.roles)), channels };
  }

  // --- Cargos -----------------------------------------------------------------------------

  #role(ctx: Ctx, roleId: string): Role {
    const role = ctx.snap.roles.find((item) => item.id === roleId);
    if (!role) throw new ApiError(404, 'cargo_inexistente', 'Cargo não encontrado.');
    return role;
  }

  #manageable(ctx: Ctx, role: Role): void {
    if (!canManageRole(ctx.subject, ctx.snap.roles, role)) {
      throw new ApiError(403, 'hierarquia', `Você só pode mexer em cargos abaixo do seu cargo mais alto. “${role.name}” não está abaixo.`);
    }
  }

  #checkGrant(ctx: Ctx, before: bigint, after: bigint, set = ctx.base): void {
    const blocked = forbiddenChanges(set, before, after);
    if (blocked !== 0n) {
      const names = PERMISSIONS.filter((item) => has(blocked, 1n << BigInt(item.bit))).map((item) => `“${item.name}”`);
      throw new ApiError(403, 'escalonamento', `Você não pode ligar nem desligar permissões que não tem: ${names.join(', ')}.`);
    }
  }

  async #groupOfRole(roleId: string): Promise<string> {
    const [row] = await this.#db.query('SELECT group_id FROM roles WHERE id = $1', [roleId]);
    if (!row) throw new ApiError(404, 'cargo_inexistente', 'Cargo não encontrado.');
    return String(row.group_id);
  }

  async createRole(user: User, groupId: string, input: Record<string, unknown>): Promise<string> {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.MANAGE_ROLES);
    if (ctx.snap.roles.length >= LIMITS.rolesPerGroup) throw new ApiError(409, 'cargos_demais', `Um grupo tem no máximo ${LIMITS.rolesPerGroup} cargos.`);
    let name = cleanText(input.name, LIMITS.nameChars) || 'novo cargo';
    let color = optionalColor(input.color);
    let permissions = input.permissions === undefined ? ctx.snap.everyone.permissions & ctx.base : parsePermissions(input.permissions);
    if (typeof input.copyFrom === 'string') {
      // Duplicar: mesma cor e mesmas permissões, desde que quem duplica as tenha.
      const source = this.#role(ctx, input.copyFrom);
      name = cleanText(input.name, LIMITS.nameChars) || `${source.name} (cópia)`.slice(0, LIMITS.nameChars);
      color = input.color === undefined ? source.color : color;
      permissions = source.permissions;
    }
    if (permissions === null) throw new ApiError(400, 'permissoes_invalidas', 'Conjunto de permissões inválido.');
    this.#checkGrant(ctx, 0n, permissions);
    const id = newId();
    await this.#db.tx(async (tx) => {
      // Cargo novo nasce no pé da lista, logo acima do @everyone.
      await tx.query('UPDATE roles SET position = position + 1 WHERE group_id = $1 AND NOT is_everyone', [groupId]);
      await tx.query('INSERT INTO roles (id, group_id, name, color, position, permissions) VALUES ($1, $2, $3, $4, 1, $5)', [id, groupId, name, color, str(permissions!)]);
      await this.#audit(tx, ctx, 'cargo.criado', { kind: 'cargo', id, name }, { permissoes: str(permissions!) });
    });
    this.#changed(groupId);
    return id;
  }

  async updateRole(user: User, roleId: string, input: Record<string, unknown>): Promise<void> {
    const ctx = await this.#ctx(user, await this.#groupOfRole(roleId));
    this.#need(ctx, P.MANAGE_ROLES);
    const role = this.#role(ctx, roleId);
    this.#notManaged(role);
    this.#manageable(ctx, role);
    const name = input.name === undefined || role.isEveryone ? role.name : requiredName(input.name, 'o nome do cargo');
    const color = input.color === undefined || role.isEveryone ? role.color : optionalColor(input.color);
    let permissions = role.permissions;
    if (input.permissions !== undefined) {
      const parsed = parsePermissions(input.permissions);
      if (parsed === null) throw new ApiError(400, 'permissoes_invalidas', 'Conjunto de permissões inválido.');
      this.#checkGrant(ctx, role.permissions, parsed);
      permissions = parsed;
    }
    await this.#db.tx(async (tx) => {
      await tx.query('UPDATE roles SET name = $2, color = $3, permissions = $4 WHERE id = $1', [roleId, name, color, str(permissions)]);
      await this.#audit(tx, ctx, 'cargo.atualizado', { kind: 'cargo', id: roleId, name }, {
        ...(name !== role.name ? { nome: [role.name, name] } : {}),
        ...(color !== role.color ? { cor: [role.color, color] } : {}),
        ...(permissions !== role.permissions ? { permissoes: [str(role.permissions), str(permissions)] } : {}),
      });
    });
    this.#changed(ctx.snap.group.id);
    await this.#syncVoiceRights(ctx.snap.group.id);
  }

  async deleteRole(user: User, roleId: string): Promise<void> {
    const ctx = await this.#ctx(user, await this.#groupOfRole(roleId));
    this.#need(ctx, P.MANAGE_ROLES);
    const role = this.#role(ctx, roleId);
    this.#notManaged(role);
    if (role.isEveryone) throw new ApiError(400, 'everyone_fixo', 'O cargo @everyone não pode ser excluído.');
    this.#manageable(ctx, role);
    const groupId = ctx.snap.group.id;
    await this.#db.tx(async (tx) => {
      await tx.query('DELETE FROM roles WHERE id = $1', [roleId]);
      await tx.query(`DELETE FROM overrides WHERE target_kind = 'cargo' AND target_id = $1`, [roleId]);
      await tx.query('UPDATE roles SET position = position - 1 WHERE group_id = $1 AND position > $2', [groupId, role.position]);
      await this.#audit(tx, ctx, 'cargo.excluido', { kind: 'cargo', id: roleId, name: role.name });
    });
    this.#changed(groupId);
    await this.#syncVoiceRights(groupId);
  }

  /** Nova ordem dos cargos, do mais alto para o mais baixo (sem o @everyone, que é sempre o último). */
  async reorderRoles(user: User, groupId: string, order: unknown): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.MANAGE_ROLES);
    const movable = ctx.snap.roles.filter((role) => !role.isEveryone);
    if (!Array.isArray(order) || order.length !== movable.length || new Set(order).size !== order.length || order.some((id) => !movable.some((role) => role.id === id))) {
      throw new ApiError(400, 'ordem_invalida', 'A ordem precisa conter todos os cargos do grupo, uma vez cada.');
    }
    const next = new Map((order as string[]).map((id, index) => [id, order.length - index]));
    for (const role of movable) {
      // Cargo igual ou acima do seu fica exatamente onde está; os de baixo só se mexem entre si.
      if (next.get(role.id) !== role.position && !canManageRole(ctx.subject, ctx.snap.roles, role)) {
        throw new ApiError(403, 'hierarquia', 'Você só pode reordenar cargos que estão abaixo do seu cargo mais alto.');
      }
    }
    await this.#db.tx(async (tx) => {
      for (const [id, position] of next) await tx.query('UPDATE roles SET position = $2 WHERE id = $1 AND group_id = $3', [id, position, groupId]);
      await this.#audit(tx, ctx, 'cargo.reordenado', { kind: 'grupo', id: groupId, name: ctx.snap.group.name }, {
        ordem: (order as string[]).map((id) => movable.find((role) => role.id === id)!.name),
      });
    });
    this.#changed(groupId);
  }

  // --- Canais -----------------------------------------------------------------------------

  async createChannel(user: User, groupId: string, input: Record<string, unknown>): Promise<string> {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.MANAGE_CHANNELS);
    if (ctx.snap.channels.size >= LIMITS.channelsPerGroup) throw new ApiError(409, 'canais_demais', `Um grupo tem no máximo ${LIMITS.channelsPerGroup} canais.`);
    const kind = input.kind;
    if (kind !== 'categoria' && kind !== 'texto' && kind !== 'voz') throw new ApiError(400, 'tipo_invalido', 'O canal deve ser de texto, de voz ou uma categoria.');
    const name = requiredName(input.name, 'o nome do canal');
    const parentId = this.#parent(ctx, kind, input.parentId);
    const userLimit = this.#userLimit(kind, input.userLimit);
    const temporaryChat = kind === 'voz' && input.temporaryChat === true;
    // Quem pode ver (e entrar) num canal privado, escolhido já na criação. Só membros e cargos deste grupo.
    const pick = (value: unknown, valid: (id: string) => boolean): string[] =>
      Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && valid(item)))].slice(0, 100) : [];
    const allowMembers = input.private === true ? pick(input.allowMembers, (id) => ctx.snap.members.has(id) && id !== user.id) : [];
    const allowRoles = input.private === true ? pick(input.allowRoles, (id) => ctx.snap.roles.some((role) => role.id === id) && id !== ctx.snap.everyone.id) : [];
    const id = newId();
    const siblings = [...ctx.snap.channels.values()].filter((channel) => channel.parentId === parentId && (channel.kind === 'categoria') === (kind === 'categoria'));
    const position = siblings.reduce((max, channel) => Math.max(max, channel.position + 1), 0);
    await this.#db.tx(async (tx) => {
      await tx.query('INSERT INTO channels (id, group_id, kind, name, topic, parent_id, position, user_limit, temporary_chat) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
        id,
        groupId,
        kind,
        name,
        cleanText(input.topic, LIMITS.topicChars),
        parentId,
        position,
        userLimit,
        temporaryChat,
      ]);
      if (input.private === true) {
        // Canal privado: escondido do @everyone e liberado para quem criou. Outros cargos entram pelas regras do canal.
        const hide = P.VIEW_CHANNEL | P.CONNECT;
        await tx.query(`INSERT INTO overrides (channel_id, target_kind, target_id, allow, deny) VALUES ($1, 'cargo', $2, 0, $3), ($1, 'membro', $4, $3, 0)`, [
          id,
          ctx.snap.everyone.id,
          str(hide),
          user.id,
        ]);
        // As pessoas e os cargos escolhidos ganham só "ver" e "conectar"; o resto continua vindo dos cargos.
        for (const memberId of allowMembers) {
          await tx.query(`INSERT INTO overrides (channel_id, target_kind, target_id, allow, deny) VALUES ($1, 'membro', $2, $3, 0)`, [id, memberId, str(hide)]);
        }
        for (const roleId of allowRoles) {
          await tx.query(`INSERT INTO overrides (channel_id, target_kind, target_id, allow, deny) VALUES ($1, 'cargo', $2, $3, 0)`, [id, roleId, str(hide)]);
        }
      }
      if (kind === 'texto' || kind === 'voz') {
        // Ninguém começa com o canal novo cheio de "não lidas".
        await tx.query(
          `INSERT INTO read_states (user_id, channel_id, last_read_id)
           SELECT m.user_id, $2, (SELECT coalesce(max(id), 0) FROM messages) FROM members m WHERE m.group_id = $1
           ON CONFLICT DO NOTHING`,
          [groupId, id],
        );
      }
      await this.#audit(tx, ctx, 'canal.criado', { kind: 'canal', id, name }, {
        tipo: kind,
        privado: input.private === true,
        ...(allowMembers.length > 0 ? { pessoas: allowMembers.length } : {}),
        ...(allowRoles.length > 0 ? { cargos: allowRoles.length } : {}),
        ...(temporaryChat ? { chat_temporario: true } : {}),
      });
    });
    this.#channelGroup.set(id, groupId);
    this.#changed(groupId);
    return id;
  }

  #parent(ctx: Ctx, kind: ChannelKind, value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    const parent = typeof value === 'string' ? ctx.snap.channels.get(value) : undefined;
    if (kind === 'categoria' || !parent || parent.kind !== 'categoria') throw new ApiError(400, 'categoria_invalida', 'A categoria escolhida não existe.');
    if (!has(this.permissionsIn(ctx.snap, ctx.subject, parent), P.VIEW_CHANNEL)) throw new ApiError(400, 'categoria_invalida', 'A categoria escolhida não existe.');
    return parent.id;
  }

  #userLimit(kind: ChannelKind, value: unknown): number {
    if (kind !== 'voz' || value === undefined || value === null) return 0;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 0 || limit > LIMITS.voiceUsers) throw new ApiError(400, 'limite_invalido', `O limite de pessoas vai de 0 (sem limite) a ${LIMITS.voiceUsers}.`);
    return limit;
  }

  async updateChannel(user: User, channelId: string, input: Record<string, unknown>): Promise<void> {
    const { ctx, channel } = await this.#channelCtx(user, channelId);
    this.#need(ctx, P.MANAGE_CHANNELS);
    const name = input.name === undefined ? channel.name : requiredName(input.name, 'o nome do canal');
    const topic = input.topic === undefined ? channel.topic : cleanText(input.topic, LIMITS.topicChars);
    const parentId = input.parentId === undefined ? channel.parentId : this.#parent(ctx, channel.kind, input.parentId);
    const userLimit = input.userLimit === undefined ? channel.userLimit : this.#userLimit(channel.kind, input.userLimit);
    const temporaryChat = channel.kind === 'voz' && input.temporaryChat !== undefined ? input.temporaryChat === true : channel.temporaryChat;
    await this.#db.tx(async (tx) => {
      await tx.query('UPDATE channels SET name = $2, topic = $3, parent_id = $4, user_limit = $5, temporary_chat = $6 WHERE id = $1', [channelId, name, topic, parentId, userLimit, temporaryChat]);
      await this.#audit(tx, ctx, 'canal.atualizado', { kind: 'canal', id: channelId, name }, {
        ...(name !== channel.name ? { nome: [channel.name, name] } : {}),
        ...(topic !== channel.topic ? { assunto: [channel.topic, topic] } : {}),
        ...(parentId !== channel.parentId ? { categoria: [channel.parentId, parentId] } : {}),
        ...(userLimit !== channel.userLimit ? { limite: [channel.userLimit, userLimit] } : {}),
        ...(temporaryChat !== channel.temporaryChat ? { chat_temporario: temporaryChat } : {}),
      });
    });
    this.#changed(ctx.snap.group.id);
  }

  async deleteChannel(user: User, channelId: string): Promise<void> {
    const { ctx, channel } = await this.#channelCtx(user, channelId);
    this.#need(ctx, P.MANAGE_CHANNELS);
    await this.#db.tx(async (tx) => {
      await tx.query('DELETE FROM channels WHERE id = $1', [channelId]);
      await this.#audit(tx, ctx, 'canal.excluido', { kind: 'canal', id: channelId, name: channel.name }, { tipo: channel.kind });
    });
    this.#channelGroup.delete(channelId);
    if (channel.kind === 'voz') void this.#sfu.closeRoom(voiceRoom(channelId)).catch(() => undefined);
    this.#changed(ctx.snap.group.id);
  }

  /** Reorganiza canais: cada item diz em que categoria fica e em que posição. Só vale para canais que a pessoa vê. */
  async reorderChannels(user: User, groupId: string, items: unknown): Promise<void> {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.MANAGE_CHANNELS);
    if (!Array.isArray(items) || items.length === 0 || items.length > LIMITS.channelsPerGroup) throw new ApiError(400, 'ordem_invalida', 'Informe os canais a reorganizar.');
    const moves: { channel: Channel; parentId: string | null; position: number }[] = [];
    for (const raw of items as Record<string, unknown>[]) {
      const channel = typeof raw?.id === 'string' ? ctx.snap.channels.get(raw.id) : undefined;
      const position = Number(raw?.position);
      if (!channel || !Number.isInteger(position) || position < 0 || position > 10_000 || !has(this.permissionsIn(ctx.snap, ctx.subject, channel), P.VIEW_CHANNEL)) {
        throw new ApiError(400, 'ordem_invalida', 'Um dos canais não existe ou a posição é inválida.');
      }
      moves.push({ channel, position, parentId: raw.parentId === undefined ? channel.parentId : this.#parent(ctx, channel.kind, raw.parentId) });
    }
    await this.#db.tx(async (tx) => {
      for (const move of moves) await tx.query('UPDATE channels SET parent_id = $2, position = $3 WHERE id = $1', [move.channel.id, move.parentId, move.position]);
      await this.#audit(tx, ctx, 'canal.reordenado', { kind: 'grupo', id: groupId, name: ctx.snap.group.name }, { canais: moves.length });
    });
    this.#changed(groupId);
  }

  async listOverrides(user: User, channelId: string) {
    const { ctx } = await this.#channelCtx(user, channelId);
    this.#need(ctx, P.MANAGE_ROLES);
    return (ctx.snap.overrides.get(channelId) ?? []).map((item) => ({ targetKind: item.targetKind, targetId: item.targetId, allow: str(item.allow), deny: str(item.deny) }));
  }

  /**
   * Regra de um cargo ou de um membro num canal: o que é permitido, o que é negado, e o resto herda.
   * `allow` e `deny` vazios apagam a regra (tudo volta a herdar).
   */
  async setOverride(user: User, channelId: string, targetKind: unknown, targetId: unknown, input: Record<string, unknown>): Promise<void> {
    const { ctx, channel, perms } = await this.#channelCtx(user, channelId);
    this.#need(ctx, P.MANAGE_ROLES);
    if ((targetKind !== 'cargo' && targetKind !== 'membro') || typeof targetId !== 'string') throw new ApiError(400, 'alvo_invalido', 'A regra deve ser de um cargo ou de um membro.');
    let targetName: string;
    if (targetKind === 'cargo') {
      const role = this.#role(ctx, targetId);
      this.#manageable(ctx, role);
      targetName = role.name;
    } else {
      const { member, subject } = this.#targetMember(ctx, targetId);
      if (member.userId !== user.id) this.#needRank(ctx, subject);
      targetName = member.displayName;
    }
    const allow = parsePermissions(input.allow ?? '0');
    const deny = parsePermissions(input.deny ?? '0');
    if (allow === null || deny === null || (allow & deny) !== 0n || ((allow | deny) & ~CHANNEL_SCOPED) !== 0n) {
      throw new ApiError(400, 'permissoes_invalidas', 'Regra inválida: uma permissão não pode ser permitida e negada ao mesmo tempo, e permissões do grupo inteiro não entram em regras de canal.');
    }
    const before = (ctx.snap.overrides.get(channelId) ?? []).find((item) => item.targetKind === targetKind && item.targetId === targetId);
    // Ninguém mexe, numa regra de canal, em permissão que não tem nesse canal.
    this.#checkGrant(ctx, before?.allow ?? 0n, allow, perms);
    this.#checkGrant(ctx, before?.deny ?? 0n, deny, perms);
    await this.#db.tx(async (tx) => {
      if (allow === 0n && deny === 0n) {
        await tx.query('DELETE FROM overrides WHERE channel_id = $1 AND target_kind = $2 AND target_id = $3', [channelId, targetKind, targetId]);
      } else {
        await tx.query(
          `INSERT INTO overrides (channel_id, target_kind, target_id, allow, deny) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (channel_id, target_kind, target_id) DO UPDATE SET allow = $4, deny = $5`,
          [channelId, targetKind, targetId, str(allow), str(deny)],
        );
      }
      await this.#audit(tx, ctx, 'canal.permissoes', { kind: 'canal', id: channelId, name: channel.name }, {
        alvo: `${targetKind === 'cargo' ? 'cargo' : 'membro'} ${targetName}`,
        permitir: [str(before?.allow ?? 0n), str(allow)],
        negar: [str(before?.deny ?? 0n), str(deny)],
      });
    });
    this.#changed(ctx.snap.group.id);
    await this.#syncVoiceRights(ctx.snap.group.id);
  }

  // --- Mensagens --------------------------------------------------------------------------

  async listMessages(user: User, channelId: string, options: { before?: unknown; limit?: unknown; pinned?: boolean } = {}): Promise<Message[]> {
    const { channel } = await this.#channelCtx(user, channelId);
    if (channel.kind === 'categoria') throw new ApiError(400, 'nao_e_texto', 'Categorias não têm mensagens.');
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
    const before = typeof options.before === 'string' && MESSAGE_ID.test(options.before) ? options.before : null;
    const rows = await this.#db.query(
      `${MESSAGE_SELECT} WHERE m.channel_id = $1 AND ($2::bigint IS NULL OR m.id < $2::bigint) AND ($3 = false OR m.pinned) ORDER BY m.id DESC LIMIT ${limit}`,
      [channelId, before, options.pinned === true],
    );
    return (await this.#hydrate(rows)).reverse();
  }

  /** Junta a cada mensagem os anexos e as reações dela. */
  async #hydrate(rows: Row[]): Promise<Message[]> {
    const messages = rows.map(toMessage);
    if (messages.length === 0) return messages;
    const ids = messages.map((message) => message.id);
    const [files, reactions] = await Promise.all([
      this.#db.query(`SELECT ${FILE_COLUMNS}, message_id FROM files WHERE message_id = ANY($1::bigint[]) ORDER BY seq`, [ids]),
      this.#db.query('SELECT message_id, emoji, user_id FROM reactions WHERE message_id = ANY($1::bigint[]) ORDER BY seq', [ids]),
    ]);
    const byId = new Map(messages.map((message) => [message.id, message]));
    for (const row of files) byId.get(String(row.message_id))?.attachments.push(toAttachment(row));
    for (const row of reactions) {
      const message = byId.get(String(row.message_id));
      if (!message) continue;
      const emoji = String(row.emoji);
      let item = message.reactions.find((reaction) => reaction.emoji === emoji);
      if (!item) message.reactions.push((item = { emoji, users: [] }));
      item.users.push(String(row.user_id));
    }
    return messages;
  }

  /**
   * Envia uma mensagem. `extra` só é usado pelos bots (botões e nome de exibição); um bot continua
   * precisando ver o canal e ter "Enviar mensagens" nele, como qualquer membro.
   */
  async sendMessage(user: User, channelId: string, value: unknown, extra: { meta?: MessageMeta; as?: string; replyTo?: unknown; attachments?: unknown; clientId?: unknown } = {}): Promise<Message> {
    const { ctx, channel, perms } = await this.#channelCtx(user, channelId);
    if (channel.kind === 'categoria') throw new ApiError(400, 'nao_e_texto', 'Categorias não têm mensagens.');
    if (ctx.subject.timedOut) throw new ApiError(403, 'em_castigo', 'Você está de castigo neste grupo e não pode enviar mensagens por enquanto.');
    this.#need(ctx, P.SEND_MESSAGES, perms);
    const request = messageRequest(extra.clientId, [value, extra.replyTo ?? null, extra.attachments ?? []]);
    if (request.clientId) {
      const [existing] = await this.#db.query('SELECT id, client_hash FROM messages WHERE channel_id = $1 AND author_id = $2 AND client_id = $3', [channelId, user.id, request.clientId]);
      if (existing) { checkMessageRequest(existing.client_hash, request.hash); return this.#message(String(existing.id)); }
    }
    const fromBot = ctx.me.bot;
    const attachments = this.#attachmentIds(extra.attachments);
    if (attachments.length > 0) this.#need(ctx, P.ATTACH_FILES, perms);
    // Com anexo, o texto é opcional.
    const content = attachments.length > 0 && !cleanText(value, LIMITS.messageChars, true) ? '' : this.#content(ctx, perms, value);
    let replyTo: string | null = null;
    let replyAuthor: string | null = null;
    if (extra.replyTo !== undefined && extra.replyTo !== null) {
      const [target] = typeof extra.replyTo === 'string' && MESSAGE_ID.test(extra.replyTo)
        ? await this.#db.query('SELECT author_id FROM messages WHERE id = $1::bigint AND channel_id = $2', [extra.replyTo, channelId])
        : [];
      if (!target) throw new ApiError(400, 'resposta_invalida', 'A mensagem que você está respondendo não existe mais neste canal.');
      replyTo = extra.replyTo as string;
      replyAuthor = target.author_id === null ? null : String(target.author_id);
    }
    // O limite de velocidade é para pessoas; bots têm os próprios limites na Central de Bots.
    if (!fromBot && !this.#limiter.take(`mensagem:${user.id}`, 10, 10_000)) {
      throw new ApiError(429, 'devagar', 'Você está enviando mensagens rápido demais. Espere alguns segundos.');
    }
    // @everyone só vale como menção para quem tem a permissão; para os demais é texto comum.
    const mention = /(^|\s)@everyone\b/.test(content) && has(perms, P.MENTION_EVERYONE);
    const mentions = this.#mentions(ctx.snap, content, user.id, replyAuthor);
    let created = false;
    let insertedRow: Row | undefined;
    const id = await timed('persist', () => this.#db.tx(async (tx) => {
      const [inserted] = await tx.query(
        'INSERT INTO messages (channel_id, author_id, author_name, content, mention_everyone, meta, reply_to, mentions, client_id, client_hash) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::bigint, $8::jsonb, $9, $10) ON CONFLICT (author_id, channel_id, client_id) DO NOTHING RETURNING *',
        [channelId, user.id, fromBot ? (extra.as ?? null) : null, content, mention, fromBot && extra.meta ? JSON.stringify(extra.meta) : null, replyTo, JSON.stringify(mentions), request.clientId, request.hash],
      );
      if (!inserted) {
        const [existing] = await tx.query('SELECT id, client_hash FROM messages WHERE channel_id = $1 AND author_id = $2 AND client_id = $3', [channelId, user.id, request.clientId]);
        checkMessageRequest(existing!.client_hash, request.hash);
        return String(existing!.id);
      }
      created = true;
      insertedRow = inserted;
      const messageId = String(inserted!.id);
      if (attachments.length > 0) {
        // Só entra arquivo que esta pessoa enviou para este canal e que ainda não está em outra mensagem.
        const attached = await tx.query(
          'UPDATE files SET message_id = $1::bigint WHERE id = ANY($2::text[]) AND uploader_id = $3 AND channel_id = $4 AND message_id IS NULL RETURNING id',
          [messageId, attachments, user.id, channelId],
        );
        if (attached.length !== attachments.length) throw new ApiError(400, 'anexo_invalido', 'Um dos arquivos não está mais disponível. Envie de novo.');
      }
      // Quem escreve já leu o canal até a própria mensagem.
      await this.#read(tx, user.id, channelId, messageId);
      return messageId;
    }));
    // Sem anexos/resposta, o INSERT já fornece tudo: evita mais três consultas na rota mais frequente.
    const message = insertedRow && !replyTo && attachments.length === 0
      ? toMessage({ ...insertedRow, display_name: user.displayName, username: user.username, is_bot: fromBot })
      : await timed('hydrate', () => this.#message(id));
    if (created) {
      await timed('gateway', () => this.hub.publishToChannel(ctx.snap.group.id, channelId, { t: 'message.created', groupId: ctx.snap.group.id, message }));
      this.#emit({ type: 'message', groupId: ctx.snap.group.id, channel, message, author: user, fromBot });
    }
    return message;
  }

  /** Um bot apaga uma mensagem que ele mesmo enviou ou, com a permissão, a de um membro. Mesmo caminho das pessoas. */
  async channelOf(channelId: string): Promise<{ groupId: string; channel: Channel } | null> {
    let groupId = this.#channelGroup.get(channelId);
    if (!groupId) {
      const [row] = await this.#db.query('SELECT group_id FROM channels WHERE id = $1', [channelId]);
      if (!row) return null;
      groupId = String(row.group_id);
    }
    const channel = (await this.snapshot(groupId)).channels.get(channelId);
    return channel ? { groupId, channel } : null;
  }

  #attachmentIds(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(item))) {
      throw new ApiError(400, 'anexo_invalido', 'Lista de anexos inválida.');
    }
    const ids = [...new Set(value as string[])];
    if (ids.length > LIMITS.attachmentsPerMessage) throw new ApiError(400, 'anexos_demais', `Cada mensagem leva no máximo ${LIMITS.attachmentsPerMessage} arquivos.`);
    return ids;
  }

  /** Quem a mensagem menciona: cada @usuario que é membro do grupo e o autor da mensagem respondida. */
  #mentions(snap: Snapshot, content: string, authorId: string, replyAuthor: string | null): string[] {
    const byUsername = new Map([...snap.members.values()].map((member) => [member.username.toLowerCase(), member.userId]));
    const found = new Set<string>();
    for (const match of content.matchAll(MENTION)) {
      const name = match[2]!.toLowerCase();
      // "@ana." no fim da frase: o ponto faz parte da pontuação, não do nome.
      const id = byUsername.get(name) ?? byUsername.get(name.replace(/\.+$/, ''));
      if (id) found.add(id);
    }
    if (replyAuthor && replyAuthor !== authorId && snap.members.has(replyAuthor)) found.add(replyAuthor);
    return [...found];
  }

  #content(ctx: Ctx, perms: bigint, value: unknown): string {
    if (typeof value === 'string' && Array.from(value).length > LIMITS.messageChars) {
      throw new ApiError(400, 'mensagem_longa', `A mensagem pode ter no máximo ${LIMITS.messageChars} caracteres.`);
    }
    const content = cleanText(value, LIMITS.messageChars, true);
    if (!content) throw new ApiError(400, 'mensagem_vazia', 'Escreva alguma coisa antes de enviar.');
    if (LINK.test(content) && !ctx.me.bot) this.#need(ctx, P.SEND_LINKS, perms);
    return content;
  }

  async #message(id: string): Promise<Message> {
    const [row] = await this.#db.query(`${MESSAGE_SELECT} WHERE m.id = $1::bigint`, [id]);
    if (!row) throw new ApiError(404, 'mensagem_inexistente', 'Mensagem não encontrada.');
    return (await this.#hydrate([row]))[0]!;
  }

  async #messageCtx(user: User, messageId: string) {
    if (!MESSAGE_ID.test(messageId)) throw new ApiError(404, 'mensagem_inexistente', 'Mensagem não encontrada.');
    const [row] = await this.#db.query(`${MESSAGE_SELECT} WHERE m.id = $1::bigint`, [messageId]);
    if (!row) throw new ApiError(404, 'mensagem_inexistente', 'Mensagem não encontrada.');
    const message = toMessage(row);
    try {
      return { message, ...(await this.#channelCtx(user, message.channelId)) };
    } catch {
      throw new ApiError(404, 'mensagem_inexistente', 'Mensagem não encontrada.');
    }
  }

  async editMessage(user: User, messageId: string, value: unknown): Promise<Message> {
    const { message, ctx, perms } = await this.#messageCtx(user, messageId);
    // Editar é só do autor; nem administrador reescreve a mensagem de outra pessoa.
    if (message.author.id !== user.id) throw new ApiError(403, 'nao_e_autor', 'Só quem escreveu pode editar a mensagem.');
    if (ctx.subject.timedOut) throw new ApiError(403, 'em_castigo', 'Você está de castigo neste grupo.');
    this.#need(ctx, P.SEND_MESSAGES, perms);
    const [hasFiles] = await this.#db.query('SELECT 1 FROM files WHERE message_id = $1::bigint LIMIT 1', [messageId]);
    const content = hasFiles && !cleanText(value, LIMITS.messageChars, true) ? '' : this.#content(ctx, perms, value);
    const mentions = this.#mentions(ctx.snap, content, user.id, message.reply?.authorId ?? null);
    await this.#db.query('UPDATE messages SET content = $2, mentions = $3::jsonb, edited_at = now() WHERE id = $1::bigint', [messageId, content, JSON.stringify(mentions)]);
    const updated = await this.#message(messageId);
    await this.hub.publishToChannel(ctx.snap.group.id, message.channelId, { t: 'message.updated', groupId: ctx.snap.group.id, message: updated });
    return updated;
  }

  async deleteMessage(user: User, messageId: string): Promise<void> {
    const { message, ctx, channel, perms } = await this.#messageCtx(user, messageId);
    const own = message.author.id === user.id;
    if (!own) this.#need(ctx, P.DELETE_MESSAGES, perms);
    await this.#db.tx(async (tx) => {
      await tx.query('DELETE FROM messages WHERE id = $1::bigint', [messageId]);
      if (!own) {
        await this.#audit(tx, ctx, 'mensagem.excluida', { kind: 'canal', id: channel.id, name: channel.name }, { autor: message.author.name, trecho: message.content.slice(0, 120) });
      }
    });
    await this.hub.publishToChannel(ctx.snap.group.id, message.channelId, { t: 'message.deleted', groupId: ctx.snap.group.id, channelId: message.channelId, id: messageId });
  }

  async pinMessage(user: User, messageId: string, pinned: unknown): Promise<Message> {
    const { message, ctx, channel, perms } = await this.#messageCtx(user, messageId);
    this.#need(ctx, P.PIN_MESSAGES, perms);
    const value = pinned === true;
    await this.#db.tx(async (tx) => {
      await tx.query('UPDATE messages SET pinned = $2 WHERE id = $1::bigint', [messageId, value]);
      await this.#audit(tx, ctx, value ? 'mensagem.fixada' : 'mensagem.desafixada', { kind: 'canal', id: channel.id, name: channel.name }, { autor: message.author.name });
    });
    const updated = await this.#message(messageId);
    await this.hub.publishToChannel(ctx.snap.group.id, message.channelId, { t: 'message.updated', groupId: ctx.snap.group.id, message: updated });
    return updated;
  }

  // --- Reações ----------------------------------------------------------------------------

  async react(user: User, messageId: string, emoji: string, on: boolean): Promise<Message> {
    const { message, ctx, perms } = await this.#messageCtx(user, messageId);
    // Emoji do sistema, ou :nome: de um emoji próprio deste grupo.
    const custom = /^:([a-z0-9_]{2,32}):$/.exec(emoji);
    const known = custom ? (await this.#db.query('SELECT 1 FROM group_emojis WHERE group_id = $1 AND name = $2', [ctx.snap.group.id, custom[1]])).length > 0 : false;
    if (emoji.length > 40 || (!EMOJI.test(emoji) && !known)) throw new ApiError(400, 'emoji_invalido', 'Escolha um emoji para reagir.');
    if (on) {
      if (ctx.subject.timedOut) throw new ApiError(403, 'em_castigo', 'Você está de castigo neste grupo.');
      this.#need(ctx, P.ADD_REACTIONS, perms);
      const [count] = await this.#db.query('SELECT count(DISTINCT emoji) AS total, coalesce(bool_or(emoji = $2), false) AS present FROM reactions WHERE message_id = $1::bigint', [messageId, emoji]);
      if (count?.present !== true && num(count?.total) >= LIMITS.reactionsPerMessage) {
        throw new ApiError(409, 'reacoes_demais', `Cada mensagem aceita até ${LIMITS.reactionsPerMessage} emojis diferentes.`);
      }
      await this.#db.query('INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1::bigint, $2, $3) ON CONFLICT DO NOTHING', [messageId, user.id, emoji]);
    } else {
      await this.#db.query('DELETE FROM reactions WHERE message_id = $1::bigint AND user_id = $2 AND emoji = $3', [messageId, user.id, emoji]);
    }
    const updated = await this.#message(messageId);
    await this.hub.publishToChannel(ctx.snap.group.id, message.channelId, { t: 'message.updated', groupId: ctx.snap.group.id, message: updated });
    return updated;
  }

  // --- Arquivos ---------------------------------------------------------------------------

  /** Guarda um arquivo para ser anexado à próxima mensagem da pessoa neste canal. */
  async uploadFile(user: User, channelId: string, input: { name: unknown; mime: unknown; bytes: Uint8Array; width?: unknown; height?: unknown }): Promise<Attachment> {
    const { ctx, channel, perms } = await this.#channelCtx(user, channelId);
    if (channel.kind === 'categoria') throw new ApiError(400, 'nao_e_texto', 'Categorias não têm mensagens.');
    if (ctx.subject.timedOut) throw new ApiError(403, 'em_castigo', 'Você está de castigo neste grupo e não pode enviar arquivos por enquanto.');
    this.#need(ctx, P.SEND_MESSAGES, perms);
    this.#need(ctx, P.ATTACH_FILES, perms);
    const size = input.bytes.byteLength;
    if (size === 0) throw new ApiError(400, 'arquivo_vazio', 'O arquivo está vazio.');
    if (size > this.limits.fileBytes) throw this.fileTooBig();
    if (!ctx.me.bot && !this.#limiter.take(`arquivo:${user.id}`, 30, 60_000)) {
      throw new ApiError(429, 'devagar', 'Você está enviando arquivos rápido demais. Espere um minuto.');
    }
    const groupId = ctx.snap.group.id;
    const [used] = await this.#db.query('SELECT coalesce(sum(size), 0) AS total FROM files WHERE group_id = $1', [groupId]);
    if (num(used?.total) + size > this.limits.groupStorageBytes) {
      throw new ApiError(413, 'grupo_sem_espaco', 'O grupo chegou ao limite de armazenamento de arquivos. Apague mensagens com arquivos antigos para liberar espaço.');
    }
    const name = cleanText(input.name, LIMITS.fileNameChars).replace(/[\\/:*?"<>|]/g, '_') || 'arquivo';
    const declared = typeof input.mime === 'string' ? input.mime.split(';')[0]!.trim().toLowerCase() : '';
    const mime = MIME.test(declared) ? declared : 'application/octet-stream';
    const [row] = await this.#db.query(
      `INSERT INTO files (id, group_id, channel_id, uploader_id, name, mime, size, width, height, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${FILE_COLUMNS}`,
      [newId(), groupId, channelId, user.id, name, mime, size, dimension(input.width), dimension(input.height), input.bytes],
    );
    return toAttachment(row!);
  }

  fileTooBig(): ApiError {
    return new ApiError(413, 'arquivo_grande', `O arquivo passa do limite de ${Math.floor(this.limits.fileBytes / (1024 * 1024))} MB.`);
  }

  /** Lê um arquivo. Só para quem vê o canal dele; enquanto não foi anexado a uma mensagem, só para quem enviou. */
  async readFile(user: User, fileId: string): Promise<{ name: string; mime: string; inline: boolean; data: Uint8Array }> {
    const missing = () => new ApiError(404, 'arquivo_inexistente', 'Arquivo não encontrado.');
    const [row] = await this.#db.query('SELECT channel_id, uploader_id, message_id, name, mime, data FROM files WHERE id = $1', [fileId]);
    if (!row) throw missing();
    try {
      await this.#channelCtx(user, String(row.channel_id));
    } catch {
      throw missing();
    }
    if (row.message_id === null && row.uploader_id !== user.id) throw missing();
    const mime = String(row.mime);
    return { name: String(row.name), mime, inline: INLINE_MIME.has(mime), data: row.data as Uint8Array };
  }

  /** Apaga arquivos enviados há mais de uma hora que nunca viraram anexo de uma mensagem. */
  async purgeOrphanFiles(now = new Date()): Promise<number> {
    const rows = await this.#db.query('DELETE FROM files WHERE message_id IS NULL AND created_at < $1 RETURNING id', [new Date(now.getTime() - 60 * 60_000)]);
    return rows.length;
  }

  // --- Registro de auditoria ---------------------------------------------------------------

  async auditLog(user: User, groupId: string, before?: unknown) {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.VIEW_AUDIT_LOG);
    const cursor = typeof before === 'string' && /^\d{1,18}$/.test(before) ? before : null;
    const rows = await this.#db.query('SELECT * FROM audit_log WHERE group_id = $1 AND ($2::bigint IS NULL OR id < $2::bigint) ORDER BY id DESC LIMIT 50', [groupId, cursor]);
    return rows.map((row) => ({
      id: String(row.id),
      actorId: row.actor_id === null ? null : String(row.actor_id),
      actorName: String(row.actor_name),
      action: String(row.action),
      targetKind: String(row.target_kind),
      targetId: String(row.target_id),
      targetName: String(row.target_name),
      detail: (typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail) as Record<string, unknown>,
      createdAt: iso(row.created_at),
    }));
  }

  /**
   * Painel de moderação de um membro. Só para quem tem alguma permissão de moderação no grupo. Tudo vem
   * deste grupo: nada de mensagens privadas nem de outros grupos. A forma de entrada só aparece se ficou
   * registrada (quem entrou antes do registro existir aparece como "não registrada").
   */
  async memberDetails(user: User, groupId: string, targetId: string) {
    const ctx = await this.#ctx(user, groupId);
    const moderation = P.KICK_MEMBERS | P.BAN_MEMBERS | P.MANAGE_ROLES | P.VIEW_AUDIT_LOG | P.MUTE_MEMBERS | P.MOVE_MEMBERS | P.MANAGE_MESSAGES;
    if (!ctx.subject.isOwner && !has(ctx.base, P.ADMINISTRATOR) && (ctx.base & moderation) === 0n) {
      throw new ApiError(403, 'sem_permissao', 'Você não tem permissões de moderação neste grupo.');
    }
    const { member, subject } = this.#targetMember(ctx, targetId);
    const [joined] = await this.#db.query(
      'SELECT m.joined_via, m.invited_by, u.display_name AS inviter_name FROM members m LEFT JOIN users u ON u.id = m.invited_by WHERE m.group_id = $1 AND m.user_id = $2',
      [groupId, targetId],
    );
    const via = joined?.joined_via === null || joined?.joined_via === undefined ? null : String(joined.joined_via);
    const joinedVia = via === null
      ? null
      : {
          kind: via.startsWith('convite:') ? 'convite' : via,
          code: via.startsWith('convite:') ? via.slice(8) : null,
          invitedBy: joined?.invited_by ? { id: String(joined.invited_by), name: String(joined.inviter_name ?? '') } : null,
        };

    // Estatísticas só dos canais que quem consulta enxerga.
    const visible = [...ctx.snap.channels.values()].filter((channel) => channel.kind !== 'categoria' && has(this.permissionsIn(ctx.snap, ctx.subject, channel), P.VIEW_CHANNEL));
    const ids = visible.map((channel) => channel.id);
    const [totals] = await this.#db.query(
      `SELECT count(*) AS messages,
              count(*) FILTER (WHERE content ~* 'https?://') AS links
         FROM messages WHERE author_id = $1 AND channel_id = ANY($2::text[])`,
      [targetId, ids],
    );
    const [files] = await this.#db.query(
      `SELECT count(*) FILTER (WHERE f.mime LIKE 'image/%') AS images, count(*) FILTER (WHERE f.mime NOT LIKE 'image/%') AS others
         FROM files f WHERE f.uploader_id = $1 AND f.channel_id = ANY($2::text[]) AND f.message_id IS NOT NULL`,
      [targetId, ids],
    );
    const perChannel = await this.#db.query(
      'SELECT channel_id, count(*) AS total FROM messages WHERE author_id = $1 AND channel_id = ANY($2::text[]) GROUP BY channel_id ORDER BY total DESC LIMIT 20',
      [targetId, ids],
    );
    const history = has(ctx.base, P.VIEW_AUDIT_LOG) || ctx.subject.isOwner
      ? (await this.#db.query("SELECT * FROM audit_log WHERE group_id = $1 AND target_kind = 'membro' AND target_id = $2 ORDER BY id DESC LIMIT 30", [groupId, targetId])).map((row) => ({
          id: String(row.id),
          actorName: String(row.actor_name),
          action: String(row.action),
          detail: (typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail) as Record<string, unknown>,
          createdAt: iso(row.created_at),
        }))
      : null;
    const above = canActOnMember(ctx.subject, subject, ctx.snap.roles) && !member.bot;
    return {
      member: {
        userId: member.userId,
        cosmicAdmin: member.cosmicAdmin === true,
        username: member.username,
        displayName: member.displayName,
        nickname: member.nickname,
        joinedAt: member.joinedAt,
        joinedVia,
        timeoutUntil: member.timeoutUntil,
        roleIds: [...member.roleIds],
        bot: member.bot,
        isOwner: subject.isOwner,
        isCosmicAdmin: subject.isCosmicAdmin === true,
      },
      permissions: str(basePermissions(subject, ctx.snap.roles)),
      canAct: {
        kick: above && has(ctx.base, P.KICK_MEMBERS),
        ban: above && has(ctx.base, P.BAN_MEMBERS),
        timeout: above && has(ctx.base, P.KICK_MEMBERS),
        roles: above && has(ctx.base, P.MANAGE_ROLES),
        mute: above && has(ctx.base, P.MUTE_MEMBERS),
        move: above && has(ctx.base, P.MOVE_MEMBERS),
        audit: history !== null,
      },
      stats: {
        messages: num(totals?.messages),
        links: num(totals?.links),
        images: num(files?.images),
        files: num(files?.others),
        channels: perChannel.map((row) => ({ channelId: String(row.channel_id), name: ctx.snap.channels.get(String(row.channel_id))?.name ?? '', messages: num(row.total) })),
      },
      history,
      voice: this.hub.voiceOf(targetId)?.groupId === groupId ? this.hub.voiceOf(targetId)!.channelId : null,
    };
  }

  // --- Emojis do grupo --------------------------------------------------------------------

  async #emojis(groupId: string) {
    return (await this.#db.query('SELECT id, name, animated FROM group_emojis WHERE group_id = $1 ORDER BY name', [groupId])).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      animated: row.animated === true,
    }));
  }

  /** Emoji próprio do grupo. O formato real vem do arquivo: PNG, GIF ou WebP de até 256 KB e 256 px. */
  async createEmoji(user: User, groupId: string, name: unknown, bytes: Uint8Array) {
    const ctx = await this.#ctx(user, groupId);
    this.#need(ctx, P.MANAGE_EMOJIS);
    const clean = typeof name === 'string' ? name.trim().toLowerCase() : '';
    if (!/^[a-z0-9_]{2,32}$/.test(clean)) throw new ApiError(400, 'nome_invalido', 'Use de 2 a 32 letras sem acento, números ou _ no nome do emoji.');
    const info = imageInfo(bytes);
    if (!info || info.mime === 'image/jpeg') throw new ApiError(400, 'imagem_invalida', 'Use uma imagem PNG, GIF ou WebP.');
    if (bytes.length > 256 * 1024) throw new ApiError(413, 'imagem_grande', 'O emoji passa de 256 KB.');
    if (info.width > 256 || info.height > 256 || info.width < 16 || info.height < 16) throw new ApiError(400, 'dimensoes_invalidas', 'O emoji deve ter de 16 a 256 pixels de lado.');
    const [count] = await this.#db.query('SELECT count(*) AS total FROM group_emojis WHERE group_id = $1', [groupId]);
    if (num(count?.total) >= 50) throw new ApiError(409, 'emojis_demais', 'Cada grupo tem no máximo 50 emojis próprios.');
    const id = newId(12);
    try {
      await this.#db.query('INSERT INTO group_emojis (id, group_id, name, mime, animated, size, data, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, groupId, clean, info.mime, info.animated, bytes.length, bytes, user.id]);
    } catch {
      throw new ApiError(409, 'emoji_existente', `Já existe um emoji chamado :${clean}:.`);
    }
    await this.#audit(this.#db, ctx, 'emoji.criado', { kind: 'emoji', id, name: clean }, { animado: info.animated });
    this.#changed(groupId);
    return { id, name: clean, animated: info.animated };
  }

  async deleteEmoji(user: User, emojiId: string): Promise<void> {
    const [row] = await this.#db.query('SELECT group_id, name FROM group_emojis WHERE id = $1', [emojiId]);
    if (!row) throw new ApiError(404, 'emoji_inexistente', 'Emoji não encontrado.');
    const ctx = await this.#ctx(user, String(row.group_id));
    this.#need(ctx, P.MANAGE_EMOJIS);
    await this.#db.query('DELETE FROM group_emojis WHERE id = $1', [emojiId]);
    await this.#audit(this.#db, ctx, 'emoji.excluido', { kind: 'emoji', id: emojiId, name: String(row.name) });
    this.#changed(String(row.group_id));
  }

  async readEmoji(emojiId: string): Promise<{ mime: string; data: Uint8Array }> {
    const [row] = /^[A-Za-z0-9_-]{8,40}$/.test(emojiId) ? await this.#db.query('SELECT mime, data FROM group_emojis WHERE id = $1', [emojiId]) : [];
    if (!row) throw new ApiError(404, 'emoji_inexistente', 'Emoji não encontrado.');
    return { mime: String(row.mime), data: row.data as Uint8Array };
  }

  /** O perfil de alguém mudou (nome, foto): os grupos dessa pessoa recarregam a lista de membros. */
  async userChanged(userId: string): Promise<void> {
    for (const groupId of await this.groupIdsOf(userId)) this.#changed(groupId);
  }

  // --- Canais de voz ----------------------------------------------------------------------

  async #rightsFor(snap: Snapshot, member: Member, channel: Channel): Promise<{ perms: bigint; rights: PublishRights }> {
    const perms = this.permissionsIn(snap, this.subjectOf(snap, member), channel);
    const [blocked] = await this.#db.query('SELECT 1 FROM voice_blocks WHERE channel_id = $1 AND user_id = $2', [channel.id, member.userId]);
    return {
      perms,
      rights: { speak: has(perms, P.SPEAK) && !blocked, stream: has(perms, P.STREAM), streamAudio: has(perms, P.STREAM | P.SHARE_AUDIO) },
    };
  }

  /** Entra num canal de voz: devolve o token do SFU, que já vem limitado ao que a pessoa pode publicar ali. */
  async joinVoice(user: User, channelId: string) {
    const started = performance.now();
    const pass = this.#movePass.get(user.id);
    const moved = pass !== undefined && pass.channelId === channelId && pass.expires > Date.now();
    // Ninguém entra num canal que não pode ver nem conectar, nem quando é movido: mover confere isso antes.
    const found = await this.#channelCtx(user, channelId);
    const groupId = found.ctx.snap.group.id;
    const ctx = found.ctx;
    const channel = ctx.snap.channels.get(channelId);
    if (!channel || channel.kind !== 'voz') throw new ApiError(400, 'nao_e_voz', 'Este canal não é de voz.');
    const { perms, rights } = await this.#rightsFor(ctx.snap, ctx.me, channel);
    this.#need(ctx, P.CONNECT, perms);
    if (!moved) {
      const inside = this.hub.voiceIn(groupId)[channelId] ?? [];
      if (channel.userLimit > 0 && inside.length >= channel.userLimit && !inside.includes(user.id) && !has(perms, P.MOVE_MEMBERS)) {
        throw new ApiError(403, 'canal_cheio', 'Este canal de voz está cheio.');
      }
    }
    this.#movePass.delete(user.id);
    const room = voiceRoom(channelId);
    const timings = { contextMs: performance.now() - started, ensureRoomMs: 0, signTokenMs: 0, sfuMs: 0, presenceMs: 0, totalMs: 0 };
    let token: string;
    try {
      const sfuStarted = performance.now();
      const previous = this.hub.voiceOf(user.id);
      const ensure = timed('sfu_room', () => this.#ensureVoiceRoom(room)).then(() => { timings.ensureRoomMs = performance.now() - sfuStarted; });
      const remove = previous && previous.channelId !== channelId ? timed('sfu_remove', () => this.#sfu.removeParticipant(voiceRoom(previous.channelId), user.id)) : Promise.resolve();
      const signed = timed('token', () => this.#sfu.createVoiceToken({
        room,
        identity: user.id,
        name: ctx.me.nickname ?? user.displayName,
        ttlSeconds: this.#options.tokenTtlSeconds,
        publish: rights,
        metadata: { voz: true, accountId: user.id, avatar: ctx.me.avatar },
      })).then(value => { timings.signTokenMs = performance.now() - sfuStarted; return value; });
      const result = await Promise.all([ensure, remove, signed]);
      token = result[2]; timings.sfuMs = performance.now() - sfuStarted;
    } catch (error) {
      throw sfuError(error);
    }
    const presenceStarted = performance.now();
    if (this.hub.isOnline(user.id)) await timed('presence', () => this.hub.setVoice(user.id, { groupId, channelId }));
    timings.presenceMs = performance.now() - presenceStarted; timings.totalMs = performance.now() - started;
    return {
      timings,
      token,
      url: this.#options.livekitUrl,
      identity: user.id,
      room: { id: channelId, name: channel.name, capacity: channel.userLimit || LIMITS.voiceUsers, hasPassword: false },
      permissions: str(perms),
      ...rights,
      canWatch: has(perms, P.WATCH_STREAMS),
      highQuality: has(perms, P.HIGH_QUALITY_STREAM),
    };
  }

  readonly #voiceRooms = new Map<string, { expires: number; pending: Promise<void> }>();
  #ensureVoiceRoom(room: string): Promise<void> {
    const cached = this.#voiceRooms.get(room);
    if (cached && cached.expires > Date.now()) return cached.pending;
    // TTL menor que emptyTimeout; não armazena tokens nem ignora as permissões de cada entrada.
    const entry = { expires: Date.now() + 60_000, pending: this.#sfu.ensureRoom(room, LIMITS.voiceUsers + 1) };
    this.#voiceRooms.set(room, entry);
    for (const [key, value] of this.#voiceRooms) if (value.expires <= Date.now()) this.#voiceRooms.delete(key);
    void entry.pending.catch(() => { if (this.#voiceRooms.get(room) === entry) this.#voiceRooms.delete(room); });
    return entry.pending;
  }

  /** Confirma a participação no SFU depois da entrada ou da reconexão do gateway. */
  async syncVoice(user: User, channelId: string): Promise<void> {
    const { ctx, perms } = await this.#channelCtx(user, channelId);
    const channel = ctx.snap.channels.get(channelId);
    if (!channel || channel.kind !== 'voz') throw new ApiError(400, 'nao_e_voz', 'Este canal não é de voz.');
    this.#need(ctx, P.CONNECT, perms);
    if (!this.hub.isOnline(user.id)) return;
    const tracks = await this.#sfu.tracksOf(voiceRoom(channelId), user.id);
    if (tracks === null) return;
    await this.hub.setVoice(user.id, { groupId: ctx.snap.group.id, channelId });
  }

  async leaveVoice(user: User): Promise<void> {
    const place = this.hub.voiceOf(user.id);
    if (!place) return;
    await this.hub.setVoice(user.id, null);
    await this.#sfu.removeParticipant(voiceRoom(place.channelId), user.id).catch(() => undefined);
  }

  /**
   * Depois de uma mudança de cargos, regras de canal ou castigo: quem já está num canal de voz passa a
   * poder publicar só o que as permissões novas deixam, sem precisar sair e entrar.
   */
  async #syncVoiceRights(groupId: string, onlyUserId?: string): Promise<void> {
    const voice = this.hub.voiceIn(groupId);
    if (Object.keys(voice).length === 0) return;
    const snap = await this.snapshot(groupId);
    for (const [channelId, userIds] of Object.entries(voice)) {
      const channel = snap.channels.get(channelId);
      for (const userId of userIds) {
        if (onlyUserId && userId !== onlyUserId) continue;
        const member = snap.members.get(userId);
        if (!channel || !member) continue;
        const { perms, rights } = await this.#rightsFor(snap, member, channel);
        try {
          if (!has(perms, P.CONNECT)) {
            await this.#sfu.removeParticipant(voiceRoom(channelId), userId);
            await this.hub.setVoice(userId, null);
          } else {
            await this.#sfu.setPublishing(voiceRoom(channelId), userId, rights);
          }
        } catch (error) {
          console.error('[sfu]', describeSfuError(error));
        }
      }
    }
  }

  /** Moderação de voz. Toda ação exige a permissão correspondente no canal e que o alvo esteja abaixo na hierarquia. */
  async moderateVoice(user: User, channelId: string, input: Record<string, unknown>): Promise<void> {
    const { ctx, channel, perms } = await this.#channelCtx(user, channelId);
    if (channel.kind !== 'voz') throw new ApiError(400, 'nao_e_voz', 'Este canal não é de voz.');
    const action = input.action;
    const targetId = String(input.userId ?? '');
    const { member, subject } = this.#targetMember(ctx, targetId);
    this.#human(member);
    const groupId = ctx.snap.group.id;
    const room = voiceRoom(channelId);
    const inside = (this.hub.voiceIn(groupId)[channelId] ?? []).includes(targetId);
    const target = { kind: 'membro', id: targetId, name: member.displayName };
    const sfu = async (run: () => Promise<void>) => {
      try {
        await run();
      } catch (error) {
        throw sfuError(error);
      }
    };
    const needInside = () => {
      if (!inside) throw new ApiError(409, 'fora_do_canal', 'Essa pessoa não está neste canal de voz.');
    };

    if (action === 'mute') {
      this.#need(ctx, P.MUTE_MEMBERS, perms);
      this.#needRank(ctx, subject);
      needInside();
      await sfu(async () => {
        for (const track of (await this.#sfu.tracksOf(room, targetId)) ?? []) {
          if (track.source === 'microfone' && !track.muted) await this.#sfu.muteTrack(room, targetId, track.sid, true);
        }
      });
      await this.#audit(this.#db, ctx, 'voz.silenciado', target, { canal: channel.name });
      this.hub.toUser(targetId, { t: 'voice.muted', groupId, channelId, by: user.displayName });
    } else if (action === 'block' || action === 'unblock') {
      this.#need(ctx, P.BLOCK_SPEAK, perms);
      this.#needRank(ctx, subject);
      if (action === 'block') {
        await this.#db.query('INSERT INTO voice_blocks (channel_id, user_id, blocked_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [channelId, targetId, user.id]);
      } else {
        await this.#db.query('DELETE FROM voice_blocks WHERE channel_id = $1 AND user_id = $2', [channelId, targetId]);
      }
      await this.#audit(this.#db, ctx, action === 'block' ? 'voz.fala_bloqueada' : 'voz.fala_liberada', target, { canal: channel.name });
      if (inside) await sfu(async () => this.#sfu.setPublishing(room, targetId, (await this.#rightsFor(ctx.snap, member, channel)).rights));
      this.hub.toUser(targetId, { t: 'voice.rights', groupId, channelId });
    } else if (action === 'stop_stream') {
      this.#need(ctx, P.STOP_STREAMS, perms);
      this.#needRank(ctx, subject);
      needInside();
      const { rights } = await this.#rightsFor(ctx.snap, member, channel);
      // Tirar a permissão derruba a transmissão no SFU; devolver em seguida deixa a pessoa transmitir de novo depois.
      await sfu(async () => {
        await this.#sfu.setPublishing(room, targetId, { ...rights, stream: false, streamAudio: false });
        await this.#sfu.setPublishing(room, targetId, rights);
      });
      await this.#audit(this.#db, ctx, 'voz.transmissao_encerrada', target, { canal: channel.name });
      this.hub.toUser(targetId, { t: 'voice.stream_stopped', groupId, channelId, by: user.displayName });
    } else if (action === 'disconnect' || action === 'move') {
      this.#need(ctx, P.MOVE_MEMBERS, perms);
      this.#needRank(ctx, subject);
      needInside();
      let destination: Channel | null = null;
      if (action === 'move') {
        // Quem move precisa poder entrar no canal de destino.
        const there = await this.#channelCtx(user, String(input.toChannelId ?? ''));
        if (there.channel.kind !== 'voz' || there.ctx.snap.group.id !== groupId || there.channel.id === channelId) throw new ApiError(400, 'destino_invalido', 'Escolha outro canal de voz deste grupo.');
        this.#need(ctx, P.CONNECT, there.perms);
        destination = there.channel;
        const theirs = this.permissionsIn(ctx.snap, subject, destination);
        if (!has(theirs, P.VIEW_CHANNEL) || !has(theirs, P.CONNECT)) {
          if (input.grantAccess !== true) {
            throw new ApiError(403, 'sem_acesso_destino', `${member.displayName} não tem acesso a “${destination.name}”. Libere o acesso dessa pessoa ao canal (ou confirme a concessão) antes de mover.`);
          }
          this.#need(ctx, P.MANAGE_ROLES, there.perms);
          const grant = P.VIEW_CHANNEL | P.CONNECT;
          await this.#db.query(
            `INSERT INTO overrides (channel_id, target_kind, target_id, allow, deny) VALUES ($1, 'membro', $2, $3, 0)
             ON CONFLICT (channel_id, target_kind, target_id)
             DO UPDATE SET allow = overrides.allow | EXCLUDED.allow, deny = overrides.deny & ~EXCLUDED.allow`,
            [destination.id, targetId, str(grant)],
          );
          await this.#audit(this.#db, ctx, 'canal.acesso_concedido', target, { canal: destination.name, motivo: 'mover para a chamada' });
          this.#changed(groupId);
        }
        // O passe só dispensa o limite de pessoas do canal; as permissões já foram conferidas acima.
        this.#movePass.set(targetId, { channelId: destination.id, expires: Date.now() + 30_000 });
      }
      await sfu(() => this.#sfu.removeParticipant(room, targetId));
      await this.hub.setVoice(targetId, null);
      await this.#audit(this.#db, ctx, destination ? 'voz.movido' : 'voz.desconectado', target, { de: channel.name, ...(destination ? { para: destination.name } : {}) });
      this.hub.toUser(targetId, destination ? { t: 'voice.move', groupId, channelId: destination.id, by: user.displayName } : { t: 'voice.disconnected', groupId, channelId, by: user.displayName });
    } else {
      throw new ApiError(400, 'acao_invalida', 'Ação de moderação desconhecida.');
    }
  }
}
