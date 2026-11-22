import { Copy, Crown, Eye, EyeOff, KeyRound, Link2, Lock, LockOpen, MicOff, Monitor, UserPlus, Users, UserX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { copyText } from '../../lib/format.ts';
import { dialogs } from '../../lib/dialogs.ts';
import { inviteLink } from '../../lib/invite-access.ts';
import type { ParticipantView, RoomSession } from '../../lib/session.ts';
import { storage } from '../../lib/storage.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar, Button, Card, cx, IconButton, Toggle } from '../ui.tsx';
import { UserTrigger } from '../social/UserInteractions.tsx';
import { StreamHover } from './StreamHover.tsx';
import { CosmeticName, DecoratedAvatar, MemberNameEffect } from '../cosmetics/Decoration.tsx';

export function copyInvite(session: RoomSession, invite: string): void {
  void copyText(inviteLink(invite)).then((done) =>
    session.notify(done ? 'Link de convite copiado. Mande para quem você quer na sala.' : 'Não foi possível copiar. Copie o endereço da barra do navegador.'),
  );
}

function CopyField({ icon, label, value, masked, onCopy, testId }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  masked?: boolean;
  onCopy: () => void;
  testId?: string;
}) {
  const [visible, setVisible] = useState(!masked);
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
        <span className="text-brand-300">{icon}</span>
        {label}
      </p>
      <div className="flex h-10 items-center gap-1 rounded-xl border border-ink-600 bg-ink-900/70 pr-1 pl-3">
        <input
          readOnly
          aria-label={label}
          type={visible ? 'text' : 'password'}
          value={value}
          data-testid={testId}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent text-sm text-fog-100 outline-none"
        />
        {masked && (
          <IconButton label={visible ? 'Esconder senha' : 'Mostrar senha'} className="size-8" onClick={() => setVisible((value) => !value)}>
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </IconButton>
        )}
        <IconButton label={`Copiar ${label.toLowerCase()}`} className="size-8" onClick={onCopy}>
          <Copy className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}

export function RoomCard({ session, invite, className }: { session: RoomSession; invite: string; className?: string }) {
  const hasPassword = useStore(session.store, (state) => state.hasPassword);
  const locked = useStore(session.store, (state) => state.locked);
  const isHost = useStore(session.store, (state) => state.isHost);
  const password = storage.getRoom(invite)?.password;
  const link = inviteLink(invite);

  return (
    <Card className={cx('grid gap-4 p-4', className)}>
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/20 text-brand-300">
          <Lock className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-[17px] font-extrabold">Sala Privada</h2>
          <p className="text-sm leading-snug text-fog-400">
            {hasPassword ? 'Apenas pessoas com o link e a senha podem entrar.' : 'Apenas pessoas com o link podem entrar.'}
          </p>
        </div>
      </div>

      <CopyField
        icon={<Link2 className="size-4" />}
        label="Link da sala"
        value={link}
        testId="room-link"
        onCopy={() => copyInvite(session, invite)}
      />

      {hasPassword && password && (
        <CopyField
          icon={<KeyRound className="size-4" />}
          label="Senha da sala"
          value={password}
          masked
          onCopy={() => void copyText(password).then(() => session.notify('Senha copiada.'))}
        />
      )}

      {isHost && (
        <div className="grid gap-3 border-t border-ink-700 pt-3">
          <div className="flex items-center gap-3">
            <span className="text-brand-300">{locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}</span>
            <div className="flex-1">
              <p className="text-sm font-semibold">Trancar a sala</p>
              <p className="text-xs text-fog-400">Ninguém novo entra; quem já está pode voltar.</p>
            </div>
            <Toggle on={locked} label="Trancar a sala" onChange={(value) => void session.setLocked(value)} />
          </div>
          <Button
            variant="bare"
            size="sm"
            className="justify-start text-live-300 hover:bg-live-500/10 hover:text-live-300"
            onClick={() => {
              void dialogs.confirm({
                title: 'Encerrar a sala para todos?',
                message: 'Quem estiver na sala é desconectado e o link deixa de funcionar.',
                confirmLabel: 'Encerrar a sala',
                tone: 'perigo',
                action: () => session.closeRoom(),
              });
            }}
          >
            Encerrar a sala para todos
          </Button>
        </div>
      )}
    </Card>
  );
}

function status(person: ParticipantView): string {
  if (person.sharing) return 'Compartilhando a tela';
  if (person.speaking) return 'Falando';
  return 'Assistindo';
}

export function ParticipantsCard({
  session,
  invite,
  className,
  actions,
  serverNameEffects = false,
}: {
  session: RoomSession;
  /** Vazio nos canais de voz de grupos: sem botão de convite. */
  invite: string;
  className?: string;
  /** Controles extras por pessoa (volume e moderação nos canais de voz). */
  actions?: (person: ParticipantView) => ReactNode;
  serverNameEffects?: boolean;
}) {
  const participants = useStore(session.store, (state) => state.participants);
  const isHost = useStore(session.store, (state) => state.isHost);

  return (
    <Card className={cx('flex min-h-0 flex-col', className)} data-testid="participants">
      <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
        <h2 className="flex items-center gap-2.5 text-[17px] font-extrabold">
          <Users className="size-5 text-brand-300" aria-hidden="true" />
          Participantes <span className="text-brand-300">({participants.length})</span>
        </h2>
        {invite && (
          <IconButton label="Convidar: copiar o link da sala" onClick={() => copyInvite(session, invite)}>
            <UserPlus className="size-5 text-brand-300" />
          </IconButton>
        )}
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {participants.map((person) => (
          <li
            key={person.identity}
            data-testid="participant"
            data-identity={person.identity}
            data-server-member={serverNameEffects || undefined}
            className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink-800"
          >
            {serverNameEffects && <MemberNameEffect userId={person.accountId ?? person.identity} />}
            <StreamHover session={session} identity={person.identity} name={person.name} enabled={person.sharing} className="flex min-w-0 flex-1 items-center gap-3">
            <UserTrigger userId={person.isLocal ? null : person.accountId ?? person.identity} className="flex min-w-0 flex-1 items-center gap-3">
            {person.accountId
              ? <DecoratedAvatar preview={person.guestLook} userId={person.accountId} name={person.name} image={person.avatar} online speaking={person.speaking} />
              : <Avatar id={person.identity} name={person.name} image={person.avatar} online speaking={person.speaking} />}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-bold">
                <span className="truncate" data-testid="participant-name">
                  <CosmeticName preview={person.guestLook} userId={person.accountId}>{person.isLocal ? 'Você' : person.name}</CosmeticName>
                </span>
                {person.isHost && (
                  <>
                    <span className="shrink-0 text-sm font-normal text-fog-400">(Anfitrião)</span>
                    <Crown className="size-4 shrink-0 text-brand-300" aria-label="Dono da sala" />
                  </>
                )}
              </p>
              <p className="truncate text-sm text-fog-400">{status(person)}</p>
            </div>
            </UserTrigger>
            </StreamHover>
            {person.sharing && <Monitor className="size-[18px] shrink-0 text-brand-300" aria-label="Compartilhando a tela" />}
            {!person.micOn && <MicOff className="size-[18px] shrink-0 text-fog-500" aria-label="Microfone desligado" data-testid="mic-off" />}
            {actions?.(person)}
            {isHost && !person.isLocal && (
              <IconButton
                label={`Expulsar ${person.name}`}
                data-testid="kick"
                className="size-8 text-live-300 opacity-0 group-hover:opacity-100 hover:bg-live-500/15 hover:text-live-300 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                onClick={() => {
                  void dialogs.confirm({
                    title: `Expulsar ${person.name} da sala?`,
                    message: 'A pessoa é desconectada e não consegue voltar com a mesma sessão.',
                    confirmLabel: 'Expulsar',
                    tone: 'perigo',
                    action: () => session.kick(person.identity),
                  });
                }}
              >
                <UserX className="size-4" />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
