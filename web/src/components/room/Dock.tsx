import {
  AppWindow,
  ChevronDown,
  Globe,
  Headphones,
  Link2,
  LoaderCircle,
  Maximize,
  Mic,
  MicOff,
  Monitor,
  Settings,
  SlidersHorizontal,
  Square,
  UserPlus,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Surface } from '../../lib/capture.ts';
import { desktop } from '../../lib/desktop.ts';
import type { RoomSession } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { Button, cx, Menu, MenuItem, MenuLabel } from '../ui.tsx';
import { copyInvite } from './Sidebar.tsx';

interface DockProps {
  session: RoomSession;
  invite: string;
  canShare: boolean;
  shareBlockedReason: string | null;
  mixerOpen: boolean;
  onOpenMixer: () => void;
  onOpenSettings: () => void;
  onFullscreen: () => void;
  /** Só no aplicativo de Windows: o som do computador inteiro, pelo componente de áudio. */
  systemAudio?: SystemAudio;
}

interface SystemAudio {
  on: boolean;
  enable: () => void;
}

function useDock(session: RoomSession) {
  return {
    share: useStore(session.store, (state) => state.share),
    micOn: useStore(session.store, (state) => state.micOn),
    micBusy: useStore(session.store, (state) => state.micBusy),
    mic: useStore(session.store, (state) => state.mic),
    devices: useStore(session.store, (state) => state.devices),
    audioSource: useStore(session.store, (state) => state.audioSource),
    rights: useStore(session.store, (state) => state.rights),
  };
}

/** Abre o seletor do navegador. Se já houver transmissão, troca a fonte. */
async function shareFrom(session: RoomSession, surface?: Surface): Promise<void> {
  session.setPreferredSurface(surface);
  if (session.store.get().share.active) await session.stopShare();
  await session.startShare();
}

function ShareMenuItems({ session, close }: { session: RoomSession; close: () => void }) {
  const pick = (surface: Surface) => {
    close();
    void shareFrom(session, surface);
  };
  if (desktop) {
    return (
      <>
        <MenuLabel>Abrir o seletor em</MenuLabel>
        <MenuItem icon={<AppWindow className="size-4" />} hint="Só uma janela de programa (o jogo em janela sem bordas, por exemplo). Chega a 60 FPS." onClick={() => pick('window')}>
          Janela
        </MenuItem>
        <MenuItem icon={<Monitor className="size-4" />} hint="Tudo o que aparece em um monitor. Chega a 60 FPS." onClick={() => pick('monitor')}>
          Tela inteira
        </MenuItem>
        <p className="px-2.5 pt-1.5 pb-1 text-xs leading-snug text-fog-500">Nada é capturado antes de você escolher e confirmar no seletor.</p>
      </>
    );
  }
  return (
    <>
      <MenuLabel>Abrir o seletor em</MenuLabel>
      <MenuItem icon={<Monitor className="size-4" />} hint="Tudo o que aparece no monitor. A captura da tela inteira chega a 60 FPS." onClick={() => pick('monitor')}>
        Tela inteira
      </MenuItem>
      <MenuItem icon={<AppWindow className="size-4" />} hint="Só uma janela de programa (o jogo em janela sem bordas, por exemplo). Janelas de outros programas chegam a 60 FPS." onClick={() => pick('window')}>
        Janela
      </MenuItem>
      <MenuItem icon={<Globe className="size-4" />} hint="Uma aba, com o áudio só dela. É a única fonte que chega a 120 FPS." onClick={() => pick('browser')}>
        Aba do navegador
      </MenuItem>
      <p className="px-2.5 pt-1.5 pb-1 text-xs leading-snug text-fog-500">
        É só uma sugestão: quem escolhe e autoriza é você, no seletor do navegador.
      </p>
    </>
  );
}

function AudioMenuItems({ session, close, onOpenMixer, systemAudio }: { session: RoomSession; close: () => void; onOpenMixer: () => void; systemAudio?: SystemAudio }) {
  const audioSource = useStore(session.store, (state) => state.audioSource);
  return (
    <>
      <MenuLabel>Áudio que acompanha a tela</MenuLabel>
      <MenuItem
        selected={audioSource === 'nenhum'}
        icon={<VolumeX className="size-4" />}
        onClick={() => {
          close();
          void session.setAudioSource('nenhum');
        }}
      >
        Não transmitir áudio
      </MenuItem>
      {systemAudio ? (
        <MenuItem
          selected={systemAudio.on}
          icon={<Volume2 className="size-4" />}
          hint="Tudo o que toca no PC, menos o próprio ShareRoom: as vozes da sala não voltam como eco."
          data-testid="audio-system"
          onClick={() => {
            close();
            systemAudio.enable();
          }}
        >
          Som do computador
        </MenuItem>
      ) : (
        <MenuItem
          selected={audioSource === 'navegador'}
          icon={<Volume2 className="size-4" />}
          hint="O que o navegador oferecer no seletor: som da aba, da janela ou do sistema inteiro."
          onClick={() => {
            close();
            void session.setAudioSource('navegador');
          }}
        >
          Áudio pelo navegador
        </MenuItem>
      )}
      <MenuItem
        selected={audioSource === 'apps'}
        icon={<SlidersHorizontal className="size-4" />}
        hint={desktop ? 'Escolha app por app (VALORANT, Discord…), com volume separado.' : 'Escolha app por app (VALORANT, Discord…), com volume separado. Exige o app auxiliar no Windows.'}
        data-testid="open-mixer"
        onClick={() => {
          close();
          onOpenMixer();
        }}
      >
        Mixer por aplicativo
      </MenuItem>
    </>
  );
}

function MicMenuItems({ session, close }: { session: RoomSession; close: () => void }) {
  const devices = useStore(session.store, (state) => state.devices);
  const mic = useStore(session.store, (state) => state.mic);
  return (
    <>
      <MenuLabel>Microfone</MenuLabel>
      <MenuItem
        selected={mic.deviceId === null}
        onClick={() => {
          close();
          void session.updateMic({ deviceId: null });
        }}
      >
        Padrão do sistema
      </MenuItem>
      {devices.inputs
        .filter((device) => device.deviceId !== 'default' && device.deviceId !== 'communications')
        .map((device) => (
          <MenuItem
            key={device.deviceId}
            selected={mic.deviceId === device.deviceId}
            onClick={() => {
              close();
              void session.updateMic({ deviceId: device.deviceId });
            }}
          >
            {device.label || 'Microfone sem nome'}
          </MenuItem>
        ))}
      {devices.inputs.every((device) => !device.label) && (
        <p className="px-2.5 py-1.5 text-xs leading-snug text-fog-500">
          Os nomes dos aparelhos aparecem depois que você liga o microfone pela primeira vez.
        </p>
      )}
    </>
  );
}

/** Botão com uma metade que age e outra (seta) que abre opções. */
function SplitButton({
  variant = 'quiet',
  active,
  disabled,
  title,
  onClick,
  icon,
  label,
  menuLabel,
  testId,
  children,
}: {
  variant?: 'primary' | 'quiet';
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  menuLabel: string;
  testId?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  return (
    <Menu
      side="top"
      trigger={({ open, toggle }) => (
        <div className="flex">
          <Button
            variant={variant}
            active={active}
            disabled={disabled}
            title={title}
            onClick={onClick}
            data-testid={testId}
            className="rounded-r-none border-r-0 pr-3"
          >
            {icon}
            {label}
          </Button>
          <Button
            variant={variant}
            active={active}
            aria-label={menuLabel}
            aria-expanded={open}
            onClick={toggle}
            className="rounded-l-none px-2.5"
          >
            <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
      )}
    >
      {children}
    </Menu>
  );
}

/** Barra de ações do computador, como no mockup. */
export function Dock({ session, invite, canShare, shareBlockedReason, mixerOpen, onOpenMixer, onOpenSettings, onFullscreen, systemAudio }: DockProps) {
  const { share, micOn, micBusy, audioSource, rights } = useDock(session);

  return (
    <nav
      aria-label="Ações da sala"
      className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-3 rounded-2xl border border-ink-700 bg-ink-850/90 px-4 py-3 shadow-panel backdrop-blur"
    >
      <SplitButton
        variant="primary"
        disabled={!canShare || share.starting || !rights.stream}
        title={!rights.stream ? 'Você não tem permissão para transmitir a tela neste canal.' : (shareBlockedReason ?? undefined)}
        onClick={() => void shareFrom(session)}
        icon={share.starting ? <LoaderCircle className="size-5 animate-spin" /> : <Monitor className="size-5" />}
        label={share.active ? 'Trocar a tela' : 'Compartilhar Tela'}
        menuLabel="Opções de compartilhamento"
        testId="dock-share"
      >
        {(close) => <ShareMenuItems session={session} close={close} />}
      </SplitButton>

      <Button variant="danger" disabled={!share.active} onClick={() => void session.stopShare()} data-testid="dock-stop">
        <Square className="size-5" />
        Parar
      </Button>

      <SplitButton
        active={micOn}
        disabled={micBusy || (!rights.speak && !micOn)}
        title={!rights.speak ? 'Você não tem permissão para falar neste canal.' : undefined}
        onClick={() => void session.setMic(!micOn)}
        icon={micBusy ? <LoaderCircle className="size-5 animate-spin" /> : micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
        label="Microfone"
        menuLabel="Escolher microfone"
        testId="dock-mic"
      >
        {(close) => <MicMenuItems session={session} close={close} />}
      </SplitButton>

      <SplitButton
        active={audioSource !== 'nenhum' || mixerOpen}
        disabled={!rights.streamAudio}
        title={!rights.streamAudio ? 'Você não tem permissão para compartilhar áudio neste canal.' : undefined}
        onClick={() => {
          if (audioSource !== 'nenhum') void session.setAudioSource('nenhum');
          else if (systemAudio) systemAudio.enable();
          else void session.setAudioSource('navegador');
        }}
        icon={audioSource === 'nenhum' ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        label={audioSource === 'apps' && !systemAudio?.on ? 'Áudio por app' : 'Áudio do Sistema'}
        menuLabel="Opções de áudio"
        testId="dock-audio"
      >
        {(close) => <AudioMenuItems session={session} close={close} onOpenMixer={onOpenMixer} systemAudio={systemAudio} />}
      </SplitButton>

      <Button onClick={onOpenSettings} data-testid="dock-settings">
        <Settings className="size-5" />
        Configurações
      </Button>
      <Button onClick={onFullscreen}>
        <Maximize className="size-5" />
        Tela Cheia
      </Button>

      {invite && (
        <>
          <span className="h-8 w-px shrink-0 bg-ink-600" aria-hidden="true" />
          <Button variant="outline" onClick={() => copyInvite(session, invite)} data-testid="dock-invite">
            <Link2 className="size-5" />
            Convidar (Link da Sala)
          </Button>
        </>
      )}
    </nav>
  );
}

function Tile({
  primary,
  active,
  disabled,
  onClick,
  icon,
  label,
  testId,
}: {
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cx(
        'flex h-[4.75rem] w-full min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border px-0.5 text-center text-[12px] leading-[1.15] font-bold transition-colors disabled:opacity-45',
        primary
          ? 'border-brand-300 bg-linear-to-b from-brand-500 to-brand-700 text-white shadow-glow'
          : active
            ? 'border-brand-400 bg-brand-500/20 text-white'
            : 'border-ink-600 bg-ink-800/90 text-fog-100',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Grade de ações do celular, como no mockup mobile. */
export function MobileActions({ session, invite, canShare, onOpenSettings, onFullscreen }: Omit<DockProps, 'mixerOpen' | 'onOpenMixer' | 'shareBlockedReason'>) {
  const { share, micOn, micBusy, audioSource, rights } = useDock(session);
  const icon = 'size-6';

  return (
    <nav aria-label="Ações da sala" className="grid grid-cols-5 gap-2">
      {canShare ? (
        <Tile
          primary={!share.active}
          active={share.active}
          disabled={share.starting || (!rights.stream && !share.active)}
          onClick={() => void (share.active ? session.stopShare() : session.startShare())}
          icon={share.active ? <Square className={icon} /> : <Monitor className={icon} />}
          label={share.active ? 'Parar' : 'Mostrar tela'}
          testId="mobile-share"
        />
      ) : (
        <Tile onClick={onOpenSettings} icon={<Settings className={icon} />} label="Ajustes" />
      )}
      <Tile
        active={audioSource !== 'nenhum'}
        onClick={() => void session.setAudioSource(audioSource === 'nenhum' ? 'navegador' : 'nenhum')}
        icon={<Headphones className={icon} />}
        label="Áudio"
      />
      <Tile
        active={micOn}
        disabled={micBusy || (!rights.speak && !micOn)}
        onClick={() => void session.setMic(!micOn)}
        icon={micOn ? <Mic className={icon} /> : <MicOff className={icon} />}
        label="Mic"
        testId="mobile-mic"
      />
      <Tile onClick={onFullscreen} icon={<Maximize className={icon} />} label="Tela cheia" />
      {invite ? (
        <Tile onClick={() => copyInvite(session, invite)} icon={<UserPlus className={icon} />} label="Convidar" />
      ) : (
        <Tile onClick={onOpenSettings} icon={<Settings className={icon} />} label="Ajustes" />
      )}
    </nav>
  );
}
