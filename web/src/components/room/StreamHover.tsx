import { Monitor } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatFps, formatHeight } from '../../lib/format.ts';
import type { RoomSession } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { useAttachedTrack, useMeasuredVideo, type FrameVideo } from './video.ts';

/** Quanto o mouse precisa ficar parado em cima para abrir: passar por cima a caminho de outro lugar não conecta nada. */
const OPEN_DELAY_MS = 350;
/** Tempo para levar o mouse da linha até o cartão sem ele fechar. */
const CLOSE_DELAY_MS = 150;

/**
 * Prévia em miniatura da transmissão de alguém, ao passar o mouse sobre a pessoa. Usa a mesma conexão da
 * sala: se a transmissão já está sendo assistida, reaproveita a faixa; senão assina só o vídeo, sem som,
 * enquanto a prévia estiver aberta (e solta pouco depois de fechar). Clicar abre a transmissão completa.
 */
export function StreamHover({
  session,
  identity,
  name,
  enabled,
  children,
  className,
}: {
  session: RoomSession;
  identity: string;
  name: string;
  /** Só quem está transmitindo tem prévia. */
  enabled: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const timers = useRef<{ open?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout> }>({});

  const enter = () => {
    clearTimeout(timers.current.close);
    if (anchor || !enabled) return;
    clearTimeout(timers.current.open);
    timers.current.open = setTimeout(() => {
      if (hostRef.current) setAnchor(hostRef.current.getBoundingClientRect());
    }, OPEN_DELAY_MS);
  };
  const leave = () => {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.close);
    timers.current.close = setTimeout(() => setAnchor(null), CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (!enabled) setAnchor(null);
  }, [enabled]);
  useEffect(() => {
    const current = timers.current;
    return () => {
      clearTimeout(current.open);
      clearTimeout(current.close);
    };
  }, []);

  return (
    <div ref={hostRef} className={className} onPointerEnter={enter} onPointerLeave={leave} data-preview={enabled ? 'true' : undefined}>
      {children}
      {anchor &&
        createPortal(
          <PreviewCard
            session={session}
            identity={identity}
            name={name}
            anchor={anchor}
            onEnter={() => clearTimeout(timers.current.close)}
            onLeave={leave}
            onOpen={() => {
              session.select(identity);
              setAnchor(null);
            }}
          />,
          document.body,
        )}
    </div>
  );
}

function PreviewCard({
  session,
  identity,
  name,
  anchor,
  onEnter,
  onLeave,
  onOpen,
}: {
  session: RoomSession;
  identity: string;
  name: string;
  anchor: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
}) {
  const stream = useStore(session.store, (state) => state.streams.find((item) => item.id === identity) ?? null);
  const canWatch = useStore(session.store, (state) => state.rights.watch);
  const allowed = stream?.isLocal || canWatch;
  const videoRef = useRef<FrameVideo>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: anchor.right + 8, top: anchor.top });

  // Abre a prévia (assina o vídeo se ainda não estiver assinado) só enquanto o cartão existe.
  useEffect(() => {
    if (!allowed || stream?.isLocal) return;
    return session.openPreview(identity);
  }, [session, identity, allowed, stream?.isLocal]);

  const track = allowed ? (stream?.track ?? null) : null;
  useAttachedTrack(videoRef, track);
  const measured = useMeasuredVideo(videoRef, track !== null);
  const origin = stream?.isLocal ? null : session.uplinkFor(identity);

  // Cabe na tela: à direita da pessoa se der, senão à esquerda; nunca sai por baixo.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    const left = anchor.right + 8 + width > window.innerWidth - 8 ? Math.max(8, anchor.left - 8 - width) : anchor.right + 8;
    const top = Math.min(Math.max(8, anchor.top - 8), window.innerHeight - height - 8);
    setPosition({ left, top });
  }, [anchor]);

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`Prévia da transmissão de ${name}`}
      className="fixed z-50 w-80 animate-fade overflow-hidden rounded-2xl border border-brand-400/60 bg-ink-900 shadow-glow"
      style={position}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      data-testid="stream-preview"
      data-stream={identity}
    >
      <button
        type="button"
        className="relative block aspect-video w-full bg-black text-left"
        onClick={onOpen}
        disabled={!allowed}
        aria-label={`Assistir a transmissão de ${name}`}
        data-testid="stream-preview-open"
      >
        {/* Sempre mudo: a prévia nunca toca o som da transmissão. */}
        <video ref={videoRef} className="absolute inset-0 size-full object-contain" autoPlay playsInline muted data-testid="stream-preview-video" />
        {!allowed && <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-fog-400">Você não tem permissão para assistir transmissões aqui.</span>}
        {allowed && !track && <span className="absolute inset-0 flex items-center justify-center text-sm text-fog-400">Carregando a prévia…</span>}
      </button>
      <div className="flex items-center gap-2 px-3 py-2">
        <Monitor className="size-4 shrink-0 text-brand-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{stream?.isLocal ? 'Sua tela' : name}</p>
          {stream?.source && <p className="truncate text-xs text-fog-500">{stream.source}</p>}
          {origin?.height != null && (
            <p className="truncate text-xs text-fog-400" data-testid="stream-preview-origin">
              Na origem: {formatHeight(origin.height)} • {formatFps(origin.fps)}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-md bg-ink-750 px-1.5 py-0.5 text-xs font-bold text-fog-200" data-testid="stream-preview-real" title="Medido no vídeo da prévia (pode vir numa camada mais leve que a original)">
          {measured.height !== null ? `${formatHeight(measured.height)} • ${formatFps(measured.fps)}` : '—'}
        </span>
      </div>
    </div>
  );
}
