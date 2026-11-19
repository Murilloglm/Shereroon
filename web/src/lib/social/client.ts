import { avatarCache } from '../avatar-cache.ts';
/**
 * Lado social na interface: perfis (com cache), notas e apelidos pessoais, amizades, bloqueios e mensagens
 * privadas. Usa a mesma sessão e o mesmo canal de tempo real dos grupos.
 */
import { avatars, rememberAvatar, rememberAvatars } from '../avatars.ts';
export { mediaUrl } from '../avatars.ts';
import { groups } from '../groups/client.ts';
import { Store } from '../store.ts';
import { compareIds, mergeMessages, serverId, type Delivery } from '../messages.ts';
import { latency } from '../latency.ts';

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

class SocialClient {
  readonly store = new Store<SocialState>({ profiles: {}, notes: {}, notesLoaded: false, friends: null, blocks: null, conversations: null, messages: {} });
  /** Mensagem privada que chegou de outra pessoa (para aviso e som). */
  onIncoming: ((message: DmMessage, conversation: Conversation | undefined) => void) | null = null;
  #profileRequests = new Map<string, Promise<Profile>>();
  #accountId: string | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #loads = new Map<string, Promise<void>>();
  readonly #outbox = new Map<string, { dmId: string; accountId: string; input: DmInput; started: number }>();
  readonly #sending = new Map<string, Promise<DmMessage | undefined>>();
  #messageOrder = 0;

  constructor() {
    groups.onEvent((event) => this.#onEvent(event));
    groups.store.subscribe(() => {
      const accountId = groups.store.get().account?.id ?? null;
      if (accountId !== this.#accountId) {
        this.#accountId = accountId;
        this.#outbox.clear(); this.#sending.clear(); this.#loads.clear();
        avatarCache.clear(); this.#profileRequests.clear();
        if (accountId) void this.profile(accountId, true).catch(() => undefined);
      }
      // Saiu da conta: nada de outra conta fica na tela.
      if (groups.store.get().status !== 'dentro') {
        this.#profileRequests.clear();
        this.#outbox.clear();
        this.#sending.clear();
        this.#loads.clear();
        if (!Object.keys(this.store.get().profiles).length && !Object.keys(this.store.get().messages).length && this.store.get().friends === null) return;
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
    rememberAvatar(profile.id, profile.avatar);
    if (groups.store.get().account?.id === profile.id) groups.store.set(state => ({ account: state.account ? { ...state.account, avatar: profile.avatar, displayName: profile.displayName } : null }));
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
    const before = avatars.get().byUser;
    const [{ friends }, { blocks }] = await Promise.all([
      groups.call<{ friends: Friend[] }>('GET', '/api/friends'),
      groups.call<{ blocks: UserCard[] }>('GET', '/api/blocks'),
    ]);
    avatarCache.seed([...friends.map((item) => item.user), ...blocks]);
    this.store.set({ friends, blocks });
    rememberAvatars(friends.map(friend => ({ id: friend.user.id, image: friend.user.avatar })), before);
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
    const before = avatars.get().byUser;
    const { conversations } = await groups.call<{ conversations: Conversation[] }>('GET', '/api/dms');
    rememberAvatars(conversations.map(conversation => ({ id: conversation.user.id, image: conversation.user.avatar })), before);
    this.store.set({ conversations });
  }

  async openDm(userId: string): Promise<string> {
    const { id } = await groups.call<{ id: string }>('POST', '/api/dms', { userId });
    await this.loadConversations().catch(() => undefined);
    return id;
  }

  async loadMessages(dmId: string, older = false): Promise<void> {
    const key = `${dmId}:${older}`;
    const pending = this.#loads.get(key);
    if (pending) return pending;
    const job = this.#loadMessages(dmId, older).finally(() => this.#loads.delete(key));
    this.#loads.set(key, job);
    return job;
  }

  async #loadMessages(dmId: string, older: boolean): Promise<void> {
    const current = this.store.get().messages[dmId];
    if (older && current && !current.hasMore) return;
    const before = older ? current?.items.find(item => serverId(item.id))?.id : undefined;
    const { messages } = await groups.call<{ messages: DmMessage[] }>('GET', `/api/dms/${dmId}/messages${before ? `?before=${before}` : ''}`);
    this.#setMessages(dmId, {
      items: mergeMessages((this.store.get().messages[dmId]?.items ?? []).filter(item => older || !serverId(item.id) || compareIds(item.id, messages.at(-1)?.id ?? '0') > 0), messages),
      loaded: true,
      hasMore: messages.length >= 50,
    });
  }

  send(dmId: string, input: DmInput, files: DmAttachment[] = []): Promise<DmMessage | undefined> {
    const account = groups.store.get().account;
    if (!account) return Promise.reject(new Error('Entre na sua conta para enviar.'));
    const clientId = crypto.randomUUID();
    const started = performance.now();
    const reply = this.store.get().messages[dmId]?.items.find(item => item.id === input.replyTo);
    const message: DmMessage = {
      id: `local-${clientId}`, clientId, delivery: 'sending', localOrder: ++this.#messageOrder, dmId,
      author: { id: account.id, name: account.displayName, username: account.username },
      content: input.content ?? (input.invite ? 'Enviando convite…' : ''), createdAt: new Date().toISOString(), editedAt: null,
      reply: reply ? { id: reply.id, authorId: reply.author.id, authorName: reply.author.name, excerpt: reply.content.slice(0, 120) } : null,
      attachments: files, reactions: [], meta: null,
    };
    this.#outbox.set(clientId, { dmId, accountId: account.id, input, started });
    this.#setMessages(dmId, { items: mergeMessages(this.store.get().messages[dmId]?.items ?? [], [message]) });
    latency.record('message', 'optimistic', performance.now() - started);
    return this.retry(clientId);
  }

  retry(clientId: string): Promise<DmMessage | undefined> {
    const running = this.#sending.get(clientId);
    if (running) return running;
    const job = this.#outbox.get(clientId);
    if (!job || job.accountId !== groups.store.get().account?.id) return Promise.resolve(undefined);
    this.#setMessages(job.dmId, { items: (this.store.get().messages[job.dmId]?.items ?? []).map(item => item.clientId === clientId ? { ...item, delivery: 'sending', deliveryError: undefined } : item) });
    const pending = (async () => {
      try {
        const { message } = await groups.call<{ message: DmMessage }>('POST', `/api/dms/${job.dmId}/messages`, { ...job.input, clientId });
        if (job.accountId !== groups.store.get().account?.id) return;
        this.#upsert({ ...message, clientId: message.clientId ?? clientId });
        latency.record('message', 'ack', performance.now() - job.started);
        return message;
      } catch (error) {
        if (!this.#outbox.has(clientId) || job.accountId !== groups.store.get().account?.id) return;
        this.#setMessages(job.dmId, { items: (this.store.get().messages[job.dmId]?.items ?? []).map(item => item.clientId === clientId ? { ...item, delivery: 'failed', deliveryError: error instanceof Error ? error.message : 'Falha ao enviar.' } : item) });
      } finally { this.#sending.delete(clientId); }
    })();
    this.#sending.set(clientId, pending);
    return pending;
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
    if (!serverId(messageId)) return;
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
    if (message.clientId && message.author.id === groups.store.get().account?.id) this.#outbox.delete(message.clientId);
    if (!current) return;
    const items = mergeMessages(current.items, [message]);
    if (items.length === current.items.length && items.every((item, index) => item === current.items[index])) return;
    this.#setMessages(message.dmId, { items });
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
        if ('avatar' in event) rememberAvatar(event.userId, event.avatar);
        if (event.userId === me && !this.store.get().profiles[event.userId as string]) void this.profile(event.userId, true).catch(() => undefined);
        if (this.store.get().profiles[event.userId as string]) void this.profile(event.userId as string, true).catch(() => undefined);
        if (this.store.get().friends) void this.loadFriends().catch(() => undefined);
        break;
      case 'note.changed':
        void this.loadNotes().catch(() => undefined);
        break;
      case 'ready':
        // Reconectou: o que mudou enquanto estava fora volta a ser lido.
        if (this.store.get().conversations) this.#scheduleConversations();
        for (const [dmId, state] of Object.entries(this.store.get().messages)) if (state.loaded) void this.loadMessages(dmId).catch(() => undefined);
        break;
    }
  }
}

export const social = new SocialClient();

type DmInput = { content?: string; replyTo?: string; attachments?: string[]; invite?: { groupId: string } };
