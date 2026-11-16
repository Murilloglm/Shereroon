import { ArrowLeft, ChevronDown, LogOut, Radio, Users } from 'lucide-react';
import type { LinkQuality, Phase, RoomSession } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar, cx, Logo, Menu, MenuItem, SignalBars } from '../ui.tsx';

function linkStatus(phase: Phase, link: LinkQuality): { label: string; bars: number; tone: 'ok' | 'aviso' | 'ruim' } {
  if (phase === 'reconnecting') return { label: 'Reconectando…', bars: 0, tone: 'aviso' };
  switch (link) {
    case 'otima':
      return { label: 'Conexão estável', bars: 4, tone: 'ok' };
    case 'boa':
      return { label: 'Conexão estável', bars: 3, tone: 'ok' };
    case 'fraca':
      return { label: 'Conexão instável', bars: 2, tone: 'aviso' };
    case 'perdida':
      return { label: 'Sem conexão', bars: 0, tone: 'ruim' };
    default:
      return { label: 'Medindo a conexão…', bars: 1, tone: 'aviso' };
  }
}

export function Header({ session, onLeave, embedded = false }: { session: RoomSession; onLeave: () => void; embedded?: boolean }) {
  const roomName = useStore(session.store, (state) => state.roomName);
  const capacity = useStore(session.store, (state) => state.capacity);
  const phase = useStore(session.store, (state) => state.phase);
  const link = useStore(session.store, (state) => state.link);
  const streams = useStore(session.store, (state) => state.streams);
  const participants = useStore(session.store, (state) => state.participants);
  const identity = useStore(session.store, (state) => state.identity);
  const sharing = streams.some((stream) => stream.isLocal);

  const me = participants.find((person) => person.isLocal);
  const status = linkStatus(phase, link);
  const others = Math.max(0, participants.length - 1);
  const dot = status.tone === 'ok' ? 'bg-ok-400' : status.tone === 'aviso' ? 'bg-warn-400' : 'bg-live-400';

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-ink-700/80 px-4 py-3 lg:gap-6 lg:px-6 lg:py-4">
      {!embedded && (
        <>
          <button type="button" onClick={onLeave} aria-label="Sair da sala" className="rounded-lg p-1.5 text-fog-300 hover:bg-ink-750 lg:hidden">
            <ArrowLeft className="size-5" />
          </button>
          <span className="hidden lg:block">
            <Logo />
          </span>
          <span className="hidden h-9 w-px bg-ink-600 lg:block" aria-hidden="true" />
        </>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Users className="hidden size-7 shrink-0 text-brand-300 sm:block" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="truncate text-lg leading-tight font-extrabold lg:text-xl" data-testid="room-name">
            {roomName}
          </h1>
          <p className="truncate text-sm text-fog-400">{embedded ? 'Canal de voz' : `Sala Privada • Até ${capacity} participantes`}</p>
        </div>
      </div>

      <span
        className="hidden items-center gap-2 text-sm font-semibold md:flex"
        role="status"
        data-testid="connection"
        data-phase={phase}
      >
        <span className={cx('size-2 rounded-full', dot, phase === 'reconnecting' && 'animate-pulse-dot')} />
        {status.label}
        <SignalBars level={status.bars} className="ml-1" />
      </span>

      {streams.length > 0 && (
        <span className="flex items-center gap-1.5 rounded-xl border border-brand-400/70 bg-brand-500/15 px-3 py-1.5 text-sm font-bold text-brand-200" data-testid="live-pill">
          <Radio className="size-4" aria-hidden="true" />
          Ao vivo
        </span>
      )}

      <span className="hidden text-sm font-semibold whitespace-nowrap text-fog-300 sm:inline" data-testid="headcount">
        {sharing ? `${others} assistindo` : `${participants.length} na sala`}
      </span>

      <Menu
        side="bottom"
        align="end"
        trigger={({ toggle, open }) => (
          <button type="button" onClick={toggle} aria-expanded={open} aria-label="Sua conta nesta sala" className="flex items-center gap-1.5 rounded-full">
            <Avatar id={identity} name={me?.name ?? '?'} size={38} online />
            <ChevronDown className="hidden size-4 text-fog-400 lg:block" />
          </button>
        )}
      >
        <p className="truncate px-2.5 pt-1.5 pb-2 text-sm font-bold">{me?.name}</p>
        <MenuItem icon={<LogOut className="size-4" />} onClick={onLeave} data-testid="leave">
          {embedded ? 'Sair do canal de voz' : 'Sair da sala'}
        </MenuItem>
      </Menu>
    </header>
  );
}
