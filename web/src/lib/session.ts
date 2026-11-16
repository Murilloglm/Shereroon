/**
 * Sessão de uma sala: conexão com o SFU (LiveKit), publicação da tela e do microfone,
 * troca de qualidade ao vivo, reconexão e leitura das estatísticas reais.
 *
 * A sessão não sabe de onde vem o acesso: recebe um `SessionAccess` que entrega o token.
 * Hoje é o convite de sala; canais de voz de grupos podem entregar outro.
 */
import {
  ConnectionError,
  ConnectionErrorReason,
  ConnectionQuality,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoPreset,
  type LocalTrackPublication,
  type Participant,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublishOptions,
} from 'livekit-client';
import { ApiError } from './api.ts';
import { audioContext, listAudioDevices, resumeAudio, type AudioDevices } from './audio.ts';
import {
  CaptureError,
  captureFacts,
  retarget,
  sendableCodecs,
  startCapture,
  type CaptureFacts,
  type CaptureSession,
  type Surface,
} from './capture.ts';
import { desktop } from './desktop.ts';
import { DEFAULT_MIC, MicError, MicPipeline, type MicSettings } from './mic.ts';
import {
  buildLadder,
  contentHintFor,
  DEGRADATION,
  diagnose,
  effectiveBitrateKbps,
  initialAutoState,
  isRamping,
  presetBitrateKbps,
  shortfallCause,
  sanitizeQuality,
  stepAuto,
  TOP_TARGET,
  widthFor,
  type AutoState,
  type Codec,
  type Diagnosis,
  type QualitySettings,
  type RealQuality,
  type Target,
} from './quality.ts';
import {
  collect,
  estimateDelayMs,
  PeakWindow,
  readPublisher,
  readViewer,
  type PublisherCounters,
  type PublisherStats,
  type UplinkInfo,
  type ViewerCounters,
  type ViewerStats,
} from './stats.ts';
import { storage } from './storage.ts';
import { Store } from './store.ts';

// --- Acesso ------------------------------------------------------------------

export interface AccessGrant {
  url: string;
  token: string;
  identity: string;
  isHost: boolean;
  room: { name: string; capacity: number; hasPassword: boolean };
  /** Só nos canais de voz de grupos: o que as permissões do canal deixam esta pessoa fazer. */
  rights?: Rights;
}

/** O que a pessoa pode fazer na sala. Nas salas por link, tudo; nos canais de voz, o que o backend concedeu. */
export interface Rights {
  speak: boolean;
  stream: boolean;
  streamAudio: boolean;
  /** Ver as telas dos outros. */
  watch: boolean;
  /** Transmitir acima de 720p a 30 FPS. */
  highQuality: boolean;
}

export const FULL_RIGHTS: Rights = { speak: true, stream: true, streamAudio: true, watch: true, highQuality: true };
/** Teto de quem não tem a permissão de alta qualidade. */
const BASIC_QUALITY = { height: 720, fps: 30 } as const;

export interface SessionAccess {
  /** Pede um token novo (na entrada e a cada reconexão completa). */
  grant(): Promise<AccessGrant>;
  kick?(identity: string): Promise<void>;
  setLocked?(locked: boolean): Promise<void>;
  closeRoom?(): Promise<void>;
}

// --- Estado visível ----------------------------------------------------------

export type Phase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended';
export type EndReason = 'saiu' | 'expulso' | 'duplicado' | 'encerrada' | 'trancada' | 'erro';
export type LinkQuality = 'otima' | 'boa' | 'fraca' | 'perdida' | 'desconhecida';
export type AudioSource = 'nenhum' | 'navegador' | 'apps';

export interface ParticipantView {
  identity: string;
  name: string;
  isLocal: boolean;
  isHost: boolean;
  micOn: boolean;
  speaking: boolean;
  sharing: boolean;
  quality: LinkQuality;
}

export interface StreamView {
  /** Identidade de quem transmite (cada pessoa tem no máximo uma tela). */
  id: string;
  name: string;
  isLocal: boolean;
  track: Track | null;
  hasAudio: boolean;
}

export interface ShareView {
  active: boolean;
  starting: boolean;
  surface: Surface | null;
  /** A captura atual trouxe áudio do navegador (aba, janela ou sistema)? */
  browserAudio: boolean;
  /** O navegador reconheceu a opção windowAudio (áudio só da janela)? */
  windowAudioUnderstood: boolean;
  capture: CaptureFacts | null;
  codec: Codec | null;
  target: Target | null;
  bitrateKbps: number | null;
  /** No modo automático: por que o alvo atual não é o topo. */
  autoNote: string | null;
}

export interface PublisherView {
  stats: PublisherStats;
  captureFpsPeak: number | null;
  diagnosis: Diagnosis[];
  /** Ainda nos primeiros segundos depois de iniciar ou mudar a qualidade (o WebRTC está subindo o bitrate). */
  settling: boolean;
}

export interface ViewerView {
  stats: ViewerStats;
  uplink: UplinkInfo | null;
  delayMs: number | null;
  /** Quadros realmente pintados na tela por segundo (medido no elemento de vídeo). */
  presentedFps: number | null;
}

export interface SessionState {
  phase: Phase;
  endReason: EndReason | null;
  error: string | null;
  notice: string | null;
  roomName: string;
  capacity: number;
  hasPassword: boolean;
  locked: boolean;
  identity: string;
  isHost: boolean;
  rights: Rights;
  participants: ParticipantView[];
  streams: StreamView[];
  selected: string | null;
  link: LinkQuality;
  audioBlocked: boolean;
  share: ShareView;
  quality: QualitySettings;
  codecs: Codec[];
  audioSource: AudioSource;
  micOn: boolean;
  micBusy: boolean;
  mic: MicSettings;
  devices: AudioDevices;
  outputDeviceId: string | null;
  outputVolume: number;
  volumes: Record<string, number>;
  publisher: PublisherView | null;
  viewer: ViewerView | null;
}

const IDLE_SHARE: ShareView = {
  active: false,
  starting: false,
  surface: null,
  browserAudio: false,
  windowAudioUnderstood: false,
  capture: null,
  codec: null,
  target: null,
  bitrateKbps: null,
  autoNote: null,
};

const SCREEN_STREAM = 'tela';
const VOICE_STREAM = 'voz';
const UPLINK_TOPIC = 'sr.uplink';
/** Depois de iniciar ou mudar a qualidade, as primeiras leituras ainda não dizem nada. */
const SETTLE_MS = 4_000;

function linkQuality(quality: ConnectionQuality): LinkQuality {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return 'otima';
    case ConnectionQuality.Good:
      return 'boa';
    case ConnectionQuality.Poor:
      return 'fraca';
    case ConnectionQuality.Lost:
      return 'perdida';
    default:
      return 'desconhecida';
  }
}

function isHostMetadata(metadata: string | undefined): boolean {
  if (!metadata) return false;
  try {
    return (JSON.parse(metadata) as { host?: unknown }).host === true;
  } catch {
    return false;
  }
}

function lockedFromMetadata(metadata: string | undefined): boolean {
  if (!metadata) return false;
  try {
    return (JSON.parse(metadata) as { locked?: unknown }).locked === true;
  } catch {
    return false;
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Falha ao entrar, com mensagem em português. As do nosso backend já chegam prontas; as do LiveKit vêm em inglês. */
function joinFailure(error: unknown): Error {
  if (error instanceof ConnectionError) {
    if (error.reason === ConnectionErrorReason.NotAllowed) {
      return new Error('O servidor de transmissão recusou a entrada. Tente de novo; se continuar, o administrador precisa conferir as chaves do LiveKit.');
    }
    if (error.reason !== ConnectionErrorReason.Cancelled && error.reason !== ConnectionErrorReason.LeaveRequest) {
      return new Error('Não foi possível alcançar o servidor de transmissão. Confira sua internet (ou o firewall) e tente de novo.');
    }
  }
  return error instanceof Error ? error : new Error('Não foi possível entrar na sala.');
}

export class RoomSession {
  readonly store: Store<SessionState>;
  readonly mic: MicPipeline;
  readonly #room: Room;
  #access: SessionAccess | null = null;
  #capture: CaptureSession | null = null;
  #screenPub: LocalTrackPublication | null = null;
  #screenAudioPub: LocalTrackPublication | null = null;
  #micPub: LocalTrackPublication | null = null;
  /** Enquanto um filtro de ruído cuida do microfone, isto manda na supressão do navegador (null = vale a preferência). */
  #micBrowserNs: boolean | null = null;
  #appAudio: MediaStreamTrack | null = null;
  #preferredSurface: Surface | undefined;
  #leaving = false;
  #rejoining = false;
  #timer: ReturnType<typeof setInterval> | null = null;
  #tickCount = 0;
  #pubCounters: PublisherCounters | null = null;
  #viewCounters: ViewerCounters | null = null;
  #viewTrackSid: string | null = null;
  #capturePeak = new PeakWindow(20_000);
  #availableHistory: (number | null)[] = [];
  #settleUntil = 0;
  #auto: AutoState = initialAutoState();
  #ladder: Target[] = buildLadder({ maxHeight: 1080, maxFps: 120 });
  #uplinks = new Map<string, UplinkInfo>();
  #presentedFps: number | null = null;
  #audioElements = new Map<string, HTMLMediaElement>();

  constructor() {
    this.mic = new MicPipeline(audioContext());
    this.store = new Store<SessionState>({
      phase: 'idle',
      endReason: null,
      error: null,
      notice: null,
      roomName: '',
      capacity: 0,
      hasPassword: false,
      locked: false,
      identity: '',
      isHost: false,
      rights: FULL_RIGHTS,
      participants: [],
      streams: [],
      selected: null,
      link: 'desconhecida',
      audioBlocked: false,
      share: IDLE_SHARE,
      quality: sanitizeQuality(storage.get('shareroom:qualidade', null)),
      codecs: sendableCodecs(),
      // No aplicativo de Windows não existe "áudio pelo navegador": o som vem do componente de áudio, quando a pessoa liga.
      audioSource: desktop || storage.get<AudioSource>('shareroom:audio-fonte', 'navegador') === 'nenhum' ? 'nenhum' : 'navegador',
      micOn: false,
      micBusy: false,
      mic: { ...DEFAULT_MIC, ...storage.get<Partial<MicSettings>>('shareroom:microfone', {}) },
      devices: { inputs: [], outputs: [] },
      outputDeviceId: null,
      outputVolume: storage.get<number>('shareroom:volume-saida', 1),
      volumes: {},
      publisher: null,
      viewer: null,
    });

    this.#room = new Room({
      adaptiveStream: { pixelDensity: 'screen' },
      dynacast: false,
      // A captura de tela é nossa: uma queda de conexão não pode encerrá-la.
      stopLocalTrackOnUnpublish: false,
      disconnectOnPageLeave: true,
    });
    this.#wireRoom();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.refreshDevices());
  }

  // --- Entrada, saída e reconexão ---------------------------------------------

  /** Chame dentro de um clique: destrava o áudio do navegador. */
  async join(access: SessionAccess): Promise<void> {
    this.#access = access;
    this.#leaving = false;
    this.store.set({ phase: 'connecting', endReason: null, error: null });
    void resumeAudio();
    try {
      await this.#connect();
    } catch (error) {
      const failure = joinFailure(error);
      this.store.set({ phase: 'idle', error: failure.message });
      throw failure;
    }
  }

  async leave(): Promise<void> {
    this.#leaving = true;
    await this.#teardownMedia();
    await this.#room.disconnect();
    this.#stopTimer();
    this.store.set({ phase: 'ended', endReason: 'saiu', participants: [], streams: [], selected: null });
  }

  async #connect(): Promise<void> {
    const grant = await this.#access!.grant();
    await this.#room.connect(grant.url, grant.token, { autoSubscribe: true });
    void this.#room.startAudio().catch(() => undefined);
    this.store.set({
      phase: 'connected',
      identity: grant.identity,
      isHost: grant.isHost,
      rights: grant.rights ?? FULL_RIGHTS,
      roomName: grant.room.name,
      capacity: grant.room.capacity,
      hasPassword: grant.room.hasPassword,
      locked: lockedFromMetadata(this.#room.metadata),
      audioBlocked: !this.#room.canPlaybackAudio,
      error: null,
    });
    this.#applyWatchRule();
    this.#refresh();
    this.#startTimer();
    void this.refreshDevices();
  }

  #onDisconnected(reason: DisconnectReason | undefined): void {
    this.#screenPub = null;
    this.#screenAudioPub = null;
    this.#micPub = null;
    this.#clearAudioElements();
    if (this.#leaving) return;

    const end = (endReason: EndReason) => {
      this.#stopTimer();
      void this.#teardownMedia();
      this.store.set({ phase: 'ended', endReason, participants: [], streams: [], selected: null, publisher: null, viewer: null });
    };

    switch (reason) {
      case DisconnectReason.PARTICIPANT_REMOVED:
        return end('expulso');
      case DisconnectReason.DUPLICATE_IDENTITY:
        return end('duplicado');
      case DisconnectReason.ROOM_DELETED:
      case DisconnectReason.ROOM_CLOSED:
        return end('encerrada');
      default:
        // Queda de rede ou do servidor: mantém a captura viva e tenta voltar sozinho.
        void this.#rejoin();
    }
  }

  async #rejoin(): Promise<void> {
    if (this.#rejoining) return;
    this.#rejoining = true;
    this.store.set({ phase: 'reconnecting' });
    const delays = [1000, 2000, 4000, 8000, 15000];
    for (let attempt = 0; !this.#leaving; attempt++) {
      await wait(delays[Math.min(attempt, delays.length - 1)]!);
      if (this.#leaving) break;
      try {
        await this.#connect();
        await this.#republishAfterReconnect();
        this.#rejoining = false;
        return;
      } catch (error) {
        if (error instanceof ApiError && !error.transient) {
          this.#rejoining = false;
          this.#stopTimer();
          void this.#teardownMedia();
          const endReason: EndReason =
            error.code === 'expulso' ? 'expulso' : error.code === 'sala_trancada' ? 'trancada' : 'erro';
          this.store.set({ phase: 'ended', endReason, error: error.message });
          return;
        }
        // rede ainda fora: tenta de novo
      }
    }
    this.#rejoining = false;
  }

  async #republishAfterReconnect(): Promise<void> {
    if (this.#capture && this.#capture.video.readyState === 'live') {
      await this.#publishShare();
    }
    if (this.store.get().micOn && this.mic.active) {
      await this.#publishMic();
    }
  }

  async #teardownMedia(): Promise<void> {
    this.#capture?.stop();
    this.#capture = null;
    this.mic.stop();
    this.#clearAudioElements();
    this.store.set({ share: IDLE_SHARE, micOn: false, publisher: null });
  }

  // --- Eventos da sala -----------------------------------------------------------

  #wireRoom(): void {
    const room = this.#room;
    const refresh = () => this.#refresh();
    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        this.#uplinks.delete(participant.identity);
        refresh();
      })
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.ParticipantNameChanged, refresh)
      .on(RoomEvent.ParticipantMetadataChanged, refresh)
      .on(RoomEvent.ConnectionQualityChanged, refresh)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) this.#attachAudio(track as RemoteAudioTrack, publication.trackSid);
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) this.#detachAudio(track as RemoteAudioTrack, publication.trackSid);
        refresh();
      })
      .on(RoomEvent.TrackPublished, () => this.#applyWatchRule())
      .on(RoomEvent.ParticipantPermissionsChanged, (_previous, participant) => {
        if (participant.isLocal) this.#onPublishRights();
      })
      .on(RoomEvent.RoomMetadataChanged, (metadata: string) => {
        this.store.set({ locked: lockedFromMetadata(metadata) });
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        this.store.set({ audioBlocked: !room.canPlaybackAudio });
      })
      .on(RoomEvent.Reconnecting, () => this.store.set({ phase: 'reconnecting' }))
      .on(RoomEvent.SignalReconnecting, () => this.store.set({ phase: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => {
        this.store.set({ phase: 'connected' });
        this.#settleUntil = Date.now() + SETTLE_MS;
        refresh();
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => this.#onDisconnected(reason))
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
        if (topic !== UPLINK_TOPIC || !participant) return;
        try {
          this.#uplinks.set(participant.identity, JSON.parse(new TextDecoder().decode(payload)) as UplinkInfo);
        } catch {
          // mensagem malformada: ignora
        }
      });
  }

  #refresh(): void {
    const room = this.#room;
    const state = this.store.get();
    if (state.phase === 'ended' || state.phase === 'idle') return;

    const everyone: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    const participants: ParticipantView[] = everyone.map((participant) => ({
      identity: participant.identity,
      name: participant.name || 'Sem nome',
      isLocal: participant === room.localParticipant,
      isHost: isHostMetadata(participant.metadata),
      micOn: participant.isMicrophoneEnabled,
      speaking: participant.isSpeaking,
      sharing: participant.isScreenShareEnabled,
      quality: linkQuality(participant.connectionQuality),
    }));

    const streams: StreamView[] = [];
    for (const participant of everyone) {
      const publication = participant.getTrackPublication(Track.Source.ScreenShare);
      if (!publication) continue;
      const isLocal = participant === room.localParticipant;
      if (isLocal && !publication.track) continue;
      streams.push({
        id: participant.identity,
        name: participant.name || 'Sem nome',
        isLocal,
        track: publication.track ?? null,
        hasAudio: participant.getTrackPublication(Track.Source.ScreenShareAudio) !== undefined,
      });
    }

    // Mantém a escolha de quem assiste; se ela sumiu, prefere a tela de outra pessoa à própria.
    let selected = state.selected;
    if (!selected || !streams.some((stream) => stream.id === selected)) {
      selected = (streams.find((stream) => !stream.isLocal) ?? streams[0])?.id ?? null;
    }

    this.store.set({ participants, streams, selected, link: linkQuality(room.localParticipant.connectionQuality) });
    this.#applyAudioRouting();
  }

  // --- Áudio recebido --------------------------------------------------------------

  #attachAudio(track: RemoteAudioTrack, sid: string): void {
    const element = track.attach();
    element.style.display = 'none';
    document.body.appendChild(element);
    this.#audioElements.set(sid, element);
    const sinkId = this.store.get().outputDeviceId;
    if (sinkId) void track.setSinkId(sinkId).catch(() => undefined);
    this.#applyAudioRouting();
  }

  #detachAudio(track: RemoteAudioTrack, sid: string): void {
    for (const element of track.detach()) element.remove();
    // Quando a faixa é despublicada o LiveKit já a soltou do elemento: remove pelo nosso registro.
    this.#audioElements.get(sid)?.remove();
    this.#audioElements.delete(sid);
  }

  #clearAudioElements(): void {
    for (const element of this.#audioElements.values()) element.remove();
    this.#audioElements.clear();
  }

  /** Só toca o áudio de tela da transmissão que está em destaque; as vozes tocam sempre. */
  #applyAudioRouting(): void {
    const { selected, volumes, outputVolume } = this.store.get();
    for (const participant of this.#room.remoteParticipants.values()) {
      const screenAudio = participant.getTrackPublication(Track.Source.ScreenShareAudio) as RemoteTrackPublication | undefined;
      if (screenAudio) {
        const wanted = participant.identity === selected;
        if (screenAudio.isEnabled !== wanted) screenAudio.setEnabled(wanted);
        (screenAudio.track as RemoteAudioTrack | undefined)?.setVolume(outputVolume * (volumes[participant.identity] ?? 1));
      }
      const voice = participant.getTrackPublication(Track.Source.Microphone) as RemoteTrackPublication | undefined;
      (voice?.track as RemoteAudioTrack | undefined)?.setVolume(outputVolume * (volumes[`voz:${participant.identity}`] ?? 1));
    }
  }

  /** O navegador bloqueou o som até um gesto: chame no clique do botão "Ativar som". */
  async unlockAudio(): Promise<void> {
    await resumeAudio();
    await this.#room.startAudio().catch(() => undefined);
    this.store.set({ audioBlocked: !this.#room.canPlaybackAudio });
  }

  select(streamId: string): void {
    if (this.store.get().selected === streamId) return;
    this.#viewCounters = null;
    this.#presentedFps = null;
    this.store.set({ selected: streamId, viewer: null });
    this.#applyAudioRouting();
  }

  /** Volume (0 a 1) do áudio de uma transmissão, só para quem está ouvindo. Use `voz:<id>` para o microfone. */
  setVolume(key: string, volume: number): void {
    this.store.set((state) => ({ volumes: { ...state.volumes, [key]: Math.min(1, Math.max(0, volume)) } }));
    this.#applyAudioRouting();
  }

  setOutputVolume(volume: number): void {
    const value = Math.min(1, Math.max(0, volume));
    storage.set('shareroom:volume-saida', value);
    this.store.set({ outputVolume: value });
    this.#applyAudioRouting();
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    try {
      await this.#room.switchActiveDevice('audiooutput', deviceId);
      this.store.set({ outputDeviceId: deviceId });
    } catch {
      this.#notify('Este navegador não permite escolher a saída de áudio.');
    }
  }

  async refreshDevices(): Promise<void> {
    this.store.set({ devices: await listAudioDevices() });
  }

  reportPresentedFps(fps: number | null): void {
    this.#presentedFps = fps;
  }

  // --- Direitos (canais de voz de grupos) ---------------------------------------------

  /** Aplica o teto de qualidade de quem não tem a permissão de alta qualidade. */
  #allowed(target: Target): Target {
    if (this.store.get().rights.highQuality) return target;
    return {
      height: Math.min(target.height, BASIC_QUALITY.height) as Target['height'],
      fps: Math.min(target.fps, BASIC_QUALITY.fps) as Target['fps'],
    };
  }

  /** Ver ou não as telas dos outros e o teto de qualidade vêm das permissões do canal, que podem mudar com a sala aberta. */
  setViewRights(patch: Pick<Rights, 'watch' | 'highQuality'>): void {
    const before = this.store.get().rights;
    if (before.watch === patch.watch && before.highQuality === patch.highQuality) return;
    this.store.set({ rights: { ...before, ...patch } });
    this.#applyWatchRule();
    if (before.highQuality !== patch.highQuality && this.#capture) void this.#applyTarget();
    this.#refresh();
  }

  /** Quem não pode assistir transmissões nem recebe o vídeo das telas (as vozes continuam). */
  #applyWatchRule(): void {
    const { watch } = this.store.get().rights;
    for (const participant of this.#room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.source === Track.Source.ScreenShare || publication.source === Track.Source.ScreenShareAudio) {
          publication.setSubscribed(watch);
        }
      }
    }
  }

  /** O backend mudou o que esta pessoa pode publicar (cargo, regra do canal, castigo, moderação). */
  #onPublishRights(): void {
    const permissions = this.#room.localParticipant.permissions;
    if (!permissions) return;
    const sources = permissions.canPublishSources ?? [];
    // Lista vazia com "pode publicar" significa todas as fontes. Os números são os do protocolo do LiveKit.
    const can = (source: number) => permissions.canPublish && (sources.length === 0 || sources.includes(source));
    const before = this.store.get().rights;
    const rights: Rights = { ...before, speak: can(2), stream: can(3), streamAudio: can(3) && can(4) };
    if (rights.speak === before.speak && rights.stream === before.stream && rights.streamAudio === before.streamAudio) return;
    this.store.set({ rights });
    if (!rights.stream && this.#capture) {
      void this.stopShare();
      this.#notify('Sua transmissão foi encerrada: você não tem mais permissão para transmitir neste canal.');
    } else if (!rights.streamAudio && this.store.get().audioSource !== 'nenhum') {
      void this.setAudioSource('nenhum');
    }
    if (!rights.speak && this.store.get().micOn) {
      void this.setMic(false);
      this.#notify('Seu microfone foi desligado: você não pode falar neste canal agora.');
    }
  }

  // --- Compartilhamento de tela -----------------------------------------------------

  setPreferredSurface(surface: Surface | undefined): void {
    this.#preferredSurface = surface;
  }

  #currentTarget(): Target {
    const { quality } = this.store.get();
    if (quality.mode === 'manual') return this.#allowed({ height: quality.resolution, fps: quality.fps });
    return this.#allowed(this.#ladder[Math.min(this.#auto.level, this.#ladder.length - 1)] ?? TOP_TARGET);
  }

  #resolveCodec(): Codec {
    const { quality, codecs } = this.store.get();
    if (quality.codec !== 'auto' && codecs.includes(quality.codec)) return quality.codec;
    // Automático: H.264 tem codificação e decodificação por hardware em praticamente tudo, inclusive celulares.
    return codecs.includes('h264') ? 'h264' : (codecs[0] ?? 'vp8');
  }

  async startShare(): Promise<void> {
    const state = this.store.get();
    if (this.#capture || state.share.starting || state.phase !== 'connected') return;
    if (!state.rights.stream) {
      this.#notify('Você não tem permissão para transmitir a tela neste canal.');
      return;
    }
    this.store.set({ share: { ...IDLE_SHARE, starting: true } });

    const manual = state.quality.mode === 'manual';
    try {
      // A autorização é do navegador: nada é capturado antes de a pessoa escolher a fonte.
      this.#capture = await startCapture({
        target: this.#allowed(manual ? { height: state.quality.resolution, fps: state.quality.fps } : TOP_TARGET),
        audio: state.audioSource === 'navegador' && state.rights.streamAudio,
        surface: this.#preferredSurface,
      });
    } catch (error) {
      this.store.set({ share: IDLE_SHARE });
      if (!(error instanceof CaptureError) || error.code !== 'cancelado') {
        this.#notify(error instanceof Error ? error.message : 'Não foi possível compartilhar a tela.');
      }
      return;
    }

    const capture = this.#capture;
    // "Parar compartilhamento" na barra do próprio navegador.
    capture.video.addEventListener('ended', () => void this.stopShare());

    const facts = captureFacts(capture.video);
    this.#ladder = buildLadder({ maxHeight: facts.height ?? 1080, maxFps: facts.maxFrameRate ?? 120 });
    this.#auto = initialAutoState();
    this.#capturePeak.reset();
    this.#availableHistory = [];

    try {
      await this.#publishShare();
    } catch (error) {
      capture.stop();
      this.#capture = null;
      this.store.set({ share: IDLE_SHARE });
      this.#notify(`Não foi possível publicar a tela: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
      return;
    }
    this.store.set({ selected: this.store.get().selected ?? this.store.get().identity });
    this.#refresh();
  }

  async stopShare(): Promise<void> {
    const capture = this.#capture;
    if (!capture) return;
    this.#capture = null;
    await this.#unpublishShare();
    capture.stop();
    this.#pubCounters = null;
    this.store.set({ share: IDLE_SHARE, publisher: null });
    this.#refresh();
  }

  async #unpublishShare(): Promise<void> {
    const local = this.#room.localParticipant;
    const publications = [this.#screenPub, this.#screenAudioPub];
    this.#screenPub = null;
    this.#screenAudioPub = null;
    for (const publication of publications) {
      const track = publication?.track;
      if (!track) continue;
      try {
        // false = não parar a faixa: quem controla a captura é esta classe.
        await local.unpublishTrack(track, false);
      } catch {
        // já tinha saído com a conexão
      }
    }
  }

  async #publishShare(): Promise<void> {
    const capture = this.#capture;
    if (!capture) return;
    const { quality } = this.store.get();
    const codec = this.#resolveCodec();
    const target = this.#currentTarget();
    const bitrateKbps = effectiveBitrateKbps(quality, target, codec);
    const layered = codec === 'vp9' || codec === 'av1';

    await retarget(capture.video, target);
    capture.video.contentHint = contentHintFor(quality.content);

    const options: TrackPublishOptions = {
      source: Track.Source.ScreenShare,
      name: 'tela',
      stream: SCREEN_STREAM,
      videoCodec: codec,
      // VP9/AV1: publica H.264 de reserva só se algum espectador não decodificar o codec escolhido.
      backupCodec: layered,
      // VP9/AV1 usam camadas temporais (o SFU pode entregar menos FPS a quem tem internet fraca).
      scalabilityMode: layered ? 'L1T3' : undefined,
      simulcast: quality.lightLayer && !layered,
      screenShareEncoding: { maxBitrate: bitrateKbps * 1000, maxFramerate: target.fps, priority: 'high' },
      screenShareSimulcastLayers: quality.lightLayer && !layered ? [lightLayerFor(target, codec)] : undefined,
      degradationPreference: DEGRADATION,
    };
    this.#screenPub = await this.#room.localParticipant.publishTrack(capture.video, options);
    await this.#publishScreenAudio();

    this.#pubCounters = null;
    this.#settleUntil = Date.now() + SETTLE_MS;
    this.store.set({
      share: {
        active: true,
        starting: false,
        surface: capture.surface,
        browserAudio: capture.audio !== null && capture.audio.readyState === 'live',
        windowAudioUnderstood: capture.windowAudioUnderstood,
        capture: captureFacts(capture.video),
        codec,
        target,
        bitrateKbps,
        autoNote: this.store.get().share.autoNote,
      },
    });
  }

  /** Publica o áudio que acompanha a tela: o do navegador ou o mix de aplicativos, nunca os dois. */
  async #publishScreenAudio(): Promise<void> {
    const local = this.#room.localParticipant;
    const { audioSource } = this.store.get();
    const browserAudio = this.#capture?.audio && this.#capture.audio.readyState === 'live' ? this.#capture.audio : null;
    const track = !this.#screenPub ? null : audioSource === 'apps' ? this.#appAudio : audioSource === 'navegador' ? browserAudio : null;

    // A faixa certa já está no ar: não mexe. Ligar ou desligar aplicativos no mixer muda só o CONTEÚDO
    // dessa faixa; republicar causaria um corte no som de quem assiste.
    const published = this.#screenAudioPub?.track;
    if (published && track && published.mediaStreamTrack === track) return;

    if (published) {
      try {
        await local.unpublishTrack(published, false);
      } catch {
        // já não estava publicado
      }
      this.#screenAudioPub = null;
    }
    if (!track) return;

    this.#screenAudioPub = await local.publishTrack(track, {
      source: Track.Source.ScreenShareAudio,
      name: 'audio-da-tela',
      // Mesmo "stream" do vídeo: o receptor mantém som e imagem sincronizados.
      stream: SCREEN_STREAM,
      audioPreset: { maxBitrate: 160_000 },
      forceStereo: true,
      // Jogo e música não podem ter cortes de silêncio (DTX) como a voz.
      dtx: false,
      red: false,
    });
  }

  /** Recebe (ou remove) a faixa com o mix de aplicativos vinda do app auxiliar. */
  async setAppAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    this.#appAudio = track;
    if (this.store.get().audioSource === 'apps' && this.#screenPub) {
      await this.#publishScreenAudio();
      this.#refresh();
    }
  }

  async setAudioSource(source: AudioSource): Promise<void> {
    const previous = this.store.get().audioSource;
    if (previous === source) return;
    this.store.set({ audioSource: source });
    if (source !== 'apps') storage.set('shareroom:audio-fonte', source);
    if (!this.#screenPub) return;

    if (source === 'navegador' && !this.store.get().share.browserAudio) {
      this.#notify('O áudio do navegador só pode ser escolhido no início: pare e compartilhe de novo para incluí-lo.');
    }
    if (source !== 'navegador' && this.#capture?.audio) {
      // Para de capturar o áudio do sistema: nada do que não foi escolhido pode vazar.
      this.#capture.audio.stop();
      this.store.set((state) => ({ share: { ...state.share, browserAudio: false } }));
    }
    await this.#publishScreenAudio();
    this.#refresh();
  }

  // --- Qualidade --------------------------------------------------------------------

  async updateQuality(patch: Partial<QualitySettings>): Promise<void> {
    const before = this.store.get().quality;
    const quality = sanitizeQuality({ ...before, ...patch });
    storage.set('shareroom:qualidade', quality);
    this.store.set({ quality });
    if (!this.#capture || !this.#screenPub) return;

    if (quality.mode === 'auto' && before.mode !== 'auto') {
      this.#auto = initialAutoState();
      this.store.set((state) => ({ share: { ...state.share, autoNote: null } }));
    }

    // Codec e camada leve fazem parte da negociação: republica a MESMA captura (sem novo pedido de permissão).
    if (before.codec !== quality.codec || before.lightLayer !== quality.lightLayer) {
      const hadCodec = this.store.get().share.codec;
      if (before.lightLayer !== quality.lightLayer || hadCodec !== this.#resolveCodec()) {
        await this.#unpublishShare();
        await this.#publishShare();
        this.#refresh();
        return;
      }
    }
    await this.#applyTarget();
  }

  /** Aplica resolução, FPS, bitrate e prioridade na transmissão em andamento. */
  async #applyTarget(): Promise<void> {
    const capture = this.#capture;
    const track = this.#screenPub?.videoTrack;
    const sender = track?.sender;
    if (!capture || !track || !sender) return;

    const { quality, share } = this.store.get();
    const codec = share.codec ?? this.#resolveCodec();
    const target = this.#currentTarget();
    const bitrateKbps = effectiveBitrateKbps(quality, target, codec);

    await retarget(capture.video, target);
    capture.video.contentHint = contentHintFor(quality.content);

    try {
      const parameters = sender.getParameters();
      // Com simulcast, a camada principal é a que não reduz a resolução.
      const main = [...parameters.encodings].sort(
        (a, b) => (a.scaleResolutionDownBy ?? 1) - (b.scaleResolutionDownBy ?? 1),
      )[0];
      if (main) {
        main.maxBitrate = bitrateKbps * 1000;
        main.maxFramerate = target.fps;
        await sender.setParameters(parameters);
      }
      await track.setDegradationPreference(DEGRADATION);
    } catch (error) {
      console.warn('Não foi possível ajustar o codificador', error);
    }

    this.#settleUntil = Date.now() + SETTLE_MS;
    this.#capturePeak.reset();
    this.#availableHistory = [];
    this.store.set((state) => ({
      share: { ...state.share, target, bitrateKbps, capture: captureFacts(capture.video) },
    }));
  }

  // --- Microfone --------------------------------------------------------------------

  async setMic(on: boolean): Promise<void> {
    const state = this.store.get();
    if (state.micBusy || state.micOn === on) return;
    if (on && !state.rights.speak) {
      this.#notify('Você não tem permissão para falar neste canal.');
      return;
    }
    this.store.set({ micBusy: true });
    try {
      if (on) {
        await resumeAudio();
        await this.mic.start(this.#micSettings());
        await this.#publishMic();
        this.store.set({ micOn: true });
        void this.refreshDevices();
      } else {
        if (this.#micPub?.track) await this.#room.localParticipant.unpublishTrack(this.#micPub.track, false);
        this.#micPub = null;
        // Solta o aparelho de verdade: o indicador de microfone do sistema apaga.
        this.mic.stop();
        this.store.set({ micOn: false });
      }
    } catch (error) {
      this.mic.stop();
      this.store.set({ micOn: false });
      this.#notify(error instanceof MicError ? error.message : 'Não foi possível ligar o microfone.');
    } finally {
      this.store.set({ micBusy: false });
      this.#refresh();
    }
  }

  async #publishMic(): Promise<void> {
    this.#micPub = await this.#room.localParticipant.publishTrack(this.mic.output, {
      source: Track.Source.Microphone,
      name: 'microfone',
      stream: VOICE_STREAM,
      dtx: true,
      red: true,
    });
  }

  /** Muda as opções do microfone. Trocar de aparelho ou de filtro reabre a captura, sem republicar. */
  async updateMic(patch: Partial<MicSettings>): Promise<void> {
    const before = this.store.get().mic;
    const mic = { ...before, ...patch };
    storage.set('shareroom:microfone', mic);
    this.store.set({ mic });
    if (!this.mic.active) return;

    const reopen =
      before.deviceId !== mic.deviceId ||
      before.echoCancellation !== mic.echoCancellation ||
      (this.#micBrowserNs === null && before.noiseSuppression !== mic.noiseSuppression) ||
      before.autoGainControl !== mic.autoGainControl;
    if (reopen) {
      try {
        await this.mic.start(this.#micSettings());
      } catch (error) {
        this.#notify(error instanceof MicError ? error.message : 'Não foi possível trocar o microfone.');
      }
    } else {
      this.mic.setGain(mic.gain);
    }
  }

  /** As opções do microfone como vão para o navegador (com a supressão comandada pelo filtro de ruído, se houver). */
  #micSettings(): MicSettings {
    const mic = this.store.get().mic;
    return this.#micBrowserNs === null ? mic : { ...mic, noiseSuppression: this.#micBrowserNs };
  }

  /**
   * Encaixa (ou tira, com null) um filtro entre o microfone e a sala, sem republicar a faixa.
   * `browserNoiseSuppression` força a supressão convencional do navegador enquanto durar: `false` quando o
   * filtro de IA assume (para a voz não ser filtrada duas vezes), `true` quando ela é o substituto, e
   * `null` devolve o controle à preferência do usuário.
   */
  async setMicFilter(processor: AudioNode | null, browserNoiseSuppression: boolean | null): Promise<void> {
    const before = this.#micSettings().noiseSuppression;
    this.mic.setProcessor(processor ? { input: processor, output: processor } : null);
    this.#micBrowserNs = browserNoiseSuppression;
    if (!this.mic.active || before === this.#micSettings().noiseSuppression) return;
    try {
      await this.mic.start(this.#micSettings());
    } catch (error) {
      this.#notify(error instanceof MicError ? error.message : 'Não foi possível reabrir o microfone.');
    }
  }

  // --- Moderação (só o dono) -----------------------------------------------------------

  async kick(identity: string): Promise<void> {
    await this.#moderate(() => this.#access?.kick?.(identity));
  }

  async setLocked(locked: boolean): Promise<void> {
    await this.#moderate(() => this.#access?.setLocked?.(locked));
  }

  async closeRoom(): Promise<void> {
    await this.#moderate(() => this.#access?.closeRoom?.());
  }

  async #moderate(action: () => Promise<void> | undefined): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.#notify(error instanceof Error ? error.message : 'A ação não pôde ser concluída.');
    }
  }

  // --- Estatísticas ---------------------------------------------------------------------

  #startTimer(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.#tick(), 1000);
  }

  #stopTimer(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async #tick(): Promise<void> {
    this.#tickCount += 1;
    try {
      await Promise.all([this.#readPublisher(), this.#readViewer()]);
    } catch {
      // uma leitura perdida não é problema: a próxima vem em 1 s
    }
  }

  async #readPublisher(): Promise<void> {
    const track = this.#screenPub?.videoTrack;
    const capture = this.#capture;
    if (!track || !capture) {
      if (this.store.get().publisher) this.store.set({ publisher: null });
      return;
    }
    const { stats, counters } = readPublisher(collect(await track.getRTCStatsReport()), this.#pubCounters);
    this.#pubCounters = counters;

    const now = Date.now();
    const warmingUp = now < this.#settleUntil;
    const peak = this.#capturePeak.push(stats.captureFps, now);
    const state = this.store.get();
    const target = state.share.target ?? this.#currentTarget();

    // A estimativa de banda começa abaixo do alvo e sobe; enquanto sobe, quadros a menos são esperados.
    this.#availableHistory.push(stats.availableKbps);
    if (this.#availableHistory.length > 4) this.#availableHistory.shift();
    const ramping = isRamping(this.#availableHistory, state.share.bitrateKbps);

    const real: RealQuality = {
      captureWidth: stats.captureWidth,
      captureHeight: stats.captureHeight,
      captureFps: stats.captureFps,
      captureFpsPeak: peak,
      encodedWidth: stats.width,
      encodedHeight: stats.height,
      encodedFps: stats.fps,
      limitation: stats.limitation,
      bitrateKbps: stats.bitrateKbps,
      targetKbps: state.share.bitrateKbps,
      availableKbps: stats.availableKbps,
      encodeMs: stats.encodeMs,
      ramping,
      surface: state.share.surface,
    };
    const diagnosis = diagnose(target, real).filter((item) => !warmingUp || item.code === 'fonte_menor');

    this.store.set({ publisher: { stats, captureFpsPeak: peak, diagnosis, settling: warmingUp || ramping } });

    if (this.#tickCount % 2 !== 0) return;
    this.#broadcastUplink(stats, target, state.quality.mode);
    if (state.quality.mode === 'auto' && !warmingUp) await this.#autoStep(stats, real);
  }

  async #autoStep(stats: PublisherStats, real: RealQuality): Promise<void> {
    const result = stepAuto(
      this.#auto,
      { limitation: stats.limitation, captureFps: stats.captureFps, encodedFps: stats.fps, lossPct: stats.lossPct, ramping: real.ramping },
      this.#ladder.length,
    );
    this.#auto = result.state;
    if (!result.change) return;

    const reason = shortfallCause(real);
    const cause =
      reason === 'cpu'
        ? 'o codificador (CPU/GPU) não acompanhou'
        : reason === 'banda'
          ? 'a conexão de envio não sustentou o bitrate'
          : 'estavam saindo menos quadros do que os capturados';
    const target = this.#currentTarget();
    const autoNote =
      this.#auto.level === 0
        ? null
        : result.change === 'down'
          ? `Reduzido para ${target.height}p a ${target.fps} fps porque ${cause}.`
          : `Subindo de volta: agora em ${target.height}p a ${target.fps} fps.`;
    this.store.set((state) => ({ share: { ...state.share, autoNote } }));
    await this.#applyTarget();
  }

  #broadcastUplink(stats: PublisherStats, target: Target, mode: 'auto' | 'manual'): void {
    if (this.#room.remoteParticipants.size === 0) return;
    const info: UplinkInfo = {
      encodeMs: stats.encodeMs,
      rttMs: stats.rttMs,
      width: stats.width,
      height: stats.height,
      fps: stats.fps,
      requestedHeight: target.height,
      requestedFps: target.fps,
      limitation: stats.limitation,
      mode,
    };
    void this.#room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify(info)), { reliable: false, topic: UPLINK_TOPIC })
      .catch(() => undefined);
  }

  async #readViewer(): Promise<void> {
    const { selected, identity } = this.store.get();
    const participant = selected && selected !== identity ? this.#room.remoteParticipants.get(selected) : undefined;
    const publication = participant?.getTrackPublication(Track.Source.ScreenShare);
    const track = publication?.track;
    if (!participant || !publication || !track) {
      if (this.store.get().viewer) this.store.set({ viewer: null });
      this.#viewCounters = null;
      return;
    }
    if (this.#viewTrackSid !== publication.trackSid) {
      this.#viewTrackSid = publication.trackSid;
      this.#viewCounters = null;
    }
    const { stats, counters } = readViewer(collect(await track.getRTCStatsReport()), this.#viewCounters);
    this.#viewCounters = counters;
    const uplink = this.#uplinks.get(participant.identity) ?? null;
    this.store.set({
      viewer: { stats, uplink, delayMs: estimateDelayMs(stats, uplink), presentedFps: this.#presentedFps },
    });
  }

  // --- Avisos ---------------------------------------------------------------------------

  #notify(message: string): void {
    this.store.set({ notice: message });
  }

  clearNotice(): void {
    this.store.set({ notice: null });
  }

  notify(message: string): void {
    this.#notify(message);
  }
}

/** Camada extra de simulcast: metade da resolução, 30 fps, um quarto do bitrate. */
function lightLayerFor(target: Target, codec: Codec): VideoPreset {
  const height = Math.round(target.height / 2);
  const width = Math.round(widthFor(target.height) / 2);
  const kbps = Math.max(350, Math.round(presetBitrateKbps({ height: 480, fps: 30 }, codec) * (target.height >= 900 ? 0.8 : 0.4)));
  return new VideoPreset(width, height, kbps * 1000, 30);
}
