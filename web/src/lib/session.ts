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
  type RemoteVideoTrack,
  type TrackPublication,
  type TrackPublishOptions,
} from 'livekit-client';
import { ApiError } from './api.ts';
import { avatarCache } from './avatar-cache.ts';
import { inputSettings, effectiveMic } from './input-settings.ts';
import { playCallSound } from './call-sounds.ts';
import { audioContext, listAudioDevices, loadBoostWorklet, micPermission, PeakMeter, resumeAudio, type AudioDevices } from './audio.ts';
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
import { SpeechDetector } from './speaking.ts';
import { AvSyncController } from './av-sync.ts';
import { DEFAULT_MIC, GATE_FADE_MS, MicError, MicPipeline, OPEN_FADE_MS, type MicSettings } from './mic.ts';
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
import { latency } from './latency.ts';
import { avatars, rememberAvatar } from './avatars.ts';

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
  /**
   * As identidades da sala são contas (canais de voz dos grupos): o volume de cada pessoa fica guardado e
   * volta nas próximas chamadas. Nas salas por link a identidade muda a cada entrada e nada é guardado.
   */
  persistentIdentities?: boolean;
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
  accountId?: string;
  avatar?: string | null;
  name: string;
  isLocal: boolean;
  isHost: boolean;
  micOn: boolean;
  deafened?: boolean;
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
  /** Esta pessoa está assistindo (a faixa é assinada e aparece no palco). */
  watching: boolean;
  /** O que está sendo compartilhado: "Tela inteira", "Janela: VALORANT", "Aba do navegador". */
  source: string | null;
}

export type StageLayout = 'foco' | 'mosaico';

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
  /** Sincronia do áudio dos aplicativos: atraso informado por quem transmite e quanto a imagem está sendo segurada. */
  sync: { audioDelayMs: number | null; compensationMs: number; supported: boolean };
}

export interface ConnectionTiming { tokenMs: number; livekitMs: number; roomMs: number; participantsMs: number }

export interface SessionState {
  phase: Phase;
  connectionTiming?: ConnectionTiming;
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
  /** A transmissão em destaque (no modo foco é a grande; as estatísticas são dela). */
  selected: string | null;
  /** Transmissões que esta pessoa escolheu assistir (inclui a própria tela, como prévia). */
  watching: string[];
  layout: StageLayout;
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
  /** Som recebido desligado (vozes e transmissões), sem mexer nos volumes escolhidos. */
  deafened: boolean;
  /** Volume de 0 a 2 (2 = 200%) por voz (`voz:<id>`) e por transmissão (`<id>`), só para quem ouve. */
  volumes: Record<string, number>;
  /** Pessoas silenciadas só para esta conta (a voz delas não toca aqui; o volume escolhido fica guardado). */
  localMutes: Record<string, boolean>;
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
/** Preferências deste aparelho, separadas do que vai para o servidor. */
const MIC_WANTED_KEY = 'shareroom:microfone-ligado';
const DEAFENED_KEY = 'shareroom:ensurdecido';
const VOLUMES_KEY = 'shareroom:volumes-pessoas';
const LOCAL_MUTES_KEY = 'shareroom:mudos-para-mim';
/** Volume máximo por pessoa: 200%. */
export const MAX_PERSON_VOLUME = 2;
const SPEECH_TICK_MS = 40;
/** Depois de tirar o mouse, a prévia fica assinada mais um pouco: voltar logo não reconecta. */
const PREVIEW_RELEASE_MS = 2500;
/** Mutado por mais tempo que isto, o microfone é solto de verdade (o indicador de microfone do Windows apaga). */
const MIC_RELEASE_MS = 2 * 60_000;
/** Depois de fechar o som, quanto esperar para avisar o mute: o tempo de a rampa atravessar a rede e o buffer de quem ouve. */
const MUTE_SIGNAL_DELAY_MS = 350;
const VOICE_STREAM = 'voz';
const UPLINK_TOPIC = 'sr.uplink';
const validAvatar = (value: unknown): boolean => value === null || typeof value === 'string' && /^(arquivo:[A-Za-z0-9_-]{8,40}|padrao:\d{1,2})$/.test(value);
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

function participantProfile(metadata: string | undefined): { accountId?: string; avatar?: string | null } {
  try {
    const data = JSON.parse(metadata ?? '{}');
    return typeof data.accountId === 'string' ? { accountId: data.accountId, avatar: typeof data.avatar === 'string' ? data.avatar : null } : {};
  } catch { return {}; }
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
  #profileUnsubscribe: (() => void) | null = null;
  #avatarSignature = '';
  #soundPeers = new Set<string>();
  #leaveSounds = new Map<string, ReturnType<typeof setTimeout>>();
  #inputUnsubscribe: (() => void) | null = null;
  #access: SessionAccess | null = null;
  #deafened = new Map<string, boolean>();
  #capture: CaptureSession | null = null;
  #screenPub: LocalTrackPublication | null = null;
  #screenAudioPub: LocalTrackPublication | null = null;
  #micPub: LocalTrackPublication | null = null;
  #micRelease: ReturnType<typeof setTimeout> | null = null;
  /** Enquanto um filtro de ruído cuida do microfone, isto manda na supressão do navegador (null = vale a preferência). */
  #micBrowserNs: boolean | null = null;
  #appAudio: MediaStreamTrack | null = null;
  #preferredSurface: Surface | undefined;
  #leaving = false;
  #rejoining = false;
  #joining: Promise<void> | null = null;
  #departing: Promise<void> | null = null;
  readonly #deviceChange = () => { void this.refreshDevices(); };
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
  #audioDelaySource: (() => number | null) | null = null;
  readonly #avSync = new Map<string, AvSyncController>();
  /** Transmissões que a pessoa parou de assistir de propósito: não voltam sozinhas. */
  readonly #unwatched = new Set<string>();
  /** Prévias abertas (passar o mouse): contagem por pessoa e o atraso para soltar. */
  readonly #previews = new Map<string, number>();
  readonly #previewRelease = new Map<string, ReturnType<typeof setTimeout>>();
  #speechTimer: ReturnType<typeof setInterval> | null = null;
  readonly #speech = new Map<string, SpeechDetector>();
  /** Medidor do som decodificado de cada voz recebida (por faixa), para o indicador de fala. */
  readonly #voiceMeters = new Map<string, PeakMeter & { source: MediaStreamAudioSourceNode }>();
  /** Reforço com limitador de cada som recebido (por faixa), para volumes acima de 100%. */
  readonly #boosts = new Map<string, AudioWorkletNode>();
  #muteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Quando cada indicador acendeu pela última vez (diagnóstico e testes de latência). */
  readonly speechOnsets = new Map<string, number>();

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
      watching: [],
      layout: storage.get<StageLayout>('shareroom:layout-palco', 'foco') === 'mosaico' ? 'mosaico' : 'foco',
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
      deafened: storage.get<boolean>(DEAFENED_KEY, false) === true,
      volumes: {},
      localMutes: {},
      publisher: null,
      viewer: null,
    });

    this.#room = new Room({
      // O som recebido passa pelo contexto de áudio do app: permite volume acima de 100% (com limitador) e
      // mudanças de volume com rampa, sem estalo.
      webAudioMix: { audioContext: audioContext() },
      adaptiveStream: { pixelDensity: 'screen' },
      dynacast: false,
      // A captura de tela é nossa: uma queda de conexão não pode encerrá-la.
      stopLocalTrackOnUnpublish: false,
      disconnectOnPageLeave: true,
    });
    this.#wireRoom();
    navigator.mediaDevices?.addEventListener?.('devicechange', this.#deviceChange);
  }

  // --- Entrada, saída e reconexão ---------------------------------------------

  /** Chame dentro de um clique: destrava o áudio do navegador. */
  join(access: SessionAccess): Promise<void> {
    if (this.#joining) return this.#joining;
    if (this.store.get().phase === 'connected') return Promise.resolve();
    this.#joining = this.#join(access).finally(() => { this.#joining = null; });
    return this.#joining;
  }

  async #join(access: SessionAccess): Promise<void> {
    this.#inputUnsubscribe?.();
    this.#inputUnsubscribe = inputSettings.subscribe(() => {
      this.mic.configureInput(inputSettings.get());
      void this.updateMic({});
    });
    this.#profileUnsubscribe?.();
    this.#profileUnsubscribe = avatarCache.store.subscribe(() => this.#publishAvatar());
    this.#access = access;
    this.#leaving = false;
    this.#departing = null;
    navigator.mediaDevices?.addEventListener?.('devicechange', this.#deviceChange);
    if (access.persistentIdentities) {
      this.store.set({
        volumes: cleanVolumes(storage.get<unknown>(VOLUMES_KEY, {})),
        localMutes: cleanFlags(storage.get<unknown>(LOCAL_MUTES_KEY, {})),
      });
    }
    this.store.set({ phase: 'connecting', endReason: null, error: null });
    void resumeAudio();
    try {
      await this.#connect();
      playCallSound('join', this.store.get().deafened);
    } catch (error) {
      this.#inputUnsubscribe?.(); this.#inputUnsubscribe = null;
      this.#profileUnsubscribe?.(); this.#profileUnsubscribe = null;
      if (this.#leaving) return;
      const failure = joinFailure(error);
      this.store.set({ phase: 'idle', error: failure.message });
      throw failure;
    }
    // Só na entrada: reconexões nunca mexem no microfone.
    if (!this.#leaving) void this.#restoreMic().catch(() => this.#notify('Não foi possível restaurar o microfone. Você pode ligá-lo na chamada.'));
  }

  /**
   * Volta o microfone ao estado da última chamada. Só abre sozinho se o navegador já tem a permissão do
   * microfone (nunca pede permissão sem um clique) e se a pessoa pode falar neste canal.
   */
  async #restoreMic(): Promise<void> {
    if (this.#leaving || this.store.get().phase !== 'connected' || storage.get<boolean>(MIC_WANTED_KEY, false) !== true || !this.store.get().rights.speak) return;
    const permission = await micPermission();
    if (this.#leaving || this.store.get().phase !== 'connected') return;
    if (permission === 'granted') {
      await this.setMic(true, { remember: false });
    } else if (permission !== 'denied') {
      this.#notify('Seu microfone estava ligado na última chamada. Toque no microfone para ligar de novo.');
    }
  }

  async leave(): Promise<void> {
    if (this.#departing) return this.#departing;
    if (!this.#leaving && this.store.get().phase === 'connected') playCallSound('leave', this.store.get().deafened);
    this.#leaving = true;
    this.#profileUnsubscribe?.(); this.#profileUnsubscribe = null;
    for (const timer of this.#leaveSounds.values()) clearTimeout(timer);
    this.#leaveSounds.clear(); this.#soundPeers.clear();
    this.#inputUnsubscribe?.(); this.#inputUnsubscribe = null;
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.#deviceChange);
    this.#departing = (async () => {
      await this.#teardownMedia();
      await this.#room.disconnect();
      this.#stopTimer();
      this.store.set({ phase: 'ended', endReason: 'saiu', participants: [], streams: [], selected: null, watching: [] });
    })();
    return this.#departing;
  }

  async #connect(): Promise<void> {
    const start = performance.now();
    const grant = await this.#access!.grant();
    const granted = performance.now();
    latency.record('voice', 'grant', performance.now() - start);
    if (this.#leaving) throw new Error('Entrada cancelada.');
    this.store.set({ roomName: grant.room.name, identity: grant.identity });
    const connecting = performance.now();
    // Nada é assinado sozinho: vozes sempre, telas só quando a pessoa assiste ou abre a prévia.
    await this.#room.connect(grant.url, grant.token, { autoSubscribe: false });
    const connected = performance.now();
    latency.record('voice', 'livekit', connected - connecting);
    if (this.#leaving) { await this.#room.disconnect(); throw new Error('Entrada cancelada.'); }
    void this.#room.startAudio().catch(() => undefined);
    for (const participant of this.#room.remoteParticipants.values()) this.#soundPeers.add(participant.identity);
    this.store.set({
      phase: 'connected',
      connectionTiming: { tokenMs: granted - start, livekitMs: connected - granted, roomMs: connected - start, participantsMs: connected - start },
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
    this.#applySubscriptions();
    this.#publishDeafened();
    for (const participant of [this.#room.localParticipant, ...this.#room.remoteParticipants.values()]) this.#rememberParticipant(participant);
    this.#publishAvatar(true);
    this.#refresh();
    latency.record('voice', 'participants', performance.now() - start);
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
      this.store.set({ phase: 'ended', endReason, participants: [], streams: [], selected: null, watching: [], publisher: null, viewer: null });
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

  #markReconnecting(): void {
    for (const timer of this.#leaveSounds.values()) clearTimeout(timer);
    this.#leaveSounds.clear();
    this.store.set({ phase: 'reconnecting' });
  }

  async #rejoin(): Promise<void> {
    if (this.#rejoining) return;
    this.#rejoining = true;
    this.#markReconnecting();
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
    // Mutado, a faixa só volta a ser publicada quando a pessoa desmutar.
    if (this.store.get().micOn && this.mic.active) {
      await this.#publishMic();
    }
  }

  async #teardownMedia(): Promise<void> {
    this.#capture?.stop();
    this.#capture = null;
    this.#cancelMicRelease();
    this.#cancelMuteSignal();
    this.mic.stop();
    this.#clearAudioElements();
    this.store.set({ share: IDLE_SHARE, micOn: false, publisher: null });
  }

  // --- Eventos da sala -----------------------------------------------------------

  #wireRoom(): void {
    const room = this.#room;
    const refresh = () => this.#refresh();
    room
      .on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        this.#rememberParticipant(participant);
        const state = this.store.get();
        const timer = this.#leaveSounds.get(participant.identity);
        if (timer) clearTimeout(timer);
        this.#leaveSounds.delete(participant.identity);
        if (!this.#leaving && state.phase === 'connected' && !this.#soundPeers.has(participant.identity)) {
          playCallSound('join', state.deafened);
        }
        this.#soundPeers.add(participant.identity);
        this.#publishAvatar(true);
        refresh();
        this.#publishDeafened();
      })
      .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        const state = this.store.get();
        if (!this.#leaving && state.phase === 'connected' && this.#soundPeers.has(participant.identity) && !this.#leaveSounds.has(participant.identity)) {
          const timer = setTimeout(() => {
            this.#leaveSounds.delete(participant.identity);
            if (!this.#leaving && this.store.get().phase === 'connected' && !room.remoteParticipants.has(participant.identity)) {
              this.#soundPeers.delete(participant.identity);
              playCallSound('leave', this.store.get().deafened);
            }
          }, 200);
          this.#leaveSounds.set(participant.identity, timer);
        }
        this.#uplinks.delete(participant.identity);
        this.#deafened.delete(participant.identity);
        refresh();
      })
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.TrackMuted, (publication: TrackPublication, participant: Participant) => {
        if (participant.isLocal && publication === this.#micPub && this.store.get().micOn && this.#muteTimer === null) {
          void this.mic.setOpen(false);
          this.store.set({ micOn: false });
        }
        refresh();
      })
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
        // O servidor pode tirar a faixa (perdeu a permissão de falar): na próxima vez ela é publicada de novo.
        if (publication === this.#micPub) this.#micPub = null;
        refresh();
      })
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.ParticipantNameChanged, refresh)
      .on(RoomEvent.ParticipantMetadataChanged, (_metadata: string | undefined, participant: Participant) => { this.#rememberParticipant(participant); refresh(); })
      .on(RoomEvent.ConnectionQualityChanged, refresh)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) this.#attachAudio(track as RemoteAudioTrack, publication.trackSid, publication.source);
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) this.#detachAudio(track as RemoteAudioTrack, publication.trackSid);
        refresh();
      })
      .on(RoomEvent.TrackPublished, () => this.#applySubscriptions())
      .on(RoomEvent.ParticipantPermissionsChanged, (_previous, participant) => {
        if (participant.isLocal) this.#onPublishRights();
      })
      .on(RoomEvent.RoomMetadataChanged, (metadata: string) => {
        this.store.set({ locked: lockedFromMetadata(metadata) });
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        this.store.set({ audioBlocked: !room.canPlaybackAudio });
      })
      .on(RoomEvent.Reconnecting, () => this.#markReconnecting())
      .on(RoomEvent.SignalReconnecting, () => this.#markReconnecting())
      .on(RoomEvent.Reconnected, () => {
        this.store.set({ phase: 'connected' });
        this.#publishDeafened();
        this.#settleUntil = Date.now() + SETTLE_MS;
        refresh();
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => this.#onDisconnected(reason))
      .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
        if (topic === 'cosmic.avatar' && participant && payload.byteLength <= 512) {
          try {
            const data = JSON.parse(new TextDecoder().decode(payload));
            const profile = participantProfile(participant.metadata);
            if (profile.accountId && data.accountId === profile.accountId && validAvatar(data.avatar)) avatarCache.update(profile.accountId, data.avatar);
          } catch { /* ignore malformed or mismatched sender */ }
          return;
        }
        if (topic === 'cosmic.deafened' && participant) {
          const value = new TextDecoder().decode(payload);
          if (value === 'true' || value === 'false') {
            this.#deafened.set(participant.identity, value === 'true');
            refresh();
          }
          return;
        }
        if (topic !== UPLINK_TOPIC || !participant) return;
        try {
          this.#uplinks.set(participant.identity, JSON.parse(new TextDecoder().decode(payload)) as UplinkInfo);
        } catch {
          // mensagem malformada: ignora
        }
      });
  }

  #rememberParticipant(participant: Participant): void {
    const profile = participantProfile(participant.metadata);
    if (profile.accountId && avatars.get().byUser[profile.accountId] === undefined) rememberAvatar(profile.accountId, profile.avatar);
  }

  #refresh(): void {
    const room = this.#room;
    const state = this.store.get();
    if (state.phase === 'ended' || state.phase === 'idle') return;

    const everyone: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    const participants: ParticipantView[] = everyone.map((participant) => ({
      identity: participant.identity,
      ...participantProfile(participant.metadata),
      name: participant.name || 'Sem nome',
      isLocal: participant === room.localParticipant,
      isHost: isHostMetadata(participant.metadata),
      // O próprio participante mostra o estado escolhido na hora (o aviso ao servidor pode estar a caminho).
      micOn: participant === room.localParticipant ? state.micOn : participant.isMicrophoneEnabled,
      deafened: participant.isLocal ? state.deafened : this.#deafened.get(participant.identity),
      speaking: this.#speech.get(participant.identity)?.speaking ?? participant.isSpeaking,
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
        watching: false,
        source: describeSource(publication.trackName),
      });
    }

    // Quem parou de transmitir sai da lista de assistidos (e pode voltar a ser assistido sozinho depois).
    const live = new Set(streams.map((stream) => stream.id));
    for (const id of [...this.#unwatched]) if (!live.has(id)) this.#unwatched.delete(id);
    let watching = state.watching.filter((id) => live.has(id));
    // Sem nada assistido, assiste sozinho a primeira tela de outra pessoa (como antes), a menos que a pessoa
    // tenha parado de assisti-la de propósito. As outras ficam na lista, com o botão "Assistir".
    if (!watching.some((id) => id !== state.identity)) {
      const next = streams.find((stream) => !stream.isLocal && !this.#unwatched.has(stream.id));
      if (next) watching = [...watching, next.id];
    }
    const watchingSet = new Set(watching);
    for (const stream of streams) stream.watching = watchingSet.has(stream.id);

    // Destaque: mantém a escolha; se ela sumiu, prefere a tela de outra pessoa à própria.
    let selected = state.selected;
    if (!selected || !watchingSet.has(selected)) {
      selected = watching.find((id) => id !== state.identity) ?? watching[0] ?? null;
    }

    const changed = watching.length !== state.watching.length || watching.some((id, index) => id !== state.watching[index]);
    this.store.set({ participants, streams, selected, watching, link: linkQuality(room.localParticipant.connectionQuality) });
    if (changed) this.#applySubscriptions();
    this.#applyAudioRouting();
  }

  // --- Áudio recebido --------------------------------------------------------------

  #attachAudio(track: RemoteAudioTrack, sid: string, source: Track.Source): void {
    const element = track.attach();
    if (source === Track.Source.Microphone) {
      try {
        const ctx = audioContext();
        const meter = Object.assign(new PeakMeter(ctx, 1024), {
          source: ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])),
        });
        meter.source.connect(meter.node);
        this.#voiceMeters.set(sid, meter);
      } catch {
        // sem medidor: o indicador usa o aviso do servidor
      }
    }
    element.style.display = 'none';
    document.body.appendChild(element);
    this.#audioElements.set(sid, element);
    const sinkId = this.store.get().outputDeviceId;
    if (sinkId) void track.setSinkId(sinkId).catch(() => undefined);
    this.#applyAudioRouting();
    void this.#addBoost(track, sid);
  }

  /** Encaixa o reforço com limitador no caminho do som desta faixa (antes do ganho do LiveKit). */
  async #addBoost(track: RemoteAudioTrack, sid: string): Promise<void> {
    try {
      await loadBoostWorklet();
    } catch {
      return; // sem AudioWorklet: o volume fica limitado a 100%
    }
    if (!this.#audioElements.has(sid) || this.#boosts.has(sid)) return;
    const node = new AudioWorkletNode(audioContext(), 'sr-boost', { numberOfInputs: 1, numberOfOutputs: 1 });
    this.#boosts.set(sid, node);
    track.setWebAudioPlugins([node]);
    this.#applyAudioRouting();
  }

  #detachAudio(track: RemoteAudioTrack, sid: string): void {
    for (const element of track.detach()) element.remove();
    this.#voiceMeters.get(sid)?.source.disconnect();
    this.#voiceMeters.delete(sid);
    this.#boosts.get(sid)?.disconnect();
    this.#boosts.delete(sid);
    // Quando a faixa é despublicada o LiveKit já a soltou do elemento: remove pelo nosso registro.
    this.#audioElements.get(sid)?.remove();
    this.#audioElements.delete(sid);
  }

  #clearAudioElements(): void {
    for (const meter of this.#voiceMeters.values()) meter.source.disconnect();
    this.#voiceMeters.clear();
    for (const node of this.#boosts.values()) node.disconnect();
    this.#boosts.clear();
    for (const element of this.#audioElements.values()) element.remove();
    this.#audioElements.clear();
  }

  /** Toca o som das telas que a pessoa assiste (cada uma com o seu volume); as vozes tocam sempre. */
  #applyAudioRouting(): void {
    const state = this.store.get();
    const { volumes, localMutes } = state;
    const watching = new Set(state.watching);
    const outputVolume = state.deafened ? 0 : state.outputVolume;
    for (const participant of this.#room.remoteParticipants.values()) {
      const screenAudio = participant.getTrackPublication(Track.Source.ScreenShareAudio) as RemoteTrackPublication | undefined;
      if (screenAudio) {
        const wanted = watching.has(participant.identity);
        if (screenAudio.isEnabled !== wanted) screenAudio.setEnabled(wanted);
        this.#setTrackVolume(screenAudio, outputVolume, volumes[participant.identity] ?? 1);
      }
      const voice = participant.getTrackPublication(Track.Source.Microphone) as RemoteTrackPublication | undefined;
      if (voice) this.#setTrackVolume(voice, localMutes[participant.identity] ? 0 : outputVolume, volumes[`voz:${participant.identity}`] ?? 1);
    }
  }

  /**
   * Até 100% quem atenua é o ganho do LiveKit (com rampa); de 100% a 200% quem reforça é o nó com limitador,
   * que segura os picos abaixo de -1 dBFS em vez de cortar a onda. Só muda o que esta pessoa ouve.
   */
  #setTrackVolume(publication: RemoteTrackPublication, master: number, level: number): void {
    const track = publication.track as RemoteAudioTrack | undefined;
    if (!track) return;
    track.setVolume(Math.min(1, level) * master);
    const boost = this.#boosts.get(publication.trackSid)?.parameters.get('boost');
    if (boost) {
      const target = Math.max(1, Math.min(MAX_PERSON_VOLUME, level));
      if (Math.abs(boost.value - target) > 0.001) boost.setTargetAtTime(target, audioContext().currentTime, 0.02);
    }
  }

  /** O navegador bloqueou o som até um gesto: chame no clique do botão "Ativar som". */
  async unlockAudio(): Promise<void> {
    await resumeAudio();
    await this.#room.startAudio().catch(() => undefined);
    this.store.set({ audioBlocked: !this.#room.canPlaybackAudio });
  }

  /** Assiste a uma transmissão e a põe em destaque. */
  select(streamId: string): void {
    this.watch(streamId);
    if (this.store.get().selected === streamId) return;
    this.#viewCounters = null;
    this.#presentedFps = null;
    this.store.set({ selected: streamId, viewer: null });
  }

  /** Passa a assistir uma transmissão (sem tirar as outras). */
  watch(streamId: string): void {
    this.#unwatched.delete(streamId);
    const { watching } = this.store.get();
    if (watching.includes(streamId)) return;
    this.store.set({ watching: [...watching, streamId] });
    this.#applySubscriptions();
    this.#refresh();
  }

  /** Para de assistir: a tela deixa de ser recebida e decodificada. */
  unwatch(streamId: string): void {
    this.#unwatched.add(streamId);
    const state = this.store.get();
    if (!state.watching.includes(streamId)) return;
    const watching = state.watching.filter((id) => id !== streamId);
    const selected = state.selected === streamId ? (watching.find((id) => id !== state.identity) ?? watching[0] ?? null) : state.selected;
    if (selected !== state.selected) {
      this.#viewCounters = null;
      this.#presentedFps = null;
    }
    this.store.set({ watching, selected, viewer: selected !== state.selected ? null : state.viewer });
    this.#applySubscriptions();
    this.#refresh();
  }

  setLayout(layout: StageLayout): void {
    storage.set('shareroom:layout-palco', layout);
    this.store.set({ layout });
  }

  /**
   * Abre a prévia de uma transmissão (passar o mouse sobre quem transmite). Se a pessoa já assiste, usa a
   * mesma faixa; senão assina só o vídeo, sem som, enquanto a prévia estiver aberta. Devolve a função que
   * fecha a prévia; a assinatura é solta um pouco depois, para não reconectar a cada passada do mouse.
   */
  openPreview(streamId: string): () => void {
    const pending = this.#previewRelease.get(streamId);
    if (pending) {
      clearTimeout(pending);
      this.#previewRelease.delete(streamId);
    }
    this.#previews.set(streamId, (this.#previews.get(streamId) ?? 0) + 1);
    this.#applySubscriptions();
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      const count = (this.#previews.get(streamId) ?? 1) - 1;
      // Com zero prévias abertas a entrada continua no mapa durante a espera (a faixa segue assinada).
      this.#previews.set(streamId, count);
      if (count > 0) return;
      this.#previewRelease.set(
        streamId,
        setTimeout(() => {
          this.#previewRelease.delete(streamId);
          if (this.#previews.get(streamId) !== 0) return;
          this.#previews.delete(streamId);
          this.#applySubscriptions();
        }, PREVIEW_RELEASE_MS),
      );
    };
  }

  /** Volume (0 a 2, ou seja até 200%) de uma voz (`voz:<id>`) ou transmissão (`<id>`), só para quem está ouvindo. */
  setVolume(key: string, volume: number): void {
    const value = Math.round(Math.min(MAX_PERSON_VOLUME, Math.max(0, Number.isFinite(volume) ? volume : 1)) * 100) / 100;
    this.store.set((state) => ({ volumes: { ...state.volumes, [key]: value } }));
    if (this.#access?.persistentIdentities) storage.set(VOLUMES_KEY, this.store.get().volumes);
    this.#applyAudioRouting();
  }

  /** Silencia (ou volta a ouvir) uma pessoa só para esta conta. */
  setLocalMute(identity: string, muted: boolean): void {
    this.store.set((state) => {
      const localMutes = { ...state.localMutes };
      if (muted) localMutes[identity] = true;
      else delete localMutes[identity];
      return { localMutes };
    });
    if (this.#access?.persistentIdentities) storage.set(LOCAL_MUTES_KEY, this.store.get().localMutes);
    this.#applyAudioRouting();
  }

  /** Liga ou desliga tudo o que a pessoa ouve da sala. */
  #publishAvatar(force = false): void {
    if (this.store.get().phase !== 'connected' || this.#leaving) return;
    const profile = participantProfile(this.#room.localParticipant.metadata);
    if (!profile.accountId) return;
    const avatar = avatarCache.resolve(profile.accountId, profile.avatar) ?? null;
    const signature = JSON.stringify({ accountId: profile.accountId, avatar });
    if (!force && this.#avatarSignature === signature) return;
    this.#avatarSignature = signature;
    void this.#room.localParticipant.publishData(new TextEncoder().encode(signature), { reliable: true, topic: 'cosmic.avatar' }).catch(() => undefined);
  }

  #publishDeafened(): void {
    if (this.store.get().phase !== 'connected') return;
    void this.#room.localParticipant.publishData(new TextEncoder().encode(String(this.store.get().deafened)), { reliable: true, topic: 'cosmic.deafened' }).catch(() => undefined);
  }

  setDeafened(deafened: boolean): void {
    storage.set(DEAFENED_KEY, deafened);
    this.store.set({ deafened });
    this.#publishDeafened();
    this.#refresh();
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
    this.#applySubscriptions();
    if (before.highQuality !== patch.highQuality && this.#capture) void this.#applyTarget();
    this.#refresh();
  }

  /**
   * Decide o que receber. Vozes: sempre. Vídeo de uma tela: só se a pessoa assiste ou está com a prévia
   * aberta. Som de uma tela: só se assiste. Quem não pode assistir transmissões não recebe nenhuma tela.
   * Uma tela que ninguém olha não gasta banda nem decodificação.
   */
  #applySubscriptions(): void {
    const { watch } = this.store.get().rights;
    const watching = new Set(this.store.get().watching);
    for (const participant of this.#room.remoteParticipants.values()) {
      const id = participant.identity;
      for (const publication of participant.trackPublications.values()) {
        let want: boolean;
        if (publication.source === Track.Source.ScreenShare) want = watch && (watching.has(id) || this.#previews.has(id));
        else if (publication.source === Track.Source.ScreenShareAudio) want = watch && watching.has(id);
        else want = true;
        if (publication.isDesired !== want) publication.setSubscribed(want);
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
      void this.setMic(false, { remember: false });
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
    // A própria tela aparece no palco como prévia; não toma o destaque da tela de outra pessoa.
    const { identity, watching, selected } = this.store.get();
    this.#unwatched.delete(identity);
    this.store.set({ watching: watching.includes(identity) ? watching : [...watching, identity], selected: selected ?? identity });
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
    // SDK reconnects may replace publication objects. Read the current room tracks
    // so stopping a share also removes publications restored by LiveKit.
    const publications = [...local.trackPublications.values()].filter((publication) =>
      publication.source === Track.Source.ScreenShare || publication.source === Track.Source.ScreenShareAudio,
    );
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
      // O nome da faixa diz a quem assiste o que está sendo compartilhado.
      name: sourceName(capture),
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

  async setMic(on: boolean, { remember = true }: { remember?: boolean } = {}): Promise<void> {
    const state = this.store.get();
    if (remember) storage.set(MIC_WANTED_KEY, on);
    if (state.micBusy || state.micOn === on || on && (this.#leaving || state.phase !== 'connected')) return;
    if (on && !state.rights.speak) {
      this.#notify('Você não tem permissão para falar neste canal.');
      return;
    }
    this.store.set({ micBusy: true });
    try {
      if (on) {
        if (this.#leaving) return;
        this.#cancelMicRelease();
        await resumeAudio();
        const opening = !this.mic.active;
        if (opening) await this.mic.start(this.#micSettings());
        if (this.#leaving || this.store.get().phase !== 'connected') { this.mic.stop(); return; }
        // A faixa publicada é sempre a mesma: desmutar só a religa. Nada de reabrir aparelho nem republicar.
        // Se o aviso de mute ainda não tinha saído, basta cancelá-lo.
        const pendingMute = this.#muteTimer !== null;
        this.#cancelMuteSignal();
        if (!this.#micPub) await this.#publishMic();
        else if (!pendingMute || this.#micPub.isMuted) await this.#micPub.unmute();
        await this.mic.setOpen(true, opening ? OPEN_FADE_MS : GATE_FADE_MS);
        this.store.set({ micOn: true });
        void this.refreshDevices();
      } else {
        // Fecha o som com rampa na hora: daqui em diante só sai silêncio. O aviso de mute (que faz quem ouve
        // desligar a faixa) vai depois, quando os últimos pacotes com a rampa já chegaram do outro lado;
        // avisar antes corta a onda no meio na casa de quem ouve, e esse é o estalo de mutar.
        await this.mic.setOpen(false);
        this.store.set({ micOn: false });
        const publication = this.#micPub;
        this.#muteTimer = setTimeout(() => {
          this.#muteTimer = null;
          if (!this.store.get().micOn && publication === this.#micPub) void publication?.mute().catch(() => undefined);
        }, MUTE_SIGNAL_DELAY_MS);
        this.#micRelease = setTimeout(() => {
          this.#micRelease = null;
          if (!this.store.get().micOn) this.mic.stop();
        }, MIC_RELEASE_MS);
      }
    } catch (error) {
      this.#cancelMicRelease();
      this.mic.stop();
      this.store.set({ micOn: false });
      this.#notify(error instanceof MicError ? error.message : 'Não foi possível ligar o microfone.');
    } finally {
      this.store.set({ micBusy: false });
      this.#refresh();
    }
  }

  #cancelMuteSignal(): void {
    if (this.#muteTimer) clearTimeout(this.#muteTimer);
    this.#muteTimer = null;
  }

  #cancelMicRelease(): void {
    if (this.#micRelease) clearTimeout(this.#micRelease);
    this.#micRelease = null;
  }

  async #publishMic(): Promise<void> {
    this.#micPub = await this.#room.localParticipant.publishTrack(this.mic.output, {
      source: Track.Source.Microphone,
      name: 'microfone',
      stream: VOICE_STREAM,
      // Sem DTX: nas pausas o Opus passaria a mandar só "ruído de conforto", que o outro lado ouve como chiado
      // e que faz o começo de cada frase entrar com um degrau. A banda extra é pequena (voz em Opus).
      dtx: false,
      red: true,
    });
  }

  /** Muda as opções do microfone. Trocar de aparelho ou de filtro reabre a captura, sem republicar. */
  prepareMicTest(): void {
    if (this.store.get().micOn || this.store.get().micBusy) throw new MicError('Desligue o microfone da chamada antes de testar.');
    this.#cancelMicRelease(); this.mic.stop();
  }

  async updateMic(patch: Partial<MicSettings>): Promise<void> {
    const before = this.mic.settings ?? this.store.get().mic;
    const mic = { ...this.store.get().mic, ...patch };
    storage.set('shareroom:microfone', mic);
    this.store.set({ mic });
    if (!this.mic.active) return;

    const effective = this.#micSettings();
    const reopen = before.deviceId !== effective.deviceId || before.echoCancellation !== effective.echoCancellation ||
      before.noiseSuppression !== effective.noiseSuppression || before.autoGainControl !== effective.autoGainControl;
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
    const mic = effectiveMic(this.store.get().mic, inputSettings.get());
    return this.#micBrowserNs === null ? mic : { ...mic, noiseSuppression: this.#micBrowserNs, autoGainControl: this.#micBrowserNs === false ? false : mic.autoGainControl };
  }

  /**
   * Encaixa (ou tira, com null) um filtro entre o microfone e a sala, sem republicar a faixa.
   * `browserNoiseSuppression` força a supressão convencional do navegador enquanto durar: `false` quando o
   * filtro de IA assume (para a voz não ser filtrada duas vezes), `true` quando ela é o substituto, e
   * `null` devolve o controle à preferência do usuário.
   */
  async setMicFilter(processor: AudioNode | null, browserNoiseSuppression: boolean | null): Promise<void> {
    const before = this.#micSettings();
    await this.mic.setProcessor(processor ? { input: processor, output: processor } : null);
    this.#micBrowserNs = browserNoiseSuppression;
    const after = this.#micSettings();
    if (!this.mic.active || before.noiseSuppression === after.noiseSuppression && before.autoGainControl === after.autoGainControl) return;
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
    if (!this.#speechTimer) this.#speechTimer = setInterval(() => this.#speechTick(), SPEECH_TICK_MS);
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.#tick(), 1000);
  }

  #stopTimer(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#speechTimer) clearInterval(this.#speechTimer);
    this.#speechTimer = null;
    this.#speech.clear();
  }

  /**
   * Indicador de fala com pouca latência. Para quem fala: o medidor do próprio microfone (antes da rede).
   * Para os outros: o nível do som de cada voz já decodificado, o mesmo que vai para os alto-falantes, então
   * o anel acende junto com o som que se ouve. O evento de "quem está falando" do servidor chega várias
   * centenas de milissegundos depois e fica só como reserva quando não há como medir (áudio bloqueado).
   * O LiveKit não repassa o nível de cada pacote (`audioLevel`) a quem recebe; por isso a medição é local.
   */
  #speechTick(): void {
    const now = performance.now();
    const seen = new Set<string>();
    let changed = false;
    const feed = (identity: string, level: number) => {
      seen.add(identity);
      let detector = this.#speech.get(identity);
      if (!detector) {
        detector = new SpeechDetector();
        this.#speech.set(identity, detector);
      }
      const before = detector.speaking;
      const after = detector.update(level, now);
      if (after !== before) {
        changed = true;
        if (after) this.speechOnsets.set(identity, Date.now());
      }
    };

    const local = this.#room.localParticipant;
    if (local.identity) feed(local.identity, this.store.get().micOn && this.mic.open && (!inputSettings.get().enabled || this.mic.stats?.open) ? this.mic.meter.readRms() : 0);

    const running = audioContext().state === 'running';
    for (const participant of this.#room.remoteParticipants.values()) {
      const publication = participant.getTrackPublication(Track.Source.Microphone) as RemoteTrackPublication | undefined;
      const meter = publication ? this.#voiceMeters.get(publication.trackSid) : undefined;
      if (!meter || !running) continue;
      feed(participant.identity, publication!.isMuted ? 0 : meter.readRms());
    }

    for (const identity of [...this.#speech.keys()]) {
      if (!seen.has(identity)) this.#speech.delete(identity);
    }
    if (!changed) return;
    this.store.set((state) => ({
      participants: state.participants.map((participant) => {
        const detector = this.#speech.get(participant.identity);
        return detector && detector.speaking !== participant.speaking ? { ...participant, speaking: detector.speaking } : participant;
      }),
    }));
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

  /** O que quem transmite informou sobre a própria transmissão (resolução e FPS na origem). */
  uplinkFor(identity: string): UplinkInfo | null {
    return this.#uplinks.get(identity) ?? null;
  }

  /** Quem fornece o atraso medido do áudio dos aplicativos (o mixer, quando está em uso). */
  setAudioDelaySource(source: (() => number | null) | null): void {
    this.#audioDelaySource = source;
  }

  /** Atraso do áudio que acompanha a tela antes do WebRTC. Só o áudio dos aplicativos passa por filas próprias. */
  #screenAudioDelayMs(): number | null {
    if (!this.#screenAudioPub || this.store.get().audioSource !== 'apps') return null;
    return this.#audioDelaySource?.() ?? null;
  }

  #broadcastUplink(stats: PublisherStats, target: Target, mode: 'auto' | 'manual'): void {
    if (this.#room.remoteParticipants.size === 0) return;
    const info: UplinkInfo = {
      audioDelayMs: this.#screenAudioDelayMs(),
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

  /** Segura o vídeo da tela o tanto que o áudio dos aplicativos de quem transmite chega atrasado. */
  #syncScreen(
    trackSid: string,
    track: RemoteVideoTrack,
    videoBufferMs: number | null,
    uplink: UplinkInfo | null,
    participant: RemoteParticipant,
  ): ViewerView['sync'] {
    const receiver = track.receiver as (RTCRtpReceiver & { jitterBufferTarget?: number | null }) | undefined;
    const supported = Boolean(receiver && 'jitterBufferTarget' in receiver);
    // Só faz sentido com o som da tela realmente chegando para esta pessoa.
    const screenAudio = participant.getTrackPublication(Track.Source.ScreenShareAudio);
    const audioDelayMs = screenAudio?.isSubscribed && screenAudio.isEnabled ? (uplink?.audioDelayMs ?? null) : null;
    for (const sid of this.#avSync.keys()) if (sid !== trackSid) this.#avSync.delete(sid);
    let controller = this.#avSync.get(trackSid);
    if (!controller) {
      controller = new AvSyncController();
      this.#avSync.set(trackSid, controller);
    }
    const before = controller.target;
    const target = controller.update({ videoBufferMs, audioDelayMs });
    if (supported && target !== before) {
      try {
        receiver!.jitterBufferTarget = target;
      } catch {
        // navegador recusou o valor: segue sem compensação
      }
    }
    return { audioDelayMs, compensationMs: supported ? controller.compensationMs : 0, supported };
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
    const sync = this.#syncScreen(publication.trackSid, track as RemoteVideoTrack, stats.bufferMs, uplink, participant);
    this.store.set({
      viewer: { stats, uplink, delayMs: estimateDelayMs(stats, uplink), presentedFps: this.#presentedFps, sync },
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

/** Nome da faixa da tela: "tela|<superfície>|<rótulo>". Quem assiste lê com `describeSource`. */
function sourceName(capture: CaptureSession): string {
  const label = capture.surface === 'browser' ? '' : capture.video.label.replace(/[|\n\r]/g, ' ').trim().slice(0, 80);
  return `tela|${capture.surface ?? ''}|${label}`;
}

/** Texto curto do que está sendo compartilhado, a partir do nome da faixa. */
export function describeSource(trackName: string | undefined): string | null {
  if (!trackName?.startsWith('tela|')) return null;
  const [, surface, label] = trackName.split('|');
  if (surface === 'monitor') return label && !/^screen|^tela/i.test(label) ? `Tela inteira (${label})` : 'Tela inteira';
  if (surface === 'window') return label ? `Janela: ${label}` : 'Uma janela';
  if (surface === 'browser') return 'Aba do navegador';
  return null;
}

/** Volumes guardados: só números de 0 a 2, no máximo 500 pessoas. */
function cleanVolumes(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 500)) {
    if (typeof key === 'string' && key.length <= 80 && typeof value === 'number' && Number.isFinite(value)) {
      out[key] = Math.min(MAX_PERSON_VOLUME, Math.max(0, value));
    }
  }
  return out;
}

function cleanFlags(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 500)) {
    if (typeof key === 'string' && key.length <= 80 && value === true) out[key] = true;
  }
  return out;
}
