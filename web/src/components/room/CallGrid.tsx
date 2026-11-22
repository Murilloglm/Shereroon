import { AudioLines, Eye, MicOff, Monitor } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { hueFor } from '../../lib/format.ts';
import { bestGrid } from '../../lib/grid.ts';
import type { ParticipantView, RoomSession, StreamView } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { CosmeticName, DecoratedAvatar } from '../cosmetics/Decoration.tsx';
import { cx } from '../ui.tsx';

/** Foto e nome de quem está na chamada (nos grupos vêm do perfil; nas salas por link, não existem). */
export type PersonLookup = (identity: string) => { image?: string | null } | undefined;

const GAP = 10;

function CallCard({
  session,
  person,
  stream,
  canWatch,
  width,
  height,
  image,
}: {
  session: RoomSession;
  person: ParticipantView;
  stream: StreamView | undefined;
  canWatch: boolean;
  width: number;
  height: number;
  image: string | null | undefined;
}) {
  const hue = hueFor(person.identity);
  const compact = height < 120;
  const speaking = person.micOn && person.speaking;
  const portraitHeight = height - 2 * (compact ? 20 : 32);
  const avatar = Math.max(1, Math.floor(Math.min(128, width * 0.62, height * 0.42, portraitHeight / 1.6)));
  return (
    <div
      className="group relative grid shrink-0 place-items-center overflow-hidden rounded-2xl shadow-[0_0_0_1px_rgb(255_255_255/0.06)]"
      style={{ width, height, background: `radial-gradient(120% 120% at 50% 35%, hsl(${hue} var(--call-card-s) var(--call-card-l)), var(--color-ink-900) 72%)` }}
      data-testid="call-card"
      data-identity={person.identity}
      data-speaking={speaking ? 'true' : 'false'}
    >
      <div className="flex min-h-0 items-center justify-center" data-testid="call-portrait">
        <DecoratedAvatar preview={person.guestLook} userId={person.accountId ?? person.identity} name={person.name} size={avatar} speaking={speaking} voiceCaption image={image ?? person.avatar} animate entrance />
      </div>

      <div className={cx('absolute bottom-0 left-0 mx-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 justify-self-start rounded-lg font-semibold text-fog-100', compact ? 'mb-1 text-xs' : 'mb-2 bg-ink-950/55 px-2 py-1 text-sm')}>
        {person.micOn && <span role="img" aria-label={speaking ? `${person.name} está falando` : undefined}
          aria-hidden={!speaking} className={cx('inline-flex shrink-0', !speaking && 'invisible')} data-voice-indicator={speaking}>
          <AudioLines aria-hidden="true" className="size-3.5" />
        </span>}
        {!person.micOn && <MicOff className="size-3.5 shrink-0 text-live-300" aria-label="Microfone desligado" data-testid="call-card-mic-off" />}
        <span className="truncate" data-testid="call-card-name">
          <CosmeticName preview={person.guestLook} userId={person.accountId} animate={!compact}>{person.name}</CosmeticName>{person.isLocal && ' (você)'}
        </span>
      </div>

      {person.sharing && (
        <span className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-live-500 px-1.5 py-0.5 text-[11px] font-extrabold tracking-wide text-on-accent uppercase" data-testid="call-card-live">
          <Monitor className="size-3" aria-hidden="true" />
          Ao vivo
        </span>
      )}
      {person.sharing && stream && !stream.watching && (canWatch || stream.isLocal) && (
        <button
          type="button"
          onClick={() => session.select(stream.id)}
          className="absolute inset-x-0 bottom-0 flex h-full items-center justify-center bg-black/0 text-sm font-bold text-white opacity-0 transition-[opacity,background-color] duration-150 group-hover:bg-black/45 group-hover:opacity-100 focus-visible:bg-black/45 focus-visible:opacity-100"
          data-testid="call-card-watch"
        >
          <span className="flex items-center gap-2 rounded-xl bg-white/12 px-3 py-1.5 backdrop-blur">
            <Eye className="size-4" aria-hidden="true" />
            {stream.isLocal ? 'Ver minha tela' : `Assistir ${person.name}`}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Quem está na chamada, em cartões que se ajeitam sozinhos no espaço: avatar, nome, microfone, quem fala e quem
 * está transmitindo (com "Assistir"). É o que o palco mostra quando ninguém está sendo assistido.
 */
export function CallGrid({ session, lookup, className }: { session: RoomSession; lookup?: PersonLookup; className?: string }) {
  const participants = useStore(session.store, (state) => state.participants);
  const streams = useStore(session.store, (state) => state.streams);
  const canWatch = useStore(session.store, (state) => state.rights.watch);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const padding = 16;
  const grid = bestGrid(participants.length, Math.max(0, size.width - padding * 2), Math.max(0, size.height - padding * 2), GAP);
  return (
    <div ref={ref} className={cx('relative flex min-h-0 flex-1 items-center justify-center overflow-hidden', className)} data-testid="call-grid" data-count={participants.length}>
      {grid.width > 0 && (
        <div className="flex flex-wrap content-center items-center justify-center" style={{ gap: GAP, width: grid.columns * grid.width + (grid.columns - 1) * GAP }}>
          {participants.map((person) => (
            <CallCard
              key={person.identity}
              session={session}
              person={person}
              stream={streams.find((item) => item.id === person.identity)}
              canWatch={canWatch}
              width={Math.floor(grid.width)}
              height={Math.floor(grid.height)}
              image={person.avatar ?? lookup?.(person.identity)?.image}
            />
          ))}
        </div>
      )}
    </div>
  );
}
