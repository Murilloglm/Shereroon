/**
 * Tempo real dos grupos: quem está conectado, em que canal de voz está, e a entrega de eventos só para quem
 * pode vê-los. Não conhece WebSocket nem banco: recebe conexões já autenticadas e publica eventos.
 * Vive na memória de uma instância do backend (com mais de uma instância seria preciso um barramento comum).
 */

export interface GatewayEvent {
  t: string;
  [key: string]: unknown;
}

export interface Transport {
  send(text: string): void;
  close(): void;
}

export interface Connection {
  readonly userId: string;
  readonly transport: Transport;
}

export interface VoicePlace {
  groupId: string;
  channelId: string;
}

export class Hub {
  readonly #connections = new Map<string, Set<Connection>>();
  /** Grupos de cada pessoa conectada e, ao contrário, pessoas conectadas de cada grupo. */
  readonly #groupsOf = new Map<string, Set<string>>();
  readonly #onlineIn = new Map<string, Set<string>>();
  readonly #voice = new Map<string, VoicePlace>();
  readonly #voiceGrace = new Map<string, ReturnType<typeof setTimeout>>();
  /** Chamado quando alguém sai de um canal de voz porque a conexão caiu (para tirar a pessoa do SFU). */
  onVoiceDropped: ((userId: string, place: VoicePlace) => void) | null = null;
  /** Avisa toda entrada e saída de canal de voz (para os bots). */
  onVoiceChanged: ((userId: string, before: VoicePlace | null, after: VoicePlace | null) => void) | null = null;
  /** Quem pode ver um canal? Fornecido pelo serviço de grupos; sem isso, eventos de canal não saem. */
  canSeeChannel: ((groupId: string, channelId: string, userId: string) => Promise<boolean>) | null = null;

  open(userId: string, groupIds: readonly string[], transport: Transport): Connection {
    const grace = this.#voiceGrace.get(userId);
    if (grace) clearTimeout(grace);
    this.#voiceGrace.delete(userId);
    const connection: Connection = { userId, transport };
    const first = !this.#connections.has(userId);
    if (first) this.#connections.set(userId, new Set());
    this.#connections.get(userId)!.add(connection);
    if (first) {
      this.#groupsOf.set(userId, new Set());
      for (const groupId of groupIds) this.subscribe(userId, groupId);
    }
    return connection;
  }

  close(connection: Connection, voiceGraceMs = 0): void {
    const set = this.#connections.get(connection.userId);
    if (!set?.delete(connection) || set.size > 0) return;
    // Era a última conexão da pessoa: ela fica offline e sai do canal de voz.
    this.#connections.delete(connection.userId);
    const place = this.#voice.get(connection.userId);
    if (place) {
      const drop = () => {
        this.#voiceGrace.delete(connection.userId);
        if (this.#voice.get(connection.userId) !== place) return;
        void this.setVoice(connection.userId, null);
        this.onVoiceDropped?.(connection.userId, place);
      };
      if (voiceGraceMs > 0) {
        const timer = setTimeout(drop, voiceGraceMs);
        timer.unref?.();
        this.#voiceGrace.set(connection.userId, timer);
      } else drop();
    }
    for (const groupId of this.#groupsOf.get(connection.userId) ?? []) {
      this.#onlineIn.get(groupId)?.delete(connection.userId);
      this.publish(groupId, { t: 'presence', groupId, userId: connection.userId, online: false });
    }
    this.#groupsOf.delete(connection.userId);
  }

  isOnline(userId: string): boolean {
    return this.#connections.has(userId);
  }

  online(groupId: string): string[] {
    return [...(this.#onlineIn.get(groupId) ?? [])];
  }

  /** A pessoa entrou num grupo (ou acabou de conectar): passa a receber os eventos dele. */
  subscribe(userId: string, groupId: string): void {
    const groups = this.#groupsOf.get(userId);
    if (!groups || groups.has(groupId)) return;
    groups.add(groupId);
    if (!this.#onlineIn.has(groupId)) this.#onlineIn.set(groupId, new Set());
    this.#onlineIn.get(groupId)!.add(userId);
    this.publish(groupId, { t: 'presence', groupId, userId, online: true });
  }

  unsubscribe(userId: string, groupId: string): void {
    if (!this.#groupsOf.get(userId)?.delete(groupId)) return;
    this.#onlineIn.get(groupId)?.delete(userId);
    if (this.#voice.get(userId)?.groupId === groupId) void this.setVoice(userId, null);
    this.publish(groupId, { t: 'presence', groupId, userId, online: false });
  }

  dropGroup(groupId: string): void {
    for (const userId of this.online(groupId)) {
      this.#groupsOf.get(userId)?.delete(groupId);
      if (this.#voice.get(userId)?.groupId === groupId) this.#voice.delete(userId);
    }
    this.#onlineIn.delete(groupId);
  }

  /** Evento para todos os conectados do grupo. */
  publish(groupId: string, event: GatewayEvent): void {
    const text = JSON.stringify(event);
    for (const userId of this.#onlineIn.get(groupId) ?? []) this.#deliver(userId, text);
  }

  /** Evento de um canal: só chega a quem pode ver aquele canal. */
  async publishToChannel(groupId: string, channelId: string, event: GatewayEvent): Promise<void> {
    const check = this.canSeeChannel;
    if (!check) return;
    const text = JSON.stringify(event);
    await Promise.all(
      this.online(groupId).map(async (userId) => {
        if (await check(groupId, channelId, userId).catch(() => false)) this.#deliver(userId, text);
      }),
    );
  }

  toUser(userId: string, event: GatewayEvent): void {
    this.#deliver(userId, JSON.stringify(event));
  }

  voiceOf(userId: string): VoicePlace | null {
    return this.#voice.get(userId) ?? null;
  }

  /** Todos que estão em algum canal de voz agora. */
  voiceAll(): [string, VoicePlace][] {
    return [...this.#voice.entries()];
  }

  /** Canal de voz → pessoas dentro dele, para um grupo. */
  voiceIn(groupId: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [userId, place] of this.#voice) {
      if (place.groupId === groupId) (out[place.channelId] ??= []).push(userId);
    }
    return out;
  }

  /** Registra em que canal de voz a pessoa está (null = saiu) e avisa quem pode ver o canal. */
  async setVoice(userId: string, place: VoicePlace | null): Promise<void> {
    const before = this.#voice.get(userId) ?? null;
    if (before?.channelId === place?.channelId) return;
    if (place) this.#voice.set(userId, place);
    else this.#voice.delete(userId);
    this.onVoiceChanged?.(userId, before, place);
    if (before) await this.publishToChannel(before.groupId, before.channelId, { t: 'voice', groupId: before.groupId, channelId: before.channelId, userId, joined: false });
    if (place) await this.publishToChannel(place.groupId, place.channelId, { t: 'voice', groupId: place.groupId, channelId: place.channelId, userId, joined: true });
  }

  /** Derruba as conexões da pessoa (sessão encerrada, por exemplo). */
  kick(userId: string): void {
    const grace = this.#voiceGrace.get(userId);
    if (grace) clearTimeout(grace);
    this.#voiceGrace.delete(userId);
    const place = this.#voice.get(userId);
    if (place) { void this.setVoice(userId, null); this.onVoiceDropped?.(userId, place); }
    for (const connection of [...(this.#connections.get(userId) ?? [])]) connection.transport.close();
  }

  #deliver(userId: string, text: string): void {
    for (const connection of this.#connections.get(userId) ?? []) {
      try {
        connection.transport.send(text);
      } catch {
        // conexão morrendo: o fechamento cuida da limpeza
      }
    }
  }
}
