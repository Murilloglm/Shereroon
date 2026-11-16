import {
  LoaderCircle,
  Maximize,
  Minimize,
  Monitor,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { formatFps, formatHeight } from '../../lib/format.ts';
import type { RoomSession } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { Button, cx, IconButton, Menu, SignalBars, Slider } from '../ui.tsx';

export interface StageHandle {
  toggleFullscreen(): void;
}

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
  webkitEnterFullscreen?: () => void;
};

export function Stage({
  session,
  cinema,
  onToggleCinema,
  canShare,
  allowCinema,
  ref,
}: {
  session: RoomSession;
  cinema: boolean;
  onToggleCinema: () => void;
  canShare: boolean;
  /** O modo cinema só existe no layout de computador. */
  allowCinema: boolean;
  ref?: Ref<StageHandle>;
}) {
  const streams = useStore(session.store, (state) => state.streams);
  const selected = useStore(session.store, (state) => state.selected);
  const publisher = useStore(session.store, (state) => state.publisher);
  const viewer = useStore(session.store, (state) => state.viewer);
  const volumes = useStore(session.store, (state) => state.volumes);
  const audioBlocked = useStore(session.store, (state) => state.audioBlocked);
  const starting = useStore(session.store, (state) => state.share.starting);

  const stream = streams.find((item) => item.id === selected) ?? null;
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<FrameVideo>(null);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const immersive = fullscreen || cinema;

  useEffect(() => setPaused(false), [stream?.id]);

  // Liga a faixa de vídeo ao elemento. Pausar solta a faixa: o SFU para de enviar e nada é decodificado.
  const track = stream?.track ?? null;
  useEffect(() => {
    const element = videoRef.current;
    if (!element || !track || paused) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track, paused]);

  // Conta os quadros realmente pintados na tela (limitado pela taxa do monitor de quem assiste).
  const remoteId = stream && !stream.isLocal ? stream.id : null;
  useEffect(() => {
    const element = videoRef.current;
    if (!element || !remoteId || paused || !element.requestVideoFrameCallback) {
      session.reportPresentedFps(null);
      return;
    }
    let alive = true;
    let handle = 0;
    let frames = 0;
    let since = performance.now();
    const onFrame = (now: number) => {
      if (!alive) return;
      frames += 1;
      if (now - since >= 1000) {
        session.reportPresentedFps((frames * 1000) / (now - since));
        frames = 0;
        since = now;
      }
      handle = element.requestVideoFrameCallback!(onFrame);
    };
    handle = element.requestVideoFrameCallback(onFrame);
    return () => {
      alive = false;
      element.cancelVideoFrameCallback?.(handle);
      session.reportPresentedFps(null);
    };
  }, [remoteId, paused, session]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Em tela cheia ou modo cinema, os controles somem depois de alguns segundos parado.
  useEffect(() => {
    const element = containerRef.current;
    if (!immersive || !element) {
      setIdle(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2800);
    };
    wake();
    element.addEventListener('pointermove', wake);
    element.addEventListener('pointerdown', wake);
    return () => {
      clearTimeout(timer);
      element.removeEventListener('pointermove', wake);
      element.removeEventListener('pointerdown', wake);
    };
  }, [immersive]);

  const toggleFullscreen = () => {
    const element = containerRef.current;
    if (!element) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (element.requestFullscreen) {
      element.requestFullscreen().catch(() => videoRef.current?.webkitEnterFullscreen?.());
    } else {
      // iPhone: só o próprio <video> entra em tela cheia.
      videoRef.current?.webkitEnterFullscreen?.();
    }
  };
  useImperativeHandle(ref, () => ({ toggleFullscreen }));

  const togglePip = () => {
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void videoRef.current?.requestPictureInPicture?.().catch(() => undefined);
  };

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
  const showVideo = stream !== null && track !== null && !paused;

  return (
    <div
      ref={containerRef}
      data-testid="stage"
      className={cx(
        'sr-stage relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-ink-700 bg-black shadow-panel',
        immersive && idle && 'cursor-none',
      )}
    >
      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          data-testid="stage-video"
          className={cx('absolute inset-0 size-full object-contain', !showVideo && 'invisible')}
          autoPlay
          playsInline
          muted
        />

        {stream && (
          <div
            className={cx(
              'pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 transition-opacity duration-200',
              immersive && idle && 'opacity-0',
            )}
          >
            <span
              className="flex max-w-[70%] items-center gap-2 rounded-xl border border-brand-400/60 bg-ink-900/85 px-3 py-1.5 text-sm font-semibold backdrop-blur"
              data-testid="stage-owner"
            >
              <Monitor className="size-4 shrink-0 text-brand-300" aria-hidden="true" />
              <span className="truncate">{stream.isLocal ? 'Você está compartilhando a tela' : `Tela de ${stream.name}`}</span>
            </span>
            {real.height !== null && (
              <span
                className="flex items-center gap-2 rounded-lg bg-ink-900/85 px-2.5 py-1.5 text-sm font-bold backdrop-blur"
                title="Valores medidos na transmissão, não os pedidos"
                data-testid="stage-real"
              >
                <SignalBars level={health} />
                {formatHeight(real.height)} • {formatFps(real.fps)}
              </span>
            )}
          </div>
        )}

        {!stream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl border border-ink-600 bg-ink-850">
              <Monitor className="size-8 text-brand-300" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xl font-extrabold">Ninguém está compartilhando a tela</p>
              <p className="mt-1.5 text-fog-400">Quando alguém começar, a transmissão aparece aqui.</p>
            </div>
            {canShare && (
              <Button variant="primary" disabled={starting} onClick={() => void session.startShare()} data-testid="stage-share">
                {starting ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Monitor className="size-5" aria-hidden="true" />}
                Compartilhar minha tela
              </Button>
            )}
          </div>
        )}

        {stream && !track && (
          <div className="absolute inset-0 flex items-center justify-center gap-3 text-fog-300">
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            Conectando à transmissão…
          </div>
        )}

        {stream && track && paused && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-lg font-extrabold">{stream.isLocal ? 'Prévia pausada' : 'Pausado'}</p>
            <p className="text-fog-400">
              {stream.isLocal ? 'Sua transmissão continua no ar para os outros.' : 'Aperte play para voltar ao vivo.'}
            </p>
          </div>
        )}

        {audioBlocked && (
          <button
            type="button"
            onClick={() => void session.unlockAudio()}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-warn-400/60 bg-ink-900/90 px-4 py-2 text-sm font-bold text-warn-400 backdrop-blur"
          >
            <VolumeX className="size-4" aria-hidden="true" />
            O navegador bloqueou o som. Toque para ativar.
          </button>
        )}
      </div>

      <div
        className={cx(
          'flex h-12 shrink-0 items-center gap-1 border-t border-ink-700 bg-ink-900 px-2 transition-[height,opacity] duration-200',
          immersive && idle && 'h-0 overflow-hidden border-t-0 opacity-0',
        )}
      >
        <IconButton
          label={paused ? 'Voltar ao vivo' : stream?.isLocal ? 'Pausar a prévia' : 'Pausar'}
          disabled={!stream}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <Play className="size-5" /> : <Pause className="size-5" />}
        </IconButton>

        {stream && !stream.isLocal && stream.hasAudio ? (
          <Menu
            side="top"
            trigger={({ toggle }) => (
              <IconButton label="Volume desta transmissão" onClick={toggle}>
                {volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </IconButton>
            )}
          >
            <div className="flex items-center gap-3 px-2 py-1.5">
              <Slider
                label="Volume desta transmissão"
                value={Math.round(volume * 100)}
                onChange={(value) => session.setVolume(stream.id, value / 100)}
              />
              <span className="w-10 text-right text-sm font-bold">{Math.round(volume * 100)}%</span>
            </div>
          </Menu>
        ) : (
          <IconButton label={stream?.isLocal ? 'Você não ouve a própria transmissão' : 'Esta transmissão não tem áudio'} disabled>
            <VolumeX className="size-5" />
          </IconButton>
        )}

        {stream && (
          <span className="ml-1 flex items-center gap-1.5 rounded-lg border border-brand-400/50 bg-brand-500/15 px-2.5 py-1 text-sm font-bold text-brand-200">
            <span className="size-2 animate-pulse-dot rounded-full bg-brand-300" />
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
                aria-selected={item.id === selected}
                onClick={() => session.select(item.id)}
                className={cx(
                  'max-w-36 shrink-0 truncate rounded-lg border px-2.5 py-1 text-sm font-semibold transition-colors',
                  item.id === selected
                    ? 'border-brand-400 bg-brand-500/25 text-white'
                    : 'border-ink-600 text-fog-300 hover:border-ink-500 hover:text-fog-100',
                )}
              >
                {item.isLocal ? 'Minha tela' : item.name}
              </button>
            ))}
          </div>
        )}

        <span className="flex-1" />

        {allowCinema && (
          <IconButton
            label={cinema ? 'Sair do modo cinema' : 'Modo cinema'}
            onClick={onToggleCinema}
            className={cx(cinema && 'bg-brand-500/25 text-white')}
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
        <IconButton label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFullscreen} data-testid="stage-fullscreen">
          {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
        </IconButton>
      </div>
    </div>
  );
}
