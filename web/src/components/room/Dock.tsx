import {
  AppWindow,
  ChevronDown,
  Gauge,
  Globe,
  HeadphoneOff,
  Headphones,
  Link2,
  LoaderCircle,
  Maximize,
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
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
  /** Sair da chamada (botão vermelho). */
  onLeave?: () => void;
  /** Só no aplicativo de Windows: o som do computador inteiro, pelo componente de áudio. */
  systemAudio?: SystemAudio;
  /** Painel de qualidade (resolução, FPS), aberto por um botão: dá para ajustar antes de transmitir. */
  qualityPanel?: React.ReactNode;
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
      <MenuItem icon={<Globe className="size-4" />} hint="Uma aba com o áudio só dela. A taxa de quadros depende da fonte e do navegador." onClick={() => pick('browser')}>
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
          hint="Tudo o que toca no PC, menos o próprio Cosmic Night: as vozes da sala não voltam como eco."
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

type Tone = 'normal' | 'ativo' | 'mudo' | 'principal' | 'perigo';

const TONES: Record<Tone, string> = {
  normal: 'bg-white/[0.06] text-fog-200 hover:bg-white/12 hover:text-white',
  ativo: 'bg-white/12 text-white hover:bg-white/18',
  mudo: 'bg-live-500/18 text-live-300 hover:bg-live-500/28',
  principal: 'bg-brand-500 text-on-accent shadow-glow hover:bg-brand-400',
  perigo: 'bg-live-500 text-on-accent hover:bg-live-400',
};

/** Botão redondo da barra da chamada: só o ícone, com o nome na dica e para leitores de tela. */
function RoundButton({ label, tone = 'normal', className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: Tone }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={rest.title ?? label}
      className={cx('inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-40', TONES[tone], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Botão redondo com uma seta ao lado que abre opções (microfone, compartilhar). */
function RoundSplit({
  label,
  menuLabel,
  tone = 'normal',
  disabled,
  title,
  onClick,
  icon,
  testId,
  children,
}: {
  label: string;
  menuLabel: string;
  tone?: Tone;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  icon: React.ReactNode;
  testId?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  return (
    <Menu
      side="top"
      trigger={({ open, toggle }) => (
        <div className="flex items-center">
          <RoundButton label={label} title={title} tone={tone} disabled={disabled} onClick={onClick} data-testid={testId} className="rounded-r-md">
            {icon}
          </RoundButton>
          <button
            type="button"
            aria-label={menuLabel}
            title={menuLabel}
            aria-expanded={open}
            onClick={toggle}
            className={cx('ml-px inline-flex h-11 w-6 items-center justify-center rounded-l-md rounded-r-full transition-colors duration-150', TONES[tone === 'principal' ? 'principal' : 'normal'], tone === 'principal' && 'shadow-none')}
          >
            <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      )}
    >
      {children}
    </Menu>
  );
}

const Divider = () => <span className="mx-1 h-7 w-px shrink-0 bg-white/10" aria-hidden="true" />;

/**
 * Controles da chamada no computador: uma barra discreta e centralizada. Microfone e o que você ouve à esquerda;
 * tudo da transmissão junto no meio ("Parar" só aparece transmitindo); configurações, convite e desconectar à
 * direita. Estatísticas e qualidade só aparecem quando fazem sentido.
 */
export function Dock({ session, invite, canShare, shareBlockedReason, mixerOpen, onOpenMixer, onOpenSettings, onLeave, systemAudio, qualityPanel }: DockProps) {
  const { share, micOn, micBusy, audioSource, rights } = useDock(session);
  const deafened = useStore(session.store, (state) => state.deafened);

  return (
    <nav aria-label="Controles da chamada" className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl bg-ink-900/85 px-2.5 py-2 shadow-panel backdrop-blur" data-testid="dock">
      <RoundSplit
        label={micOn ? 'Desligar o microfone' : 'Ligar o microfone'}
        menuLabel="Escolher microfone"
        tone={micOn ? 'ativo' : 'mudo'}
        disabled={micBusy || (!rights.speak && !micOn)}
        title={!rights.speak ? 'Você não tem permissão para falar neste canal.' : undefined}
        onClick={() => void session.setMic(!micOn)}
        icon={micBusy ? <LoaderCircle className="size-5 animate-spin" /> : micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
        testId="dock-mic"
      >
        {(close) => <MicMenuItems session={session} close={close} />}
      </RoundSplit>
      <RoundButton
        label={deafened ? 'Voltar a ouvir a chamada' : 'Parar de ouvir a chamada'}
        tone={deafened ? 'mudo' : 'normal'}
        aria-pressed={deafened}
        onClick={() => session.setDeafened(!deafened)}
        data-testid="dock-deafen"
      >
        {deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
      </RoundButton>

      <Divider />

      <RoundSplit
        label={share.active ? 'Trocar a tela transmitida' : 'Compartilhar a tela'}
        menuLabel="Opções de compartilhamento"
        tone={share.active ? 'ativo' : 'principal'}
        disabled={!canShare || share.starting || !rights.stream}
        title={!rights.stream ? 'Você não tem permissão para transmitir a tela neste canal.' : (shareBlockedReason ?? undefined)}
        onClick={() => void shareFrom(session)}
        icon={share.starting ? <LoaderCircle className="size-5 animate-spin" /> : <Monitor className="size-5" />}
        testId="dock-share"
      >
        {(close) => <ShareMenuItems session={session} close={close} />}
      </RoundSplit>
      <Menu
        side="top"
        trigger={({ open, toggle }) => (
          <RoundButton
            label="Opções de áudio"
            title={!rights.streamAudio ? 'Você não tem permissão para compartilhar áudio neste canal.' : 'Áudio que acompanha a tela'}
            tone={audioSource !== 'nenhum' || mixerOpen ? 'ativo' : 'normal'}
            disabled={!rights.streamAudio}
            aria-expanded={open}
            onClick={toggle}
            data-testid="dock-audio"
          >
            {audioSource === 'nenhum' ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </RoundButton>
        )}
      >
        {(close) => <AudioMenuItems session={session} close={close} onOpenMixer={onOpenMixer} systemAudio={systemAudio} />}
      </Menu>
      {qualityPanel && (
        <Menu
          side="top"
          trigger={({ open, toggle }) => (
            <RoundButton label="Qualidade da transmissão" tone={open ? 'ativo' : 'normal'} aria-expanded={open} onClick={toggle} data-testid="dock-quality">
              <Gauge className="size-5" />
            </RoundButton>
          )}
        >
          <div className="w-[22rem] max-w-[90vw]">{qualityPanel}</div>
        </Menu>
      )}
      {share.active && (
        <button
          type="button"
          onClick={() => void session.stopShare()}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-live-500/18 px-4 text-sm font-bold text-live-300 transition-colors hover:bg-live-500/28"
          data-testid="dock-stop"
        >
          <Square className="size-4" aria-hidden="true" />
          Parar transmissão
        </button>
      )}

      <Divider />

      <RoundButton label="Configurações da chamada" onClick={onOpenSettings} data-testid="dock-settings">
        <Settings className="size-5" />
      </RoundButton>
      {invite && (
        <RoundButton label="Convidar: copiar o link da sala" onClick={() => copyInvite(session, invite)} data-testid="dock-invite">
          <Link2 className="size-5" />
        </RoundButton>
      )}
      {onLeave && (
        <RoundButton label="Desconectar" tone="perigo" onClick={onLeave} data-testid="dock-leave" className="ml-1 w-14">
          <PhoneOff className="size-5" />
        </RoundButton>
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
          ? 'border-brand-300 bg-linear-to-b from-brand-500 to-brand-700 text-on-accent shadow-glow'
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
