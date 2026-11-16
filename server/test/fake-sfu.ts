import type { PublishedTrack, PublishRights, RoomSnapshot, RoomState, Sfu, TokenRequest, VoiceTokenRequest } from '../src/sfu.ts';

interface FakeRoom {
  capacity: number;
  state: RoomState;
  participants: Set<string>;
}

/** SFU em memória para os testes de unidade: mesma interface, nenhum processo externo. */
export class FakeSfu implements Sfu {
  readonly rooms = new Map<string, FakeRoom>();
  readonly tokens: TokenRequest[] = [];
  failNext = false;

  #guard(): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('SFU fora do ar (simulado)');
    }
  }

  async snapshot(room: string): Promise<RoomSnapshot> {
    this.#guard();
    const found = this.rooms.get(room);
    if (!found) return { exists: false, participants: 0, state: { locked: false, banned: [] } };
    return { exists: true, participants: found.participants.size, state: structuredClone(found.state) };
  }

  async ensureRoom(room: string, capacity: number): Promise<void> {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, { capacity, state: { locked: false, banned: [] }, participants: new Set() });
    }
  }

  async saveState(room: string, state: RoomState): Promise<void> {
    const found = this.rooms.get(room);
    if (!found) throw new Error('sala inexistente');
    found.state = structuredClone(state);
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    this.rooms.get(room)?.participants.delete(identity);
    this.tracks.delete(FakeSfu.key(room, identity));
  }

  async closeRoom(room: string): Promise<void> {
    this.rooms.delete(room);
  }

  async createToken(request: TokenRequest): Promise<string> {
    this.tokens.push(request);
    this.rooms.get(request.room)?.participants.add(request.identity);
    return `token-de-teste:${request.identity}`;
  }

  // --- Canais de voz dos grupos ---------------------------------------------------------

  readonly voiceTokens: VoiceTokenRequest[] = [];
  /** O que cada pessoa pode publicar agora, por sala. */
  readonly publishing = new Map<string, PublishRights>();
  readonly tracks = new Map<string, PublishedTrack[]>();
  /** Histórico de mudanças de direito de publicação, na ordem (para conferir "tira e devolve"). */
  readonly publishingLog: { room: string; identity: string; rights: PublishRights }[] = [];

  static key(room: string, identity: string): string {
    return `${room}|${identity}`;
  }

  async createVoiceToken(request: VoiceTokenRequest): Promise<string> {
    this.#guard();
    this.voiceTokens.push(structuredClone(request));
    await this.ensureRoom(request.room, 50);
    this.rooms.get(request.room)!.participants.add(request.identity);
    this.publishing.set(FakeSfu.key(request.room, request.identity), { ...request.publish });
    return `voz-de-teste:${request.room}:${request.identity}`;
  }

  /** Simula a pessoa publicando faixas depois de entrar. */
  publish(room: string, identity: string, tracks: PublishedTrack[]): void {
    this.tracks.set(FakeSfu.key(room, identity), structuredClone(tracks));
  }

  async tracksOf(room: string, identity: string): Promise<PublishedTrack[] | null> {
    if (!this.rooms.get(room)?.participants.has(identity)) return null;
    return structuredClone(this.tracks.get(FakeSfu.key(room, identity)) ?? []);
  }

  async muteTrack(room: string, identity: string, trackSid: string, muted: boolean): Promise<void> {
    const track = this.tracks.get(FakeSfu.key(room, identity))?.find((item) => item.sid === trackSid);
    if (track) track.muted = muted;
  }

  async setPublishing(room: string, identity: string, rights: PublishRights): Promise<void> {
    this.publishing.set(FakeSfu.key(room, identity), { ...rights });
    this.publishingLog.push({ room, identity, rights: { ...rights } });
    // Como o SFU de verdade: faixas de fontes que deixaram de ser permitidas caem.
    const kept = (this.tracks.get(FakeSfu.key(room, identity)) ?? []).filter(
      (track) =>
        (track.source === 'microfone' && rights.speak) ||
        (track.source === 'tela' && rights.stream) ||
        (track.source === 'audio_da_tela' && rights.stream && rights.streamAudio),
    );
    this.tracks.set(FakeSfu.key(room, identity), kept);
  }
}
