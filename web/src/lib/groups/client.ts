/**
 * Cliente dos grupos: conta, lista de grupos, o grupo aberto, mensagens e o canal de tempo real.
 * A interface só reflete o que o backend responde; nenhuma permissão é decidida aqui.
 */
import { API_BASE, ApiError, request } from '../api.ts';
import { Store } from '../store.ts';

export interface Account {
  id: string;
  username: string;
  displayName: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  isPublic: boolean;
  ownerId: string;
}

export interface RoleView {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: bigint;
  isEveryone: boolean;
  memberCount: number;
}

export type ChannelKind = 'categoria' | 'texto' | 'voz';

export interface ChannelView {
  id: string;
  kind: ChannelKind;
  name: string;
  topic: string;
  parentId: string | null;
  position: number;
  userLimit: number;
  private: boolean;
  /** Permissões desta conta neste canal, já calculadas pelo backend. */
  permissions: bigint;
}

export interface MemberView {
  userId: string;
  username: string;
  displayName: string;
  nickname: string | null;
  roleIds: string[];
  joinedAt: string;
  timeoutUntil: string | null;
  online: boolean;
}

export interface GroupView {
  group: GroupSummary;
  me: { userId: string; isOwner: boolean; roleIds: string[]; permissions: bigint; top: number | null; timeoutUntil: string | null };
  roles: RoleView[];
  channels: ChannelView[];
  members: MemberView[];
  voice: Record<string, string[]>;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  author: { id: string | null; name: string; username: string | null };
  content: string;
  mentionEveryone: boolean;
  pinned: boolean;
  createdAt: string;
  editedAt: string | null;
}

export interface ChannelMessages {
  items: ChatMessage[];
  loading: boolean;
  /** Já chegou ao começo da conversa. */
  complete: boolean;
  loaded: boolean;
}

export interface GroupsState {
  status: 'verificando' | 'indisponivel' | 'fora' | 'dentro';
  account: Account | null;
  groups: GroupSummary[];
  view: GroupView | null;
  viewLoading: boolean;
  messages: Record<string, ChannelMessages>;
  /** O canal de tempo real está conectado. */
  live: boolean;
  notice: string | null;
}

/** Avisos de voz dirigidos a esta conta (um moderador agiu sobre ela). */
export interface VoiceSignal {
  type: 'muted' | 'move' | 'disconnected' | 'stream_stopped' | 'rights';
  groupId: string;
  channelId: string;
  by?: string;
}

const TOKEN_KEY = 'shareroom:conta';
const EMPTY: ChannelMessages = { items: [], loading: false, complete: false, loaded: false };

const bigintFields = <T extends { permissions: string }>(item: T) => ({ ...item, permissions: BigInt(item.permissions) });

function toView(raw: any): GroupView {
  return {
    group: raw.group,
    me: { ...raw.me, permissions: BigInt(raw.me.permissions) },
    roles: raw.roles.map(bigintFields),
    channels: raw.channels.map(bigintFields),
    members: raw.members,
    voice: raw.voice ?? {},
  };
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // armazenamento bloqueado: a sessão dura só enquanto a aba estiver aberta
  }
}

export class GroupsClient {
  readonly store = new Store<GroupsState>({
    status: 'verificando',
    account: null,
    groups: [],
    view: null,
    viewLoading: false,
    messages: {},
    live: false,
    notice: null,
  });
  onVoiceSignal: ((signal: VoiceSignal) => void) | null = null;

  #token: string | null = readToken();
  #socket: WebSocket | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #started: Promise<void> | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #openChannel: string | null = null;

  /** Chamada autenticada. Sessão vencida derruba para a tela de entrada. */
  async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await request<T>(method, path, { body: body === undefined && method !== 'GET' && method !== 'DELETE' ? {} : body, token: this.#token });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'sessao_invalida') this.#signedOut();
      throw error;
    }
  }

  /** Descobre se o servidor tem grupos e se já há uma sessão guardada. Pode ser chamado várias vezes. */
  start(): Promise<void> {
    this.#started ??= this.#start().finally(() => {
      if (this.store.get().status === 'verificando') this.#started = null;
    });
    return this.#started;
  }

  async #start(): Promise<void> {
    try {
      const features = await request<{ groups: boolean }>('GET', '/api/features', { timeoutMs: 70_000 });
      if (!features.groups) return this.store.set({ status: 'indisponivel' });
    } catch (error) {
      // Servidor antigo (sem a rota) ou fora do ar: sem grupos por enquanto.
      this.store.set({ status: 'indisponivel', notice: error instanceof ApiError && error.status === 0 ? error.message : null });
      this.#started = null;
      return;
    }
    if (!this.#token) return this.store.set({ status: 'fora' });
    try {
      const { user } = await request<{ user: Account }>('GET', '/api/auth/me', { token: this.#token });
      await this.#signedIn(user);
    } catch {
      this.#signedOut();
    }
  }

  async register(input: { username: string; displayName: string; password: string }): Promise<void> {
    const result = await request<{ user: Account; token: string }>('POST', '/api/auth/register', { body: input });
    this.#token = result.token;
    writeToken(result.token);
    await this.#signedIn(result.user);
  }

  async login(input: { username: string; password: string }): Promise<void> {
    const result = await request<{ user: Account; token: string }>('POST', '/api/auth/login', { body: input });
    this.#token = result.token;
    writeToken(result.token);
    await this.#signedIn(result.user);
  }

  async logout(): Promise<void> {
    const token = this.#token;
    this.#signedOut();
    if (token) await request('POST', '/api/auth/logout', { body: {}, token }).catch(() => undefined);
  }

  async #signedIn(account: Account): Promise<void> {
    this.store.set({ status: 'dentro', account });
    await this.refreshGroups();
    this.#connect();
  }

  #signedOut(): void {
    this.#token = null;
    writeToken(null);
    this.#disconnect();
    this.store.set({ status: this.store.get().status === 'indisponivel' ? 'indisponivel' : 'fora', account: null, groups: [], view: null, messages: {}, live: false });
  }

  clearNotice(): void {
    this.store.set({ notice: null });
  }

  notify(message: string): void {
    this.store.set({ notice: message });
  }

  // --- Grupos -----------------------------------------------------------------------------

  async refreshGroups(): Promise<void> {
    const { groups } = await this.call<{ groups: GroupSummary[] }>('GET', '/api/groups');
    this.store.set({ groups });
  }

  /** Abre um grupo (carrega o que esta conta pode ver dele). */
  async openGroup(groupId: string): Promise<void> {
    if (this.store.get().view?.group.id !== groupId) this.store.set({ view: null, viewLoading: true });
    try {
      const view = toView(await this.call('GET', `/api/groups/${groupId}`));
      this.store.set({ view, viewLoading: false });
    } catch (error) {
      this.store.set({ view: null, viewLoading: false });
      throw error;
    }
  }

  closeGroup(): void {
    this.store.set({ view: null });
    this.#openChannel = null;
  }

  async refreshView(): Promise<void> {
    const groupId = this.store.get().view?.group.id;
    if (!groupId) return;
    try {
      const view = toView(await this.call('GET', `/api/groups/${groupId}`));
      if (this.store.get().view?.group.id === groupId) this.store.set({ view });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.set({ view: null });
    }
  }

  /** Várias mudanças seguidas (reordenar cargos, por exemplo) viram uma leitura só. */
  #scheduleRefresh(): void {
    if (this.#refreshTimer) return;
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.refreshView();
      void this.refreshGroups().catch(() => undefined);
    }, 120);
  }

  /** Faz uma alteração no grupo e já atualiza a tela (sem esperar o aviso de tempo real). */
  async change<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const result = await this.call<T>(method, path, body);
    await Promise.all([this.refreshView(), this.refreshGroups().catch(() => undefined)]);
    return result;
  }

  // --- Mensagens --------------------------------------------------------------------------

  messagesOf(channelId: string): ChannelMessages {
    return this.store.get().messages[channelId] ?? EMPTY;
  }

  #setMessages(channelId: string, patch: Partial<ChannelMessages>): void {
    this.store.set((state) => ({ messages: { ...state.messages, [channelId]: { ...(state.messages[channelId] ?? EMPTY), ...patch } } }));
  }

  /** Marca qual canal de texto está na tela (para recarregar depois de uma queda de conexão). */
  watchChannel(channelId: string | null): void {
    this.#openChannel = channelId;
  }

  async loadMessages(channelId: string, older = false): Promise<void> {
    const current = this.messagesOf(channelId);
    if (current.loading || (older && current.complete)) return;
    this.#setMessages(channelId, { loading: true });
    try {
      const before = older ? current.items[0]?.id : undefined;
      const { messages } = await this.call<{ messages: ChatMessage[] }>('GET', `/api/channels/${channelId}/messages?limit=50${before ? `&before=${before}` : ''}`);
      const latest = this.messagesOf(channelId);
      // Junta com o que chegou em tempo real enquanto a página carregava.
      const byId = new Map<string, ChatMessage>();
      for (const message of [...messages, ...(older ? latest.items : latest.items.filter((item) => Number(item.id) > Number(messages.at(-1)?.id ?? 0)))]) byId.set(message.id, message);
      this.#setMessages(channelId, {
        items: [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id)),
        loading: false,
        loaded: true,
        complete: older ? messages.length < 50 : latest.complete || messages.length < 50,
      });
    } catch (error) {
      this.#setMessages(channelId, { loading: false });
      throw error;
    }
  }

  async send(channelId: string, content: string): Promise<void> {
    const { message } = await this.call<{ message: ChatMessage }>('POST', `/api/channels/${channelId}/messages`, { content });
    this.#upsert(message);
  }

  async edit(messageId: string, content: string): Promise<void> {
    this.#upsert((await this.call<{ message: ChatMessage }>('PATCH', `/api/messages/${messageId}`, { content })).message);
  }

  async remove(message: ChatMessage): Promise<void> {
    await this.call('DELETE', `/api/messages/${message.id}`);
    this.#drop(message.channelId, message.id);
  }

  async pin(messageId: string, pinned: boolean): Promise<void> {
    this.#upsert((await this.call<{ message: ChatMessage }>('POST', `/api/messages/${messageId}/pin`, { pinned })).message);
  }

  #upsert(message: ChatMessage): void {
    const current = this.store.get().messages[message.channelId];
    if (!current?.loaded) return;
    const items = current.items.some((item) => item.id === message.id) ? current.items.map((item) => (item.id === message.id ? message : item)) : [...current.items, message];
    this.#setMessages(message.channelId, { items });
  }

  #drop(channelId: string, id: string): void {
    const current = this.store.get().messages[channelId];
    if (current?.loaded) this.#setMessages(channelId, { items: current.items.filter((item) => item.id !== id) });
  }

  // --- Tempo real -------------------------------------------------------------------------

  #connect(): void {
    if (this.#socket || !this.#token) return;
    const base = API_BASE ? new URL(API_BASE) : new URL(window.location.href);
    const url = `${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}/api/gateway`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      return this.#scheduleReconnect();
    }
    this.#socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ t: 'auth', token: this.#token }));
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        this.#onEvent(JSON.parse(event.data) as Record<string, any>);
      } catch (error) {
        console.error('evento de tempo real inválido', error);
      }
    };
    socket.onclose = (event) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.store.set({ live: false });
      // 4401/4403: a sessão não vale mais. Os outros fechamentos são queda de rede: tenta de novo.
      if (event.code === 4401 || event.code === 4403) {
        if (this.#token) void request('GET', '/api/auth/me', { token: this.#token }).catch(() => this.#signedOut());
      }
      if (this.#token) this.#scheduleReconnect();
    };
    socket.onerror = () => undefined;
  }

  #scheduleReconnect(): void {
    if (this.#retry) return;
    const wait = Math.min(15_000, 1000 * 2 ** Math.min(this.#attempt++, 4));
    this.#retry = setTimeout(() => {
      this.#retry = null;
      this.#connect();
    }, wait);
  }

  #disconnect(): void {
    if (this.#retry) clearTimeout(this.#retry);
    this.#retry = null;
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
  }

  #onEvent(event: Record<string, any>): void {
    const view = this.store.get().view;
    switch (event.t) {
      case 'ready': {
        const again = this.#attempt > 0;
        this.#attempt = 0;
        this.store.set({ live: true });
        if (again) {
          // Voltou de uma queda: busca o que mudou enquanto estava fora.
          this.#scheduleRefresh();
          if (this.#openChannel) void this.loadMessages(this.#openChannel).catch(() => undefined);
        }
        break;
      }
      case 'group.changed':
        this.#scheduleRefresh();
        break;
      case 'group.removed': {
        const group = this.store.get().groups.find((item) => item.id === event.groupId);
        const why = event.reason === 'banido' ? 'Você foi banido de' : event.reason === 'expulso' ? 'Você foi removido de' : event.reason === 'excluido' ? 'O dono excluiu' : null;
        this.store.set((state) => ({
          groups: state.groups.filter((item) => item.id !== event.groupId),
          view: state.view?.group.id === event.groupId ? null : state.view,
          notice: why && group ? `${why} “${group.name}”.` : state.notice,
        }));
        break;
      }
      case 'presence':
        if (view && view.group.id === event.groupId) {
          if (!view.members.some((member) => member.userId === event.userId)) this.#scheduleRefresh();
          else this.store.set({ view: { ...view, members: view.members.map((member) => (member.userId === event.userId ? { ...member, online: event.online === true } : member)) } });
        }
        break;
      case 'voice':
        if (view && view.group.id === event.groupId) {
          const voice = { ...view.voice };
          // A pessoa está em um canal por vez.
          for (const channelId of Object.keys(voice)) voice[channelId] = voice[channelId]!.filter((userId) => userId !== event.userId);
          if (event.joined) voice[event.channelId] = [...(voice[event.channelId] ?? []), event.userId];
          this.store.set({ view: { ...view, voice } });
        }
        break;
      case 'message.created':
      case 'message.updated':
        this.#upsert(event.message as ChatMessage);
        break;
      case 'message.deleted':
        this.#drop(event.channelId as string, event.id as string);
        break;
      case 'voice.muted':
      case 'voice.move':
      case 'voice.disconnected':
      case 'voice.stream_stopped':
      case 'voice.rights':
        this.onVoiceSignal?.({ type: event.t.slice(6) as VoiceSignal['type'], groupId: event.groupId, channelId: event.channelId, by: event.by });
        break;
    }
  }
}

/** Uma instância só para a página inteira. */
export const groups = new GroupsClient();
