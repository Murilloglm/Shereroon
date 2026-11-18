import { avatarCache } from '../avatar-cache.ts';
/**
 * Lado social na interface: perfis (com cache), notas e apelidos pessoais, amizades, bloqueios e mensagens
 * privadas. Usa a mesma sessão e o mesmo canal de tempo real dos grupos.
 */
import { API_BASE } from '../api.ts';
import { groups } from '../groups/client.ts';
import { Store } from '../store.ts';
import { isConfirmed, mergeMessages, type Delivery } from '../outbox.ts';

export type FriendState = 'nenhuma' | 'enviada' | 'recebida' | 'amigos';

export interface UserCard {
  cosmicAdmin?: boolean;
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  banner: string | null;
  bot: boolean;
}

export interface Profile extends UserCard {
  createdAt: string;
  bio: string | null;
  status: string | null;
  friendship: FriendState;
  friendSince: string | null;
  blocked: boolean;
  mutualGroups: { id: string; name: string; icon: string | null }[] | null;
  note: string;
  nickname: string;
  canMessage: boolean;
  profilePrivacy?: 'todos' | 'membros' | 'amigos';
  dmPrivacy?: 'amigos' | 'membros';
  activityPrivacy?: 'amigos' | 'membros' | 'ninguem';
}

export interface Friend {
  user: UserCard;
  state: Exclude<FriendState, 'nenhuma'>;
  since: string | null;
  online: boolean;
  status: string;
}

export interface Conversation {
  id: string;
  user: UserCard;
  online: boolean;
  last: { content: string; mine: boolean; at: string } | null;
  unread: number;
  notify: 'tudo' | 'nada';
}

export interface DmAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface DmMessage extends Delivery {
  id: string;
  dmId: string;
  author: { id: string | null; name: string; username: string | null };
  content: string;
  createdAt: string;
  editedAt: string | null;
  reply: { id: string; authorId: string | null; authorName: string; excerpt: string } | null;
  attachments: DmAttachment[];
  reactions: { emoji: string; users: string[] }[];
  meta: { type: 'convite'; code: string; group: { id: string; name: string; description: string; icon: string | null }; expiresAt: string | null } | null;
}

interface SocialState {
  profiles: Record<string, Profile>;
  notes: Record<string, { note: string; nickname: string }>;
  notesLoaded: boolean;
  friends: Friend[] | null;
  blocks: UserCard[] | null;
  conversations: Conversation[] | null;
  messages: Record<string, { items: DmMessage[]; loaded: boolean; hasMore: boolean }>;
}

/** Endereço de uma foto ou banner enviado ('arquivo:<id>'). Abre sem login, como num CDN. */
export function mediaUrl(value: string | null | undefined): string | null {
  if (!value?.startsWith('arquivo:')) return null;
  const id = value.slice(8);
  return /^[A-Za-z0-9_-]{8,40}$/.test(id) ? `${API_BASE}/api/media/${id}` : null;
}

class SocialClient {
  #outbox = new Map<string, { dmId: string; input: { content?: string; replyTo?: string; attachments?: string[]; invite?: { groupId: string } } }>();
  #sending = new Map<string, Promise<DmMessage>>();
  #loading = new Map<string, Promise<void>>();
  readonly store = new Store<SocialState>({ profiles: {}, notes: {}, notesLoaded: false, friends: null, blocks: null, conversations: null, messages: {} });
  /** Mensagem privada que chegou de outra pessoa (para aviso e som). */
  onIncoming: ((message: DmMessage, conversation: Conversation | undefined) => void) | null = null;
  #profileRequests = new Map<string, Promise<Profile>>();
  #accountId: string | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    groups.onEvent((event) => this.#onEvent(event));
    groups.store.subscribe(() => {
      const accountId = groups.store.get().account?.id ?? null;
      if (accountId !== this.#accountId) {
        this.#accountId = accountId;
        this.#outbox.clear(); this.#sending.clear(); this.#loading.clear();
        avatarCache.clear(); this.#profileRequests.clear();
        if (accountId) void this.profile(accountId, true).catch(() => undefined);
      }
      // Saiu da conta: nada de outra conta fica na tela.
      if (groups.store.get().status !== 'dentro' && this.store.get().friends !== null) {
        this.store.set({ profiles: {}, notes: {}, notesLoaded: false, friends: null, blocks: null, conversations: null, messages: {} });
      }
    });
  }

  /** Nome que esta conta vê para alguém: o apelido pessoal, se houver. */
  nameFor(userId: string, fallback: string): string {
    return this.store.get().notes[userId]?.nickname || fallback;
  }

  // --- Perfis e notas ---------------------------------------------------------------------

  async profile(userId: string, fresh = false): Promise<Profile> {
    const cached = this.store.get().profiles[userId];
    if (cached && !fresh) return cached;
    const pending = this.#profileRequests.get(userId);
    if (pending) return pending;
    const accountId = groups.store.get().account?.id;
    const avatarBefore = avatarCache.resolve(userId);
    const request = groups.call<{ profile: Profile }>('GET', `/api/users/${userId}`).then(({ profile }) => {
      const current = avatarCache.resolve(userId);
      if (current !== avatarBefore && current !== undefined) profile = { ...profile, avatar: current };
      if (groups.store.get().account?.id === accountId) this.#putProfile(profile);
      return profile;
    }).finally(() => { if (this.#profileRequests.get(userId) === request) this.#profileRequests.delete(userId); });
    this.#profileRequests.set(userId, request);
    return request;
  }

  #putProfile(profile: Profile): void {
    avatarCache.update(profile.id, profile.avatar);
    this.store.set((state) => ({ profiles: { ...state.profiles, [profile.id]: profile } }));
  }

  async updateProfile(patch: Record<string, unknown>): Promise<Profile> {
    const { profile } = await groups.call<{ profile: Profile }>('PATCH', '/api/me/profile', patch);
    this.#putProfile(profile);
    await groups.refreshAccount();
    return profile;
  }

  uploadMedia(kind: 'avatar' | 'banner', file: File, onProgress: (fraction: number) => void) {
    const upload = groups.uploadTo<Profile>(`/api/me/media/${kind}`, file, onProgress, 'profile');
    void upload.done.then((profile) => this.#putProfile(profile)).catch(() => undefined);
    return upload;
  }

  async loadNotes(): Promise<void> {
    const { notes } = await groups.call<{ notes: { userId: string; note: string; nickname: string }[] }>('GET', '/api/me/notes');
    this.store.set({ notes: Object.fromEntries(notes.map((item) => [item.userId, { note: item.note, nickname: item.nickname }])), notesLoaded: true });
  }

  async setNote(userId: string, patch: { note?: string; nickname?: string }): Promise<void> {
    const { note } = await groups.call<{ note: { userId: string; note: string; nickname: string } }>('PUT', `/api/users/${userId}/note`, patch);
    this.store.set((state) => {
      const notes = { ...state.notes };
      if (note.note || note.nickname) notes[userId] = { note: note.note, nickname: note.nickname };
      else delete notes[userId];
      const profile = state.profiles[userId];
      return { notes, profiles: profile ? { ...state.profiles, [userId]: { ...profile, note: note.note, nickname: note.nickname } } : state.profiles };
    });
  }

  // --- Amizades ---------------------------------------------------------------------------

  async loadFriends(): Promise<void> {
    const [{ friends }, { blocks }] = await Promise.all([
      groups.call<{ friends: Friend[] }>('GET', '/api/friends'),
      groups.call<{ blocks: UserCard[] }>('GET', '/api/blocks'),
    ]);
    avatarCache.seed([...friends.map((item) => item.user), ...blocks]);
    this.store.set({ friends, blocks });
  }

  async requestFriend(target: { username: string } | { userId: string }): Promise<FriendState> {
    const { state } = await groups.call<{ state: FriendState }>('POST', '/api/friends', target);
    await this.#afterFriendChange('userId' in target ? target.userId : null);
    return state;
  }

  async acceptFriend(userId: string): Promise<void> {
    await groups.call('POST', `/api/friends/${userId}/accept`);
    await this.#afterFriendChange(userId);
  }

  async removeFriend(userId: string): Promise<void> {
    await groups.call('DELETE', `/api/friends/${userId}`);
    await this.#afterFriendChange(userId);
  }

  async block(userId: string): Promise<void> {
    await groups.call('PUT', `/api/blocks/${userId}`);
    await this.#afterFriendChange(userId);
  }

  async unblock(userId: string): Promise<void> {
    await groups.call('DELETE', `/api/blocks/${userId}`);
    await this.#afterFriendChange(userId);
  }

  async #afterFriendChange(userId: string | null): Promise<void> {
    await this.loadFriends().catch(() => undefined);
    if (userId && this.store.get().profiles[userId]) await this.profile(userId, true).catch(() => undefined);
  }

  // --- Mensagens privadas -----------------------------------------------------------------

  get unreadTotal(): number {
    return (this.store.get().conversations ?? []).reduce((total, item) => total + (item.notify === 'nada' ? 0 : item.unread), 0);
  }

  async loadConversations(): Promise<void> {
    const { conversations } = await groups.call<{ conversations: Conversation[] }>('GET', '/api/dms');
    avatarCache.seed(conversations.map((item) => item.user));
    this.store.set({ conversations });
  }

  async openDm(userId: string): Promise<string> {
    const { id } = await groups.call<{ id: string }>('POST', '/api/dms', { userId });
    await this.loadConversations().catch(() => undefined);
    return id;
  }

  loadMessages(dmId: string, older = false): Promise<void> {
    const key = `${dmId}:${older}`;
    if (this.#loading.has(key)) return this.#loading.get(key)!;
    const current = this.store.get().messages[dmId];
    const before = older ? current?.items.find(isConfirmed)?.id : undefined;
    const promise = groups.call<{ messages: DmMessage[] }>('GET', `/api/dms/${dmId}/messages${before ? `?before=${before}` : ''}`).then(({ messages }) => {
      const latest = this.store.get().messages[dmId];
      const preserved = older ? latest?.items ?? [] : (latest?.items ?? []).filter(item => !isConfirmed(item) || BigInt(item.id) > BigInt(messages.at(-1)?.id ?? 0));
      this.#setMessages(dmId, { items: mergeMessages(preserved, messages), loaded: true, hasMore: messages.length >= 50 });
    }).finally(() => this.#loading.delete(key));
    this.#loading.set(key, promise); return promise;
  }

  async send(dmId: string, input: { content?: string; replyTo?: string; attachments?: string[]; invite?: { groupId: string } }, localAttachments: DmAttachment[] = []): Promise<DmMessage> {
    const account = groups.store.get().account;
    if (!account) throw new Error('Entre na sua conta para enviar mensagens.');
    const clientId = crypto.randomUUID();
    this.#outbox.set(clientId, { dmId, input });
    const replied = this.store.get().messages[dmId]?.items.find(item => item.id === input.replyTo);
    this.#upsert({ id: `local:${clientId}`, clientId, dmId, content: input.content ?? '', delivery: 'sending',
      author: { id: account.id, name: account.displayName, username: account.username }, createdAt: new Date().toISOString(), editedAt: null,
      reply: replied ? { id: replied.id, authorId: replied.author.id, authorName: replied.author.name, excerpt: replied.content.slice(0,120) } : null,
      attachments: localAttachments, reactions: [], meta: null });
    return this.retry(clientId);
  }

  retry(clientId: string): Promise<DmMessage> {
    const active = this.#sending.get(clientId); if (active) return active;
    const pending = this.#outbox.get(clientId);
    if (!pending) return Promise.reject(new Error('Envio não encontrado.'));
    const patch = (delivery: 'sending' | 'failed', deliveryError?: string) => {
      const current = this.store.get().messages[pending.dmId];
      if (current) this.#setMessages(pending.dmId, { items: current.items.map(item => item.clientId === clientId && !isConfirmed(item) ? { ...item, delivery, deliveryError } : item) });
    };
    patch('sending');
    const promise = groups.call<{message: DmMessage}>('POST', `/api/dms/${pending.dmId}/messages`, { ...pending.input, clientId }).then(({message}) => {
      this.#upsert(message); this.#outbox.delete(clientId); return message;
    }).catch((error: unknown) => { patch('failed', error instanceof Error ? error.message : 'Não foi possível enviar.'); throw error; }).finally(() => this.#sending.delete(clientId));
    this.#sending.set(clientId, promise); return promise;
  }

  async edit(messageId: string, content: string): Promise<void> {
    const { message } = await groups.call<{ message: DmMessage }>('PATCH', `/api/dm-messages/${messageId}`, { content });
    this.#upsert(message);
  }

  async remove(message: DmMessage): Promise<void> {
    await groups.call('DELETE', `/api/dm-messages/${message.id}`);
    this.#drop(message.dmId, message.id);
  }

  async react(message: DmMessage, emoji: string, on: boolean): Promise<void> {
    const { message: updated } = await groups.call<{ message: DmMessage }>(on ? 'PUT' : 'DELETE', `/api/dm-messages/${message.id}/reactions/${encodeURIComponent(emoji)}`);
    this.#upsert(updated);
  }

  async markRead(dmId: string, messageId: string): Promise<void> {
    const conversation = this.store.get().conversations?.find((item) => item.id === dmId);
    if (conversation && conversation.unread === 0) return;
    this.store.set((state) => ({ conversations: state.conversations?.map((item) => (item.id === dmId ? { ...item, unread: 0 } : item)) ?? null }));
    await groups.call('POST', `/api/dms/${dmId}/read`, { messageId }).catch(() => undefined);
  }

  async setNotify(dmId: string, level: 'tudo' | 'nada'): Promise<void> {
    await groups.call('PUT', `/api/dms/${dmId}/notify`, { level });
    this.store.set((state) => ({ conversations: state.conversations?.map((item) => (item.id === dmId ? { ...item, notify: level } : item)) ?? null }));
  }

  upload(dmId: string, file: File, onProgress: (fraction: number) => void) {
    return groups.uploadTo<DmAttachment>(`/api/dms/${dmId}/files?${new URLSearchParams({ name: file.name })}`, file, onProgress);
  }

  fileUrl(fileId: string): Promise<string> {
    return groups.blobUrl(`/api/dm-files/${fileId}`);
  }

  #setMessages(dmId: string, patch: Partial<SocialState['messages'][string]>): void {
    this.store.set((state) => ({
      messages: { ...state.messages, [dmId]: { items: [], loaded: false, hasMore: false, ...state.messages[dmId], ...patch } },
    }));
  }

  #upsert(message: DmMessage): void {
    const current = this.store.get().messages[message.dmId];
    if (!current?.loaded && !message.delivery && !current?.items.some(item => message.clientId && item.clientId === message.clientId && item.author.id === message.author.id)) return;
    if (message.clientId && isConfirmed(message)) this.#outbox.delete(message.clientId);
    this.#setMessages(message.dmId, { items: mergeMessages(current?.items ?? [], [message]) });
  }

  #drop(dmId: string, id: string): void {
    const current = this.store.get().messages[dmId];
    if (current?.loaded) this.#setMessages(dmId, { items: current.items.filter((item) => item.id !== id) });
  }

  #scheduleConversations(): void {
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.loadConversations().catch(() => undefined);
    }, 150);
  }

  #onEvent(event: Record<string, any>): void {
    const me = groups.store.get().account?.id;
    switch (event.t) {
      case 'dm.message': {
        const message = event.message as DmMessage;
        this.#upsert(message);
        this.#scheduleConversations();
        if (message.author.id !== me) this.onIncoming?.(message, this.store.get().conversations?.find((item) => item.id === message.dmId));
        break;
      }
      case 'dm.updated':
        this.#upsert(event.message as DmMessage);
        break;
      case 'dm.deleted':
        this.#drop(event.dmId as string, event.id as string);
        this.#scheduleConversations();
        break;
      case 'dm.read':
        this.#scheduleConversations();
        break;
      case 'friend.changed':
        void this.loadFriends().catch(() => undefined);
        if (this.store.get().profiles[event.userId as string]) void this.profile(event.userId as string, true).catch(() => undefined);
        break;
      case 'profile.changed':
        if (typeof event.userId === 'string' && (event.avatar === null || typeof event.avatar === 'string')) avatarCache.update(event.userId, event.avatar);
        if (event.userId === me) void this.profile(event.userId, true).catch(() => undefined);
        if (this.store.get().profiles[event.userId as string]) void this.profile(event.userId as string, true).catch(() => undefined);
        if (this.store.get().friends) void this.loadFriends().catch(() => undefined);
        break;
      case 'note.changed':
        void this.loadNotes().catch(() => undefined);
        break;
      case 'ready':
        // Reconectou: o que mudou enquanto estava fora volta a ser lido.
        if (this.store.get().conversations) this.#scheduleConversations();
        break;
    }
  }
}

export const social = new SocialClient();
