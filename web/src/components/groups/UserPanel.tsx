import { Headphones, HeadphoneOff, LogOut, Mic, MicOff, Settings } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { alertPrefs, allowDesktopAlerts, desktopAlertsSupported } from '../../lib/groups/alerts.ts';
import { groups, type Account } from '../../lib/groups/client.ts';
import { dialogs } from '../../lib/dialogs.ts';
import type { RoomSession } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar, Button, cx, IconButton, Modal, TextInput, Toggle } from '../ui.tsx';
import { fieldLabel, useAction } from './common.tsx';
import { ProfileEditor } from '../social/ProfileEditor.tsx';
import { AutostartSettings } from '../AutostartSettings.tsx';
import { UpdateSettings } from '../UpdateSettings.tsx';
import { desktop } from '../../lib/desktop.ts';

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

function AccountSettings({ account, onClose }: { account: Account; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [prefs, setPrefs] = useState(alertPrefs.get);
  const { busy, run } = useAction();

  const savePrefs = (patch: Partial<typeof prefs>) => {
    const value = { ...prefs, ...patch };
    setPrefs(value);
    alertPrefs.set(value);
  };

  const password = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await groups.changePassword(current, next);
      setCurrent('');
      setNext('');
      groups.notify('Senha trocada. Os outros aparelhos foram desconectados.');
    });
  };

  return (
    <Modal title="Sua conta" onClose={onClose}>
      <div className="grid gap-6" data-testid="account-settings">
        <section className="grid gap-3">
          <h3 className="font-extrabold">Perfil</h3>
          <ProfileEditor userId={account.id} />
        </section>

        {desktop && (
          <section className="grid gap-3 border-t border-ink-700 pt-5">
            <h3 className="font-extrabold">Atualizações</h3>
            <UpdateSettings />
          </section>
        )}
        {desktop?.autostart && (
          <section className="grid gap-3 border-t border-ink-700 pt-5">
            <h3 className="font-extrabold">Aplicativo para Windows</h3>
            <AutostartSettings />
          </section>
        )}
        <section className="grid gap-3 border-t border-ink-700 pt-5">
          <h3 className="font-extrabold">Avisos neste aparelho</h3>
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Notificações do sistema</p>
              <p className="text-[13px] leading-snug text-fog-400">
                {desktopAlertsSupported() ? 'Mostra um aviso quando chega mensagem e a janela não está em foco.' : 'Este navegador não mostra notificações.'}
              </p>
            </div>
            <Toggle
              on={prefs.desktop}
              label="Notificações do sistema"
              disabled={!desktopAlertsSupported()}
              onChange={(on) => {
                if (!on) return savePrefs({ desktop: false });
                void allowDesktopAlerts().then((allowed) => {
                  savePrefs({ desktop: allowed });
                  if (!allowed) groups.notify('As notificações estão bloqueadas para este site. Libere nas permissões do navegador.');
                });
              }}
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Som de mensagem</p>
              <p className="text-[13px] leading-snug text-fog-400">Um toque curto quando chega mensagem em outro canal ou com a janela em segundo plano.</p>
            </div>
            <Toggle on={prefs.sound} label="Som de mensagem" onChange={(sound) => savePrefs({ sound })} />
          </div>
          <p className="text-[13px] leading-snug text-fog-500">Quais mensagens avisam (todas, só menções ou nenhuma) você escolhe em cada grupo e em cada canal, pelo sino.</p>
        </section>

        <form className="grid gap-3 border-t border-ink-700 pt-5" onSubmit={password}>
          <h3 className="font-extrabold">Trocar a senha</h3>
          <label className={fieldLabel}>
            Senha atual
            <TextInput type="password" autoComplete="current-password" value={current} required onChange={(event) => setCurrent(event.target.value)} />
          </label>
          <label className={fieldLabel}>
            Senha nova
            <TextInput type="password" autoComplete="new-password" value={next} required minLength={8} onChange={(event) => setNext(event.target.value)} />
          </label>
          <Button type="submit" className="justify-self-start" disabled={busy || !current || next.length < 8}>
            Trocar senha
          </Button>
        </form>

        <div className="flex flex-wrap gap-2 border-t border-ink-700 pt-5">
          <Button
            variant="danger"
            onClick={() =>
              void dialogs.confirm({
                title: 'Sair da conta?',
                message: 'Você sai neste aparelho. Para voltar, entre de novo com seu usuário e senha.',
                confirmLabel: 'Sair da conta',
                tone: 'perigo',
                action: () => groups.logout(),
              })
            }
            data-testid="account-logout"
          >
            <LogOut className="size-4" aria-hidden="true" /> Sair da conta
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Rodapé da coluna de canais: quem está conectado, microfone, áudio da chamada e configurações da conta. */
export function UserPanel({ account, live, session, className }: { account: Account; live: boolean; session: RoomSession | null; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx('flex items-center gap-1 border-t border-brand-500/15 px-2.5 py-2', className)} data-testid="user-panel">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 text-left hover:bg-white/5" onClick={() => setOpen(true)} data-testid="account-menu" aria-label="Sua conta">
        <Avatar id={account.id} name={account.displayName} size={38} online={live} />
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
      <IconButton label="Configurações da conta" onClick={() => setOpen(true)} data-testid="account-settings-open">
        <Settings className="size-5" />
      </IconButton>
      {open && <AccountSettings account={account} onClose={() => setOpen(false)} />}
    </div>
  );
}
