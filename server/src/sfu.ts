import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { Config } from './config.ts';

/** Estado que precisa sobreviver entre requisições. Mora nos metadados da sala no LiveKit. */
export interface RoomState {
  locked: boolean;
  banned: string[];
}

export interface RoomSnapshot {
  exists: boolean;
  participants: number;
  state: RoomState;
}

export interface TokenRequest {
  room: string;
  identity: string;
  name: string;
  host: boolean;
  accountId?: string;
  avatar?: string | null;
  ttlSeconds: number;
}

/** Entrada num canal de voz de um grupo: o que a pessoa pode publicar vem das permissões dela no canal. */
export interface VoiceTokenRequest {
  room: string;
  identity: string;
  name: string;
  ttlSeconds: number;
  publish: PublishRights;
  metadata: Record<string, unknown>;
}

export interface PublishRights {
  /** Microfone. */
  speak: boolean;
  /** Tela. */
  stream: boolean;
  /** Som que acompanha a tela. */
  streamAudio: boolean;
}

export interface PublishedTrack {
  sid: string;
  source: 'microfone' | 'tela' | 'audio_da_tela' | 'outro';
  muted: boolean;
}

/** Tudo o que o backend precisa do SFU. Os testes trocam por uma implementação em memória. */
export interface Sfu {
  snapshot(room: string): Promise<RoomSnapshot>;
  ensureRoom(room: string, capacity: number): Promise<void>;
  saveState(room: string, state: RoomState): Promise<void>;
  removeParticipant(room: string, identity: string): Promise<void>;
  closeRoom(room: string): Promise<void>;
  createToken(request: TokenRequest): Promise<string>;
  createVoiceToken(request: VoiceTokenRequest): Promise<string>;
  /** Faixas que a pessoa está publicando, ou null se ela não está na sala. */
  tracksOf(room: string, identity: string): Promise<PublishedTrack[] | null>;
  muteTrack(room: string, identity: string, trackSid: string, muted: boolean): Promise<void>;
  /** Muda o que a pessoa pode publicar com ela já na sala. O SFU derruba as faixas que deixaram de ser permitidas. */
  setPublishing(room: string, identity: string, rights: PublishRights): Promise<void>;
}

export const EMPTY_STATE: RoomState = { locked: false, banned: [] };
const MAX_BANNED = 200;

export function parseState(metadata: string | undefined): RoomState {
  if (!metadata) return { ...EMPTY_STATE, banned: [] };
  try {
    const raw = JSON.parse(metadata) as Partial<RoomState>;
    return {
      locked: raw.locked === true,
      banned: Array.isArray(raw.banned) ? raw.banned.filter((item) => typeof item === 'string').slice(-MAX_BANNED) : [],
    };
  } catch {
    return { ...EMPTY_STATE, banned: [] };
  }
}

export function serializeState(state: RoomState): string {
  return JSON.stringify({ locked: state.locked, banned: state.banned.slice(-MAX_BANNED) });
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { status?: number; code?: string; message?: string };
  return candidate?.status === 404 || candidate?.code === 'not_found' || /not[ _]found|does not exist/i.test(candidate?.message ?? '');
}

export class LiveKitSfu implements Sfu {
  readonly #rooms: RoomServiceClient;
  readonly #config: Config;

  constructor(config: Config) {
    this.#config = config;
    this.#rooms = new RoomServiceClient(config.livekitApiUrl, config.apiKey, config.apiSecret);
  }

  async snapshot(room: string): Promise<RoomSnapshot> {
    const [found] = await this.#rooms.listRooms([room]);
    if (!found) return { exists: false, participants: 0, state: parseState(undefined) };
    return { exists: true, participants: found.numParticipants, state: parseState(found.metadata) };
  }

  async ensureRoom(room: string, capacity: number): Promise<void> {
    // Sala vazia fica viva por 10 minutos: bloqueio e banimentos resistem a quedas rápidas.
    await this.#rooms.createRoom({ name: room, maxParticipants: capacity, emptyTimeout: 600, departureTimeout: 600 });
  }

  async saveState(room: string, state: RoomState): Promise<void> {
    await this.#rooms.updateRoomMetadata(room, serializeState(state));
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    try {
      await this.#rooms.removeParticipant(room, identity);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async closeRoom(room: string): Promise<void> {
    try {
      await this.#rooms.deleteRoom(room);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async createToken(request: TokenRequest): Promise<string> {
    const token = new AccessToken(this.#config.apiKey, this.#config.apiSecret, {
      identity: request.identity,
      name: request.name,
      ttl: request.ttlSeconds,
      metadata: JSON.stringify({ host: request.host, accountId: request.accountId, avatar: request.avatar }),
    });
    token.addGrant({
      roomJoin: true,
      room: request.room,
      canSubscribe: true,
      canPublish: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
      // Só tela, áudio da tela e microfone. Câmera fica de fora.
      canPublishSources: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.MICROPHONE],
    });
    return token.toJwt();
  }

  async createVoiceToken(request: VoiceTokenRequest): Promise<string> {
    const token = new AccessToken(this.#config.apiKey, this.#config.apiSecret, {
      identity: request.identity,
      name: request.name,
      ttl: request.ttlSeconds,
      metadata: JSON.stringify(request.metadata),
    });
    const sources = sourcesFor(request.publish);
    token.addGrant({
      roomJoin: true,
      room: request.room,
      canSubscribe: true,
      canPublish: sources.length > 0,
      canPublishData: true,
      canUpdateOwnMetadata: false,
      canPublishSources: sources,
    });
    return token.toJwt();
  }

  async tracksOf(room: string, identity: string): Promise<PublishedTrack[] | null> {
    try {
      const participant = await this.#rooms.getParticipant(room, identity);
      return participant.tracks.map((track) => ({
        sid: track.sid,
        muted: track.muted,
        source:
          track.source === TrackSource.MICROPHONE
            ? 'microfone'
            : track.source === TrackSource.SCREEN_SHARE
              ? 'tela'
              : track.source === TrackSource.SCREEN_SHARE_AUDIO
                ? 'audio_da_tela'
                : 'outro',
      }));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async muteTrack(room: string, identity: string, trackSid: string, muted: boolean): Promise<void> {
    await this.#rooms.mutePublishedTrack(room, identity, trackSid, muted);
  }

  async setPublishing(room: string, identity: string, rights: PublishRights): Promise<void> {
    const sources = sourcesFor(rights);
    try {
      await this.#rooms.updateParticipant(room, identity, {
        permission: { canSubscribe: true, canPublish: sources.length > 0, canPublishData: true, canPublishSources: sources },
      });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

function sourcesFor(rights: PublishRights): TrackSource[] {
  return [
    ...(rights.speak ? [TrackSource.MICROPHONE] : []),
    ...(rights.stream ? [TrackSource.SCREEN_SHARE] : []),
    ...(rights.stream && rights.streamAudio ? [TrackSource.SCREEN_SHARE_AUDIO] : []),
  ];
}
