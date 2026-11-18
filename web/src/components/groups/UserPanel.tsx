import { Headphones, HeadphoneOff, Mic, MicOff, Settings } from 'lucide-react';
import type { Account } from '../../lib/groups/client.ts';
import type { RoomSession } from '../../lib/session.ts';
import { openSettings } from '../../lib/settings-screen.ts';
import { useStore } from '../../lib/store.ts';
import { DecoratedAvatar } from '../cosmetics/Decoration.tsx';
import { cx, IconButton } from '../ui.tsx';

/** Microfone e som recebido da chamada em que a pessoa está. */
function VoiceToggles({ session }: { session: RoomSession }) {
  const micOn = useStore(session.store, (state) => state.micOn);
  const micBusy = useStore(session.store, (state) => state.micBusy);
  const speak = useStore(session.store, (state) => state.rights.speak);
  const deafened = useStore(session.store, (state) => state.deafened);
  return (
    <>
      <IconButton label={micOn ? 'Desligar o microfone' : 'Ligar o microfone'} disabled={micBusy || (!speak && !micOn)} onClick={() => void session.setMic(!micOn)} data-testid="user-mic" aria-pressed={micOn}>
        {micOn ? <Mic className="size-5 text-ok-400" /> : <MicOff className="size-5 text-live-300" />}
      </IconButton>
      <IconButton label={deafened ? 'Voltar a ouvir a chamada' : 'Silenciar o áudio da chamada'} onClick={() => session.setDeafened(!deafened)} data-testid="user-deafen" aria-pressed={deafened}>
        {deafened ? <HeadphoneOff className="size-5 text-live-300" /> : <Headphones className="size-5" />}
      </IconButton>
    </>
  );
}

/** Rodapé da coluna de canais: quem está conectado, microfone, áudio da chamada e configurações da conta. */
export function UserPanel({ account, live, session, className }: { account: Account; live: boolean; session: RoomSession | null; className?: string }) {
  return (
    <div className={cx('flex items-center gap-1 border-t border-brand-500/15 px-2.5 py-2', className)} data-testid="user-panel">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 text-left hover:bg-white/5" onClick={() => openSettings('perfil')} data-testid="account-menu" aria-label="Sua conta">
        <DecoratedAvatar userId={account.id} name={account.displayName} size={38} online={live} />
        <span className="min-w-0">
          <span className="block truncate text-sm leading-tight font-bold">{account.displayName}</span>
          <span className="flex items-center gap-1 truncate text-xs text-fog-400">
            <span className={cx('size-1.5 shrink-0 rounded-full', live ? 'bg-ok-400' : 'bg-warn-400')} />
            {live ? 'Online' : 'Reconectando…'}
          </span>
        </span>
      </button>
      {session ? (
        <VoiceToggles session={session} />
      ) : (
        <>
          <IconButton label="Entre em um canal de voz para usar o microfone" disabled>
            <MicOff className="size-5" />
          </IconButton>
          <IconButton label="Entre em um canal de voz para ouvir a chamada" disabled>
            <Headphones className="size-5" />
          </IconButton>
        </>
      )}
      <IconButton label="Configurações da conta" onClick={() => openSettings('conta')} data-testid="account-settings-open">
        <Settings className="size-5" />
      </IconButton>
    </div>
  );
}
