import { Crown, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { canCaptureScreen, captureUnavailableReason } from '../../lib/capture.ts';
import { desktop as app } from '../../lib/desktop.ts';
import { AppMixer, SYSTEM_KEY } from '../../lib/helper/mixer.ts';
import { NoiseControl } from '../../lib/noise-control.ts';
import type { RoomSession } from '../../lib/session.ts';
import { openSettings as openSettingsScreen, registerCall } from '../../lib/settings-screen.ts';
import { useStore } from '../../lib/store.ts';
import { CosmeticName, DecoratedAvatar } from '../cosmetics/Decoration.tsx';
import { Card, cx, Notice, Toast } from '../ui.tsx';
import { Dock, MobileActions } from './Dock.tsx';
import { Header } from './Header.tsx';
import { MixerPanel } from './MixerPanel.tsx';
import { QualityCard } from './QualityCard.tsx';
import { ParticipantsCard, RoomCard } from './Sidebar.tsx';
import { SourcePicker } from './SourcePicker.tsx';
import type { PersonLookup } from './CallGrid.tsx';
import { Stage, type StageHandle } from './Stage.tsx';

const DESKTOP = '(min-width: 1024px)';

/** Um layout só é montado por vez (computador ou celular), em vez de dois com um escondido. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(DESKTOP);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(DESKTOP).matches,
  );
}

/** Faixa horizontal de participantes do layout de celular. */
function MobilePeople({ session }: { session: RoomSession }) {
  const participants = useStore(session.store, (state) => state.participants);
  return (
    <Card className="px-3 py-3" data-testid="participants">
      <h2 className="px-1 text-[15px] font-extrabold">
        Participantes <span className="text-brand-300">({participants.length})</span>
      </h2>
      <ul className="mt-2.5 flex gap-4 overflow-x-auto pb-1">
        {participants.map((person) => (
          <li key={person.identity} className="flex shrink-0 items-center gap-2" data-testid="participant">
            <DecoratedAvatar preview={person.guestLook} userId={person.accountId ?? person.identity} name={person.name} image={person.avatar} size={36} online speaking={person.speaking} />
            <span className="max-w-24 truncate text-sm font-semibold" data-testid="participant-name">
              <CosmeticName preview={person.guestLook} userId={person.accountId}>{person.isLocal ? 'Você' : person.name}</CosmeticName>
            </span>
            {person.isHost && <Crown className="size-4 text-brand-300" aria-label="Dono da sala" />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RoomView({
  session,
  invite,
  onLeave,
  embedded = false,
  headerActions,
  lookup,
}: {
  session: RoomSession;
  /** Vazio nos canais de voz de grupos, que não têm link de convite próprio. */
  invite: string;
  onLeave: () => void;
  /** Dentro da tela de um grupo: ocupa o espaço que recebe, sem logo, sem cartão da sala e sem lista de participantes. */
  embedded?: boolean;
  headerActions?: ReactNode;
  /** Fotos de perfil de quem está na chamada (nos grupos). */
  lookup?: PersonLookup;
}) {
  const phase = useStore(session.store, (state) => state.phase);
  const sharing = useStore(session.store, (state) => state.share.active);
  const notice = useStore(session.store, (state) => state.notice);
  const desktop = useIsDesktop();
  const [cinemaWanted, setCinema] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [slowConnection, setSlowConnection] = useState(false);
  useEffect(() => {
    setSlowConnection(false);
    if (phase !== 'connecting') return;
    const timer = setTimeout(() => setSlowConnection(true), 8000);
    return () => clearTimeout(timer);
  }, [phase]);
  const stage = useRef<StageHandle>(null);
  const mixerRef = useRef<AppMixer | null>(null);
  mixerRef.current ??= new AppMixer(session);
  const mixer = mixerRef.current;
  const noiseRef = useRef<NoiseControl | null>(null);
  noiseRef.current ??= new NoiseControl(session, mixer);
  const noise = noiseRef.current;
  // A seção de voz e vídeo das Configurações mostra esta chamada enquanto ela existir.
  useEffect(() => {
    registerCall({ session, noise });
    return () => registerCall(null);
  }, [session, noise]);

  // Saiu da sala: os filtros de ruído param e o app auxiliar é solto, e com isso toda captura de aplicativo para.
  useEffect(
    () => () => {
      noise.dispose();
      mixer.shutdown();
    },
    [mixer, noise],
  );

  // Aplicativo de Windows: a bandeja mostra o que está acontecendo na sala e manda comandos de volta.
  useEffect(() => {
    const bridge = app;
    if (!bridge) return;
    let sent = '';
    const push = () => {
      const state = session.store.get();
      const next = {
        inRoom: state.phase === 'connected' || state.phase === 'reconnecting',
        sharing: state.share.active,
        micOn: state.micOn,
        roomName: state.roomName || null,
      };
      const signature = JSON.stringify(next);
      if (signature === sent) return;
      sent = signature;
      bridge.setState(next);
    };
    push();
    const stopWatching = session.store.subscribe(push);
    const stopListening = bridge.onCommand((command) => {
      if (command === 'toggle-mic') void session.setMic(!session.store.get().micOn);
      else if (command === 'stop-share') void session.stopShare();
      else if (command === 'leave') onLeave();
    });
    return () => {
      stopWatching();
      stopListening();
      bridge.setState({ inRoom: false, sharing: false, micOn: false, roomName: null });
    };
  }, [session, onLeave]);

  const systemOn = useStore(mixer.store, (state) => state.desired[SYSTEM_KEY]?.enabled === true);
  const audioSource = useStore(session.store, (state) => state.audioSource);
  const systemAudio = app ? { on: systemOn && audioSource === 'apps', enable: () => void mixer.enableSystem() } : undefined;

  const cinema = cinemaWanted && desktop;
  const canShare = canCaptureScreen();
  const shareBlockedReason = captureUnavailableReason();
  const clearNotice = useCallback(() => session.clearNotice(), [session]);
  const fullscreen = () => stage.current?.toggleFullscreen();
  // A engrenagem abre a tela de Configurações em Voz e vídeo, com esta chamada.
  const openSettings = () => openSettingsScreen('voz');

  const player = (
    <Stage ref={stage} session={session} cinema={cinema} onToggleCinema={() => setCinema((value) => !value)} canShare={canShare} allowCinema={desktop} lookup={lookup} />
  );
  // Qualidade (resolução e FPS) num painel aberto pelo botão da barra: dá para ajustar antes de transmitir, e não
  // ocupa espaço quando ninguém está transmitindo.
  const qualityPanel = canShare ? <QualityCard session={session} className="border-0 bg-transparent shadow-none" /> : undefined;

  return (
    <div className={cx('flex flex-col', embedded ? 'h-full min-h-0 overflow-y-auto lg:overflow-hidden' : desktop ? 'h-(--app-h) overflow-hidden' : 'min-h-(--app-h)')} data-testid="room">
      {!cinema && <Header session={session} onLeave={onLeave} embedded={embedded} actions={headerActions} />}

      {phase === 'connecting' && <div className="flex shrink-0 items-center justify-center gap-2 bg-brand-500/10 px-4 py-2 text-sm text-brand-200" role="status" data-testid="voice-connecting"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{slowConnection ? 'Ainda conectando. Se o servidor estava em repouso, a primeira resposta pode demorar cerca de um minuto.' : 'Conectando à chamada…'}</div>}

      {phase === 'reconnecting' && (
        <div className="flex items-center justify-center gap-2.5 bg-warn-400/15 px-4 py-2 text-sm font-bold text-warn-400" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          A conexão caiu. Tentando voltar sozinho — sua captura de tela continua ativa.
        </div>
      )}

      {desktop ? (
        <>
          <main
            className={cx(
              'grid min-h-0 flex-1 gap-3',
              cinema ? 'p-0' : 'p-3',
              cinema
                ? 'grid-cols-1'
                : embedded
                  ? mixerOpen
                    ? 'grid-cols-[minmax(0,1fr)_minmax(28rem,1.1fr)]'
                    : 'grid-cols-1'
                  : mixerOpen
                    ? 'grid-cols-[19rem_minmax(0,1fr)_minmax(30rem,1.3fr)]'
                    : 'grid-cols-[19rem_minmax(0,1fr)]',
            )}
          >
            {!cinema && !embedded && (
              <aside className="flex min-h-0 flex-col gap-3">
                <RoomCard session={session} invite={invite} />
                <ParticipantsCard session={session} invite={invite} className="flex-1" />
              </aside>
            )}
            <section className="flex min-h-0 flex-col">{player}</section>
            {!cinema && mixerOpen && (
              <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                <MixerPanel session={session} mixer={mixer} noise={noise} onClose={() => setMixerOpen(false)} />
              </aside>
            )}
          </main>
          <div className={cx('shrink-0 px-3 pb-3', cinema && 'pt-2')}>
            <Dock
              session={session}
              invite={invite}
              canShare={canShare}
              shareBlockedReason={shareBlockedReason}
              mixerOpen={mixerOpen}
              onOpenMixer={() => {
                setCinema(false);
                setMixerOpen(true);
                mixer.open();
              }}
              onOpenSettings={openSettings}
              onFullscreen={fullscreen}
              onLeave={onLeave}
              systemAudio={systemAudio}
              qualityPanel={qualityPanel}
            />
          </div>
        </>
      ) : (
        <main className="flex flex-col gap-4 p-4">
          <section className="flex h-[60vw] max-h-[70dvh] min-h-56 shrink-0 flex-col">{player}</section>
          {!embedded && <MobilePeople session={session} />}
          <MobileActions session={session} invite={invite} canShare={canShare} onOpenSettings={openSettings} onFullscreen={fullscreen} />
          {!canShare && shareBlockedReason && <Notice>{shareBlockedReason}</Notice>}
          {canShare && sharing && <QualityCard session={session} />}
          {!embedded && <RoomCard session={session} invite={invite} />}
        </main>
      )}

      {app && <SourcePicker mixer={mixer} />}
      <Toast message={notice} onDone={clearNotice} />
    </div>
  );
}
