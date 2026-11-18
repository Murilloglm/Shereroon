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

export type NotifyLevel = 'tudo' | 'mencoes' | 'nada';

export interface NotifySettings {
  level: NotifyLevel;
  channels: Record<string, NotifyLevel>;
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  isPublic: boolean;
  ownerId: string;
  /** Tem novidade para esta conta (já descontado o que ela silenciou). */
  unread?: boolean;
  mentions?: number;
  notify?: NotifySettings;
}

export interface UnreadState {
  last: string | null;
  read: string | null;
  mentions: number;
  /** Mensagens novas de outras pessoas (até 100). */
  count?: number;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface RoleView {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: bigint;
  isEveryone: boolean;
  /** Cargo próprio de um bot (só muda pela Central de Bots). */
  botId?: string | null;
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
  /** Canal de voz com chat temporário: as mensagens somem quando o último sai. */
  temporaryChat?: boolean;
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
  /** Conta de bot instalada no grupo. */
  bot?: boolean;
  /** 'padrao:<n>' ou 'arquivo:<id>' (null = iniciais). */
  avatar?: string | null;
  /** Só bots: como aparece na lista de membros. */
  botList?: 'mostrar' | 'ocultar' | 'categoria';
}

export interface GroupView {
  group: GroupSummary;
  me: { userId: string; isOwner: boolean; roleIds: string[]; permissions: bigint; top: number | null; timeoutUntil: string | null };
  roles: RoleView[];
  channels: ChannelView[];
  members: MemberView[];
  voice: Record<string, string[]>;
  /** Por canal de texto: última mensagem, até onde esta conta leu e menções pendentes. */
  unread: Record<string, UnreadState>;
  notify: NotifySettings;
  /** Emojis próprios do grupo. */
  emojis?: { id: string; name: string; animated: boolean }[];
}

export interface ChatMessage {
  id: string;
  channelId: string;
  author: { id: string | null; name: string; username: string | null; bot?: boolean };
  content: string;
  /** Complementos de mensagens de bots: botões que enviam um comando como se a pessoa tivesse digitado. */
  meta?: {
    buttons?: { label: string; command: string; style?: 'primario' | 'perigo' }[];
    /** Destaques Cósmicos: mensagem em destaque pedida por um membro, e efeito visual. Só bots publicam. */
    style?: 'destaque';
    highlightOf?: string;
    effect?: 'confete' | 'estrelas' | 'aurora';
  } | null;
  mentionEveryone: boolean;
  pinned: boolean;
  createdAt: string;
  editedAt: string | null;
  reply: { id: string; authorId: string | null; authorName: string; excerpt: string } | null;
  mentions: string[];
  attachments: Attachment[];
  reactions: { emoji: string; users: string[] }[];
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
  /** Tamanho máximo de um arquivo, informado pelo servidor. */
  maxFileBytes: number;
}

/** Uma mensagem que chegou de outra pessoa, para quem cuida dos avisos (notificação e som). */
export interface Incoming {
  groupId: string;
  message: ChatMessage;
  /** Esta conta foi mencionada (pelo nome ou por @everyone). */
  mentioned: boolean;
  level: NotifyLevel;
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
    unread: raw.unread ?? {},
    notify: raw.notify ?? { level: 'tudo', channels: {} },
    emojis: raw.emojis ?? [],
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
    maxFileBytes: 10 * 1024 * 1024,
  });
  onVoiceSignal: ((signal: VoiceSignal) => void) | null = null;
  onIncoming: ((incoming: Incoming) => void) | null = null;

  #token: string | null = readToken();
  #socket: WebSocket | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #started: Promise<void> | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #openChannel: string | null = null;
  #groupsTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #reading = new Map<string, string>();
  readonly #fileUrls = new Map<string, Promise<string>>();

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
      const features = await request<{ groups: boolean; maxFileBytes?: number }>('GET', '/api/features', { timeoutMs: 70_000 });
      if (!features.groups) return this.store.set({ status: 'indisponivel' });
      if (features.maxFileBytes) this.store.set({ maxFileBytes: features.maxFileBytes });
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

  async updateProfile(displayName: string): Promise<void> {
    const { user } = await this.call<{ user: Account }>('PATCH', '/api/auth/me', { displayName });
    this.store.set({ account: user });
    await this.refreshView();
  }

  /** Relê a conta (nome) e o grupo aberto depois de mudar o perfil por outra rota. */
  async refreshAccount(): Promise<void> {
    const { user } = await this.call<{ user: Account }>('GET', '/api/auth/me');
    this.store.set({ account: user });
    await this.refreshView().catch(() => undefined);
  }

  /** Troca a senha. O servidor encerra as outras sessões e devolve uma nova para este aparelho. */
  async changePassword(current: string, next: string): Promise<void> {
    const { token } = await this.call<{ token: string }>('POST', '/api/auth/password', { current, next });
    this.#token = token;
    writeToken(token);
    this.#disconnect();
    this.#connect();
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
    this.#forgetFiles();
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

  async send(channelId: string, content: string, extra: { replyTo?: string; attachments?: string[] } = {}): Promise<void> {
    const { message } = await this.call<{ message: ChatMessage }>('POST', `/api/channels/${channelId}/messages`, { content, ...extra });
    this.#upsert(message);
    this.#sawMessage(message, this.store.get().view?.group.id ?? '');
  }

  async react(message: ChatMessage, emoji: string, on: boolean): Promise<void> {
    this.#upsert((await this.call<{ message: ChatMessage }>(on ? 'PUT' : 'DELETE', `/api/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`)).message);
  }

  /** Mensagens fixadas do canal, direto do servidor (não só as que já estão carregadas na tela). */
  async pinned(channelId: string): Promise<ChatMessage[]> {
    return (await this.call<{ messages: ChatMessage[] }>('GET', `/api/channels/${channelId}/messages?pinned=1&limit=100`)).messages;
  }

  // --- Arquivos ---------------------------------------------------------------------------

  /** Envia um arquivo para o canal. Ele só aparece para os outros quando a mensagem for enviada. */
  upload(channelId: string, file: File, size: { width: number; height: number } | null, onProgress: (fraction: number) => void): { done: Promise<Attachment>; cancel: () => void } {
    const query = new URLSearchParams({ name: file.name, ...(size ? { w: String(size.width), h: String(size.height) } : {}) });
    return this.uploadTo<Attachment>(`/api/channels/${channelId}/files?${query}`, file, onProgress);
  }

  /** Envia um arquivo cru (com progresso) para uma rota que responde `{ file }` (ou `{ profile }`). */
  uploadTo<T>(path: string, file: File, onProgress: (fraction: number) => void, key: 'file' | 'profile' = 'file'): { done: Promise<T>; cancel: () => void } {
    const xhr = new XMLHttpRequest();
    const done = new Promise<T>((resolve, reject) => {
      xhr.open('POST', `${API_BASE}${path}`);
      xhr.setRequestHeader('authorization', `Bearer ${this.#token ?? ''}`);
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      xhr.responseType = 'json';
      xhr.timeout = 10 * 60_000;
      xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
      xhr.onload = () => {
        const data = xhr.response as ({ error?: { code?: string; message?: string } } & Record<string, unknown>) | null;
        if (xhr.status === 200 && data?.[key]) return resolve(data[key] as T);
        if (data?.error?.code === 'sessao_invalida') this.#signedOut();
        reject(new ApiError(data?.error?.code ?? 'erro', data?.error?.message ?? `O servidor respondeu com erro ${xhr.status}.`, xhr.status));
      };
      xhr.onerror = () => reject(new ApiError('sem_conexao', 'Não foi possível enviar o arquivo. Confira sua internet e tente de novo.', 0));
      xhr.ontimeout = () => reject(new ApiError('sem_conexao', 'O envio do arquivo demorou demais.', 0));
      xhr.onabort = () => reject(new ApiError('cancelado', 'Envio cancelado.', 0));
      xhr.send(file);
    });
    return { done, cancel: () => xhr.abort() };
  }

  /**
   * Endereço local (blob:) de um arquivo do chat. O arquivo é baixado com a sessão da conta, então o
   * servidor confere a permissão a cada leitura; o resultado fica guardado enquanto a página estiver aberta.
   */
  fileUrl(fileId: string): Promise<string> {
    return this.blobUrl(`/api/files/${fileId}`);
  }

  /** Endereço local (blob:) de qualquer arquivo baixado com a sessão da conta, guardado enquanto a página está aberta. */
  blobUrl(path: string): Promise<string> {
    let pending = this.#fileUrls.get(path);
    if (!pending) {
      pending = (async () => {
        const response = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${this.#token ?? ''}` }, credentials: 'omit' });
        if (!response.ok) throw new ApiError('arquivo_inexistente', 'Este arquivo não está mais disponível.', response.status);
        return URL.createObjectURL(await response.blob());
      })();
      this.#fileUrls.set(path, pending);
      pending.catch(() => this.#fileUrls.delete(path));
    }
    return pending;
  }

  readonly #eventListeners = new Set<(event: Record<string, any>) => void>();

  /** Recebe todos os eventos de tempo real (amizades e mensagens privadas são tratadas fora daqui). */
  onEvent(listener: (event: Record<string, any>) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  #forgetFiles(): void {
    for (const pending of this.#fileUrls.values()) void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
    this.#fileUrls.clear();
  }

  // --- Não lidas e notificações -------------------------------------------------------------

  /** Avisa o servidor de que a conta leu o canal até esta mensagem. Chamadas repetidas viram uma só. */
  markRead(channelId: string, messageId: string | undefined): void {
    const view = this.store.get().view;
    const state = view?.unread[channelId];
    if (!view || !messageId || (this.#reading.get(channelId) ?? state?.read ?? '0') === messageId) return;
    if (Number(messageId) <= Number(this.#reading.get(channelId) ?? state?.read ?? 0)) return;
    this.#reading.set(channelId, messageId);
    this.store.set({ view: { ...view, unread: { ...view.unread, [channelId]: { last: state?.last ?? messageId, read: messageId, mentions: 0, count: 0 } } } });
    void this.call('POST', `/api/channels/${channelId}/read`, { messageId })
      .then(() => this.#scheduleGroups())
      .catch(() => this.#reading.delete(channelId));
  }

  async setNotify(groupId: string, level: NotifyLevel | null, channelId?: string): Promise<void> {
    await this.call('PUT', `/api/groups/${groupId}/notify`, { level, ...(channelId ? { channelId } : {}) });
    await Promise.all([this.refreshView(), this.refreshGroups().catch(() => undefined)]);
  }

  /** Nível que vale para um canal: o do canal, se a conta escolheu um; senão, o do grupo. */
  levelFor(groupId: string, channelId: string): NotifyLevel {
    const state = this.store.get();
    const settings = state.view?.group.id === groupId ? state.view.notify : state.groups.find((group) => group.id === groupId)?.notify;
    return settings?.channels[channelId] ?? settings?.level ?? 'tudo';
  }

  #scheduleGroups(): void {
    if (this.#groupsTimer) return;
    this.#groupsTimer = setTimeout(() => {
      this.#groupsTimer = null;
      void this.refreshGroups().catch(() => undefined);
    }, 800);
  }

  /** Atualiza o "não lido" do canal com uma mensagem que acabou de chegar (ou que esta conta enviou). */
  #sawMessage(message: ChatMessage, groupId: string): void {
    const state = this.store.get();
    const me = state.account?.id;
    const own = message.author.id === me;
    const mentioned = !own && (message.mentionEveryone || (me !== undefined && message.mentions.includes(me)));
    const view = state.view;
    if (view && view.group.id === groupId && view.channels.some((channel) => channel.id === message.channelId)) {
      const before = view.unread[message.channelId] ?? { last: null, read: null, mentions: 0, count: 0 };
      if (Number(message.id) > Number(before.last ?? 0)) {
        if (own) this.#reading.set(message.channelId, message.id);
        this.store.set({
          view: { ...view, unread: { ...view.unread, [message.channelId]: { last: message.id, read: own ? message.id : before.read, mentions: own ? 0 : before.mentions + (mentioned ? 1 : 0), count: own ? 0 : Math.min(100, (before.count ?? 0) + 1) } } },
        });
      }
    }
    this.#scheduleGroups();
    if (!own) this.onIncoming?.({ groupId, message, mentioned, level: this.levelFor(groupId, message.channelId) });
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
    for (const listener of this.#eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(error);
      }
    }
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
        this.#upsert(event.message as ChatMessage);
        this.#sawMessage(event.message as ChatMessage, event.groupId as string);
        break;
      case 'message.updated':
        this.#upsert(event.message as ChatMessage);
        break;
      case 'channel.cleared': {
        // Chat temporário de um canal de voz que esvaziou: as mensagens sumiram para todos.
        const id = event.channelId as string;
        if (this.store.get().messages[id]?.loaded) this.#setMessages(id, { items: [] });
        this.#scheduleGroups();
        break;
      }
      case 'message.deleted':
        this.#drop(event.channelId as string, event.id as string);
        this.#scheduleGroups();
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
