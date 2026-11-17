import {
  ChartColumn,
  Eye,
  EyeOff,
  LayoutGrid,
  LoaderCircle,
  Maximize,
  Minimize,
  Monitor,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Rows2,
  Tv,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { formatFps, formatHeight } from '../../lib/format.ts';
import type { RoomSession, StreamView } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { Button, cx, IconButton, Menu, SignalBars } from '../ui.tsx';
import { CallGrid, type PersonLookup } from './CallGrid.tsx';
import { StatsCard } from './StatsCard.tsx';
import { PersonVolume } from './PersonVolume.tsx';
import { toggleFullscreen, useAttachedTrack, useMeasuredVideo, type FrameVideo } from './video.ts';

export interface StageHandle {
  toggleFullscreen(): void;
}

function VolumeMenu({ session, stream, volume, side = 'top' }: { session: RoomSession; stream: StreamView; volume: number; side?: 'top' | 'bottom' }) {
  return (
    <Menu
      side={side}
      trigger={({ toggle }) => (
        <IconButton label={`Volume da transmissão de ${stream.name}`} onClick={toggle} data-testid="stream-volume">
          {volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </IconButton>
      )}
    >
      <PersonVolume session={session} volumeKey={stream.id} name={`Som da tela de ${stream.name}`} className="w-64 px-2 py-1.5" />
    </Menu>
  );
}

/**
 * Uma transmissão no palco. A principal (em destaque) mostra as medições da conexão; as outras medem o que
 * o próprio elemento de vídeo pinta. Cada uma tem tela cheia, volume e "parar de assistir".
 */
function StreamTile({
  session,
  stream,
  primary,
  compact,
  paused,
  real,
  health,
  volume,
  immersiveHidden,
  onFocus,
}: {
  session: RoomSession;
  stream: StreamView;
  primary: boolean;
  compact: boolean;
  paused: boolean;
  real: { height: number | null; fps: number | null } | null;
  health: number;
  volume: number;
  immersiveHidden: boolean;
  onFocus?: () => void;
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<FrameVideo>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const track = stream.track;
  useAttachedTrack(videoRef, track, !paused);
  const report = useCallback((fps: number | null) => session.reportPresentedFps(fps), [session]);
  const measured = useMeasuredVideo(videoRef, track !== null && !paused && !stream.isLocal, primary ? report : undefined);
  const shown = primary && real ? real : measured;

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === tileRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  return (
    <div
      ref={tileRef}
      className={cx(
        'group relative min-h-0 overflow-hidden bg-black',
        compact ? 'aspect-video h-full shrink-0 cursor-pointer rounded-lg opacity-80 transition-opacity hover:opacity-100' : 'size-full',
        !primary && !compact && 'rounded-lg',
      )}
      onClick={compact ? onFocus : undefined}
      data-testid={primary ? 'stage-primary' : 'stage-tile'}
      data-stream={stream.id}
    >
      <video
        ref={videoRef}
        data-testid={primary ? 'stage-video' : 'stage-tile-video'}
        className={cx('absolute inset-0 size-full object-contain', (!track || paused) && 'invisible')}
        autoPlay
        playsInline
        muted
      />
      <div
        className={cx(
          'pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 transition-opacity duration-200',
          immersiveHidden && 'opacity-0',
        )}
      >
        <span
          className={cx(
            'flex max-w-[75%] min-w-0 items-center gap-2 rounded-lg bg-black/55 backdrop-blur',
            compact ? 'px-2 py-0.5 text-xs font-bold' : 'px-2.5 py-1 text-sm font-semibold',
          )}
          data-testid={primary ? 'stage-owner' : 'stage-tile-owner'}
        >
          <Monitor className={cx('shrink-0 text-brand-300', compact ? 'size-3.5' : 'size-4')} aria-hidden="true" />
          <span className="min-w-0 truncate">
            {stream.isLocal ? 'Você está compartilhando a tela' : `Tela de ${stream.name}`}
            {!compact && stream.source && <span className="font-normal text-fog-400"> — {stream.source}</span>}
          </span>
        </span>
        {!compact && shown.height !== null && (
          <span
            className="flex items-center gap-2 rounded-lg bg-black/55 px-2.5 py-1 text-sm font-bold backdrop-blur"
            title="Valores medidos na transmissão, não os pedidos"
            data-testid={primary ? 'stage-real' : 'stage-tile-real'}
          >
            {primary && <SignalBars level={health} />}
            {formatHeight(shown.height)} • {formatFps(shown.fps)}
          </span>
        )}
      </div>
      {!track && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-fog-300">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          {!compact && 'Conectando à transmissão…'}
        </div>
      )}
      {primary && track && paused && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-lg font-extrabold">{stream.isLocal ? 'Prévia pausada' : 'Pausado'}</p>
          <p className="text-fog-400">{stream.isLocal ? 'Sua transmissão continua no ar para os outros.' : 'Aperte play para voltar ao vivo.'}</p>
        </div>
      )}
      {!primary && (
        <div
          className="absolute right-1.5 bottom-1.5 flex gap-1 rounded-xl bg-ink-900/85 p-0.5 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          {!compact && stream.hasAudio && !stream.isLocal && <VolumeMenu session={session} stream={stream} volume={volume} />}
          <IconButton
            label={fullscreen ? 'Sair da tela cheia' : `Tela cheia: ${stream.name}`}
            className="size-8"
            onClick={() => toggleFullscreen(tileRef.current, videoRef.current)}
          >
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </IconButton>
          <IconButton label={`Parar de assistir ${stream.name}`} className="size-8" onClick={() => session.unwatch(stream.id)} data-testid="stage-tile-stop">
            <X className="size-4" />
          </IconButton>
        </div>
      )}
    </div>
  );
}

/** Lista de todas as transmissões do canal, com "Assistir" e "Parar de assistir" em cada uma. */
function StreamPicker({ session, streams }: { session: RoomSession; streams: StreamView[] }) {
  const watch = useStore(session.store, (state) => state.rights.watch);
  return (
    <Menu
      side="top"
      align="end"
      trigger={({ toggle }) => (
        <IconButton label="Transmissões disponíveis" onClick={toggle} data-testid="stream-picker">
          <Tv className="size-5" />
        </IconButton>
      )}
    >
      <div className="w-80 max-w-[85vw] p-1" data-testid="stream-list">
        <p className="px-2 pt-1 pb-2 text-xs font-bold tracking-wide text-fog-500 uppercase">Transmissões no canal</p>
        {streams.length === 0 && <p className="px-2 pb-2 text-sm text-fog-400">Ninguém está transmitindo agora.</p>}
        {streams.map((stream) => (
          <div key={stream.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-750" data-testid="stream-row" data-stream={stream.id}>
            <Monitor className={cx('size-4 shrink-0', stream.watching ? 'text-brand-300' : 'text-fog-500')} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{stream.isLocal ? 'Sua tela' : stream.name}</p>
              <p className="truncate text-xs text-fog-500">
                {stream.source ?? 'Tela compartilhada'}
                {stream.hasAudio ? ' • com som' : ''}
              </p>
            </div>
            {stream.watching ? (
              <Button size="sm" variant="quiet" onClick={() => session.unwatch(stream.id)} data-testid="stream-unwatch">
                <EyeOff className="size-4" aria-hidden="true" />
                Parar de assistir
              </Button>
            ) : (
              <Button size="sm" variant="primary" disabled={!watch && !stream.isLocal} onClick={() => session.select(stream.id)} data-testid="stream-watch">
                <Eye className="size-4" aria-hidden="true" />
                Assistir
              </Button>
            )}
          </div>
        ))}
        {!watch && <p className="px-2 pt-1 pb-1 text-xs text-warn-400">Você não tem permissão para assistir transmissões neste canal.</p>}
      </div>
    </Menu>
  );
}

const STATS_KEY = 'cosmic:estatisticas-abertas';
const readStatsOpen = () => {
  try {
    return localStorage.getItem(STATS_KEY) === '1';
  } catch {
    return false;
  }
};

export function Stage({
  session,
  cinema,
  onToggleCinema,
  allowCinema,
  lookup,
  ref,
}: {
  session: RoomSession;
  cinema: boolean;
  onToggleCinema: () => void;
  canShare?: boolean;
  /** O modo foco (cinema) só existe no layout de computador. */
  allowCinema: boolean;
  /** Fotos de perfil de quem está na chamada (nos grupos). */
  lookup?: PersonLookup;
  ref?: Ref<StageHandle>;
}) {
  const streams = useStore(session.store, (state) => state.streams);
  const selected = useStore(session.store, (state) => state.selected);
  const layout = useStore(session.store, (state) => state.layout);
  const publisher = useStore(session.store, (state) => state.publisher);
  const viewer = useStore(session.store, (state) => state.viewer);
  const volumes = useStore(session.store, (state) => state.volumes);
  const audioBlocked = useStore(session.store, (state) => state.audioBlocked);
  const watchingIds = useStore(session.store, (state) => state.watching);

  const visible = watchingIds.map((id) => streams.find((item) => item.id === id)).filter((item): item is StreamView => item !== undefined);
  const stream = visible.find((item) => item.id === selected) ?? visible[0] ?? null;
  const others = visible.filter((item) => item !== stream);
  const mosaic = layout === 'mosaico' && visible.length > 1;

  const containerRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  // "pessoas": os cartões dos participantes, mesmo com transmissões abertas (elas continuam assinadas).
  const [view, setView] = useState<'palco' | 'pessoas'>('palco');
  const [statsOpen, setStatsOpen] = useState(readStatsOpen);
  const immersive = fullscreen || cinema;
  const showGrid = stream === null || view === 'pessoas';
  const playing = !showGrid;

  useEffect(() => {
    setPaused(false);
    setView('palco');
  }, [stream?.id]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Com vídeo na tela, os controles ficam por cima da imagem e somem depois de alguns segundos com o mouse
  // parado (ou logo depois que ele sai do palco). O teclado traz de volta (focus-within).
  useEffect(() => {
    const element = containerRef.current;
    if (!playing || !element) {
      setIdle(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2800);
    };
    const leave = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 700);
    };
    wake();
    element.addEventListener('pointermove', wake);
    element.addEventListener('pointerdown', wake);
    element.addEventListener('pointerleave', leave);
    return () => {
      clearTimeout(timer);
      element.removeEventListener('pointermove', wake);
      element.removeEventListener('pointerdown', wake);
      element.removeEventListener('pointerleave', leave);
    };
  }, [playing]);

  const primaryVideo = () => containerRef.current?.querySelector<FrameVideo>('[data-testid="stage-video"]') ?? null;
  const toggleStageFullscreen = () => toggleFullscreen(containerRef.current, primaryVideo());
  useImperativeHandle(ref, () => ({ toggleFullscreen: toggleStageFullscreen }));

  const togglePip = () => {
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void primaryVideo()?.requestPictureInPicture?.().catch(() => undefined);
  };
  const toggleStats = () =>
    setStatsOpen((open) => {
      try {
        localStorage.setItem(STATS_KEY, open ? '0' : '1');
      } catch {
        // sem armazenamento: vale só nesta sessão
      }
      return !open;
    });

  const real = stream?.isLocal
    ? { height: publisher?.stats.height ?? null, fps: publisher?.stats.fps ?? null }
    : { height: viewer?.stats.height ?? null, fps: viewer?.stats.fps ?? null };
  const health = stream?.isLocal
    ? publisher?.stats.limitation && publisher.stats.limitation !== 'none'
      ? 2
      : 4
    : (viewer?.stats.lossPct ?? 0) > 8
      ? 1
      : (viewer?.stats.lossPct ?? 0) > 3
        ? 2
        : (viewer?.stats.lossPct ?? 0) > 1
          ? 3
          : 4;

  const volume = stream ? (volumes[stream.id] ?? 1) : 1;
  const showVideo = stream !== null && stream.track !== null && !paused;
  const hidden = playing && idle;
  const tile = (item: StreamView, primary: boolean, compact: boolean) => (
    <StreamTile
      key={item.id}
      session={session}
      stream={item}
      primary={primary}
      compact={compact}
      paused={primary && paused}
      real={primary ? real : null}
      health={health}
      volume={volumes[item.id] ?? 1}
      immersiveHidden={hidden}
      onFocus={() => session.select(item.id)}
    />
  );

  return (
    <div
      ref={containerRef}
      data-testid="stage"
      data-layout={mosaic ? 'mosaico' : 'foco'}
      data-view={showGrid ? 'pessoas' : 'palco'}
      className={cx(
        'sr-stage relative flex min-h-0 flex-1 flex-col overflow-hidden',
        playing ? 'bg-black' : fullscreen ? 'bg-ink-950' : 'bg-transparent',
        playing && !immersive && 'rounded-xl',
        hidden && 'cursor-none',
      )}
    >
      {showGrid ? (
        <>
          <CallGrid session={session} lookup={lookup} />
          {!stream && <video data-testid="stage-video" className="invisible absolute inset-0 size-0" muted playsInline />}
          {stream && (
            <button
              type="button"
              onClick={() => setView('palco')}
              className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-ink-800/90 px-3 py-1.5 text-sm font-bold shadow-panel backdrop-blur transition-colors hover:bg-ink-700"
              data-testid="stage-back"
            >
              <Monitor className="size-4 text-neon-300" aria-hidden="true" />
              Voltar para {stream.isLocal ? 'a sua tela' : `a tela de ${stream.name}`}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {mosaic ? (
              <div
                className="grid min-h-0 flex-1 gap-1"
                style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(visible.length))}, minmax(0, 1fr))` }}
                data-testid="stage-mosaic"
              >
                {visible.map((item) => tile(item, item === stream, false))}
              </div>
            ) : (
              <div className="relative min-h-0 flex-1">{stream && tile(stream, true, false)}</div>
            )}

            {stream && (
              <div className={cx('absolute right-2 bottom-16 z-20 w-80 max-w-[calc(100%-1rem)]', !statsOpen && 'hidden')} data-testid="stage-stats-panel">
                <StatsCard session={session} className="bg-ink-900/92 shadow-panel backdrop-blur" />
              </div>
            )}

            <div
              className={cx(
                'absolute inset-x-0 bottom-0 z-10 flex items-end bg-linear-to-t from-black/80 via-black/40 to-transparent px-2 pt-10 pb-1.5 transition-opacity duration-200 focus-within:opacity-100',
                hidden ? 'opacity-0' : 'opacity-100',
              )}
              data-testid="stage-controls"
            >
              <div className="flex w-full min-w-0 items-center gap-1">
                <IconButton label={paused ? 'Voltar ao vivo' : stream?.isLocal ? 'Pausar a prévia' : 'Pausar'} disabled={!stream} onClick={() => setPaused((value) => !value)}>
                  {paused ? <Play className="size-5" /> : <Pause className="size-5" />}
                </IconButton>

                {stream && !stream.isLocal && stream.hasAudio ? (
                  <VolumeMenu session={session} stream={stream} volume={volume} />
                ) : (
                  <IconButton label={stream?.isLocal ? 'Você não ouve a própria transmissão' : 'Esta transmissão não tem áudio'} disabled>
                    <VolumeX className="size-5" />
                  </IconButton>
                )}

                {stream && (
                  <span className="ml-1 flex shrink-0 items-center gap-1.5 rounded-md bg-live-500 px-2 py-0.5 text-xs font-extrabold tracking-wide text-white uppercase">
                    <span className="size-1.5 animate-pulse-dot rounded-full bg-white" />
                    Ao vivo
                  </span>
                )}

                {streams.length > 1 && (
                  <div className="ml-2 flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Transmissões na sala">
                    {streams.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={item.id === stream?.id}
                        onClick={() => session.select(item.id)}
                        title={item.source ?? undefined}
                        className={cx(
                          'flex max-w-36 shrink-0 items-center gap-1 truncate rounded-lg px-2.5 py-1 text-sm font-semibold transition-colors',
                          item.id === stream?.id ? 'bg-white/18 text-white' : item.watching ? 'text-fog-100 hover:bg-white/10' : 'text-fog-400 hover:bg-white/10 hover:text-fog-100',
                        )}
                      >
                        {!item.watching && <EyeOff className="size-3.5 shrink-0" aria-label="não assistindo" />}
                        <span className="truncate">{item.isLocal ? 'Minha tela' : item.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                <span className="flex-1" />

                <IconButton label="Ver participantes" onClick={() => setView('pessoas')} data-testid="stage-people">
                  <Users className="size-5" />
                </IconButton>
                {visible.length > 1 && (
                  <IconButton
                    label={mosaic ? 'Modo foco (uma grande)' : 'Modo mosaico (todas do mesmo tamanho)'}
                    onClick={() => session.setLayout(mosaic ? 'foco' : 'mosaico')}
                    data-testid="stage-layout"
                  >
                    {mosaic ? <Rows2 className="size-5" /> : <LayoutGrid className="size-5" />}
                  </IconButton>
                )}
                {streams.length > 0 && <StreamPicker session={session} streams={streams} />}
                <IconButton
                  label={statsOpen ? 'Esconder as estatísticas' : 'Estatísticas da transmissão'}
                  onClick={toggleStats}
                  className={cx(statsOpen && 'bg-white/15 text-white')}
                  aria-pressed={statsOpen}
                  data-testid="stage-stats"
                >
                  <ChartColumn className="size-5" />
                </IconButton>
                {allowCinema && (
                  <IconButton
                    label={cinema ? 'Sair do modo foco' : 'Modo foco (só a transmissão)'}
                    onClick={onToggleCinema}
                    className={cx(cinema && 'bg-white/15 text-white')}
                    data-testid="stage-cinema"
                  >
                    <RectangleHorizontal className="size-5" />
                  </IconButton>
                )}
                {document.pictureInPictureEnabled && (
                  <IconButton label="Janela flutuante" disabled={!showVideo} onClick={togglePip}>
                    <PictureInPicture2 className="size-5" />
                  </IconButton>
                )}
                <IconButton label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleStageFullscreen} data-testid="stage-fullscreen">
                  {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
                </IconButton>
              </div>
            </div>
          </div>

          {!mosaic && others.length > 0 && (
            <div className={cx('flex h-24 shrink-0 gap-1.5 overflow-x-auto bg-black p-1.5 transition-opacity', hidden && 'opacity-0')} data-testid="stage-strip">
              {others.map((item) => tile(item, false, true))}
            </div>
          )}
        </>
      )}

      {audioBlocked && (
        <button
          type="button"
          onClick={() => void session.unlockAudio()}
          className="absolute bottom-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-ink-900/90 px-4 py-2 text-sm font-bold text-warn-400 shadow-panel backdrop-blur"
        >
          <VolumeX className="size-4" aria-hidden="true" />
          O navegador bloqueou o som. Toque para ativar.
        </button>
      )}
    </div>
  );
}
