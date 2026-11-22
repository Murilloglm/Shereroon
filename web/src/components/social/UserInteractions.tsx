import {
  AtSign,
  Ban,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  Gavel,
  LogOut,
  MessageSquare,
  MicOff,
  MoveRight,
  NotebookPen,
  Shield,
  ShieldCheck,
  Tag,
  UserCheck,
  UserMinus,
  UserPlus,
  UserRound,
  UserX,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { has, P } from '../../../../shared/permissions.ts';
import { itemById } from '../../../../shared/cosmetics.ts';
import { navigate } from '../../App.tsx';
import { dialogs } from '../../lib/dialogs.ts';
import { copyText } from '../../lib/format.ts';
import { moveToVoice } from '../../lib/groups/actions.ts';
import { groups, type GroupView, type MemberView } from '../../lib/groups/client.ts';
import type { RoomSession } from '../../lib/session.ts';
import { mediaUrl, social, type Profile } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { activities, playingFor, type CurrentActivity } from '../../lib/activities.ts';
import { GameIcon } from '../settings/GameIcon.tsx';
import { ArtworkProfileFrame, BackgroundArt, backgroundStyle, CosmeticName, DecoratedAvatar, ProfileFrame, ProfileNameplate, useUserCosmetics } from '../cosmetics/Decoration.tsx';
import { PersonVolume } from '../room/PersonVolume.tsx';
import { Avatar, cx } from '../ui.tsx';
import { errorText, memberName, nameColor } from '../groups/common.tsx';
import { ModerationPanel } from './ModerationPanel.tsx';

interface Ctx {
  view: GroupView | null;
  voice: { channelId: string; session: RoomSession } | null;
}

interface Interactions {
  openProfile: (userId: string, anchor: DOMRect) => void;
  openMenu: (userId: string, x: number, y: number) => void;
  openModeration: (userId: string) => void;
}

const InteractionsContext = createContext<Interactions | null>(null);

/** Props para qualquer elemento que representa uma pessoa: clique abre o perfil, botão direito abre o menu. */
export function useUserTriggers(userId: string | null | undefined) {
  const ctx = useContext(InteractionsContext);
  if (!ctx || !userId) return {};
  return {
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      event.stopPropagation();
      ctx.openProfile(userId, event.currentTarget.getBoundingClientRect());
    },
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      ctx.openMenu(userId, event.clientX, event.clientY);
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      // Teclado: Enter abre o perfil; Shift+F10 (ou a tecla de menu) abre o menu.
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        ctx.openProfile(userId, event.currentTarget.getBoundingClientRect());
      } else if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        ctx.openMenu(userId, rect.left + 12, rect.bottom);
      }
    },
    role: 'button' as const,
    tabIndex: 0,
    'data-user-trigger': userId,
  };
}

export function UserInteractions({ view, voice, children }: Ctx & { children: ReactNode }) {
  const [profile, setProfile] = useState<{ userId: string; anchor: DOMRect } | null>(null);
  const [menu, setMenu] = useState<{ userId: string; x: number; y: number } | null>(null);
  const [moderation, setModeration] = useState<string | null>(null);
  const notesLoaded = useStore(social.store, (state) => state.notesLoaded);
  useEffect(() => {
    if (!notesLoaded) void social.loadNotes().catch(() => undefined);
    if (social.store.get().friends === null) void social.loadFriends().catch(() => undefined);
  }, [notesLoaded]);

  const value = useRef<Interactions>({
    openProfile: (userId, anchor) => {
      setMenu(null);
      setProfile({ userId, anchor });
    },
    openMenu: (userId, x, y) => {
      setProfile(null);
      setMenu({ userId, x, y });
    },
    openModeration: (userId) => {
      setProfile(null);
      setMenu(null);
      setModeration(userId);
    },
  }).current;

  return (
    <InteractionsContext.Provider value={value}>
      {children}
      {profile && <ProfileCard key={profile.userId} userId={profile.userId} anchor={profile.anchor} view={view} onClose={() => setProfile(null)} onModerate={() => value.openModeration(profile.userId)} />}
      {menu && <UserMenu key={`${menu.userId}-${menu.x}-${menu.y}`} {...menu} view={view} voice={voice} onClose={() => setMenu(null)} onProfile={(anchor) => value.openProfile(menu.userId, anchor)} onModerate={() => value.openModeration(menu.userId)} />}
      {moderation && view && <ModerationPanel view={view} userId={moderation} onClose={() => setModeration(null)} />}
    </InteractionsContext.Provider>
  );
}

// --- Regras para mostrar (quem decide é sempre o backend) -------------------------------------------

/** Esta conta está acima da outra na hierarquia (ou é a dona)? */
export function outranks(view: GroupView, member: MemberView | undefined): boolean {
  if (!member || member.userId === view.me.userId || member.cosmicAdmin) return false;
  if (view.me.isCosmicAdmin) return true;
  if (member.userId === view.group.ownerId) return false;
  if (view.me.isOwner) return true;
  const mine = view.me.top ?? -1;
  const theirs = Math.max(-1, ...view.roles.filter((role) => !role.isEveryone && member.roleIds.includes(role.id)).map((role) => role.position));
  return mine > theirs;
}

export function canModerate(view: GroupView): boolean {
  const any = P.KICK_MEMBERS | P.BAN_MEMBERS | P.MANAGE_ROLES | P.VIEW_AUDIT_LOG | P.MUTE_MEMBERS | P.MOVE_MEMBERS | P.MANAGE_MESSAGES;
  return view.me.isOwner || has(view.me.permissions, P.ADMINISTRATOR) || (view.me.permissions & any) !== 0n;
}

/** Ações de amizade conforme o estado atual. */
function useFriendship(userId: string) {
  const friends = useStore(social.store, (state) => state.friends);
  const entry = friends?.find((item) => item.user.id === userId);
  return entry?.state ?? 'nenhuma';
}

async function act(run: () => Promise<unknown>, success?: string): Promise<void> {
  try {
    await run();
    if (success) groups.notify(success);
  } catch (error) {
    await dialogs.alert({ kind: 'erro', title: 'Não deu certo', message: errorText(error) });
  }
}

export async function startDm(userId: string): Promise<void> {
  try {
    const dmId = await social.openDm(userId);
    navigate(`#/mensagens/${dmId}`);
  } catch (error) {
    await dialogs.alert({ kind: 'aviso', title: 'Não dá para mandar mensagem', message: errorText(error) });
  }
}

export function editNote(userId: string, name: string): void {
  void dialogs.prompt({
    title: `Nota sobre ${name}`,
    message: 'Só você vê esta nota.',
    label: 'Nota pessoal',
    defaultValue: social.store.get().notes[userId]?.note ?? '',
    maxLength: 256,
    confirmLabel: 'Salvar nota',
    action: (note) => social.setNote(userId, { note }),
  });
}

export function editNickname(userId: string, name: string): void {
  void dialogs.prompt({
    title: `Apelido para ${name}`,
    message: 'Só você vê este apelido; o nome da pessoa não muda para mais ninguém. Deixe vazio para tirar.',
    label: 'Apelido pessoal',
    defaultValue: social.store.get().notes[userId]?.nickname ?? '',
    maxLength: 32,
    confirmLabel: 'Salvar apelido',
    action: (nickname) => social.setNote(userId, { nickname }),
  });
}

// --- Cartão de perfil (clique) ------------------------------------------------------------------

function Banner({ profile }: { profile: Pick<Profile, 'banner' | 'id'> }) {
  const color = profile.banner?.startsWith('cor:') ? profile.banner.slice(4) : null;
  const image = mediaUrl(profile.banner);
  // Fundo de perfil equipado (loja), quando a pessoa não enviou uma imagem própria de banner.
  const cosmeticsOf = useUserCosmetics(profile.id);
  const equipped = backgroundStyle(cosmeticsOf);
  return (
    <div
      className="relative h-24 w-full overflow-hidden bg-cover bg-center"
      style={equipped ?? (image ? undefined : { background: color ? color : 'linear-gradient(120deg, #4b348e, #6c4dff 55%, #74d7ff)' })}
      data-testid="profile-banner"
    >
      {image && !equipped ? <img src={image} alt="" className="size-full object-cover" /> : <BackgroundArt equipped={cosmeticsOf} />}
    </div>
  );
}

export function ProfileCard({ userId, anchor, view, onClose, onModerate }: { userId: string; anchor: DOMRect; view: GroupView | null; onClose: () => void; onModerate: () => void }) {
  const profile = useStore(social.store, (state) => state.profiles[userId]);
  const me = useStore(groups.store, (state) => state.account?.id);
  const friendship = useFriendship(userId);
  const [failure, setFailure] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.right + 10, top: anchor.top });
  const member = view?.members.find((item) => item.userId === userId);

  useEffect(() => {
    void social.profile(userId, true).catch((error: unknown) => setFailure(errorText(error)));
  }, [userId]);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    const left = anchor.right + 10 + width > window.innerWidth - 8 ? Math.max(8, anchor.left - 10 - width) : anchor.right + 10;
    setPosition({ left, top: Math.min(Math.max(8, anchor.top - 20), window.innerHeight - height - 8) });
  }, [anchor, profile]);
  useDismiss(ref, onClose);

  const roles = member && view ? view.roles.filter((role) => !role.isEveryone && member.roleIds.includes(role.id)) : [];
  const name = member ? memberName(member) : profile ? social.nameFor(profile.id, profile.displayName) : '';
  const self = me === userId;
  const worn = useUserCosmetics(userId);
  const framed = Boolean(itemById(worn.moldura?.item ?? '')?.frameAspect);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Perfil de ${name || 'usuário'}`}
      className="fixed z-[70] w-80 animate-rise overflow-hidden rounded-2xl border border-brand-400/50 bg-ink-900 shadow-glow"
      style={position}
      data-testid="profile-card"
      data-user={userId}
    >
      <ProfileFrame equipped={worn} />
      {!profile ? (
        <p className="p-5 text-sm text-fog-400">{failure ?? 'Carregando o perfil…'}</p>
      ) : (
        <>
          <Banner profile={profile} />
          <div className="relative px-4 pb-4">
            <ArtworkProfileFrame userId={profile.id}>
              <div className={framed ? 'flex justify-center py-3' : '-mt-10 mb-2 w-fit rounded-full border-4 border-ink-900'}>
                <DecoratedAvatar userId={profile.id} name={profile.displayName} size={framed ? 48 : 76} image={profile.avatar} animate />
              </div>
              {framed ? <p className="flex w-full items-center justify-center text-lg leading-tight font-extrabold" style={{ color: member && view ? nameColor(view, member) : undefined }} data-testid="profile-name">
                <CosmeticName userId={profile.id} className="min-w-0 truncate" animate>{name}</CosmeticName>
              </p> : <>
            <ProfileNameplate userId={profile.id}>
            <p className="flex items-center text-lg leading-tight font-extrabold" style={{ color: member && view ? nameColor(view, member) : undefined }} data-testid="profile-name">
              <CosmeticName userId={profile.id} className="min-w-0 truncate" animate>
                {name}
              </CosmeticName>
            </p>
            </ProfileNameplate>
              </>}
            </ArtworkProfileFrame>
            <p className="text-sm text-fog-400">
              @{profile.username}
              {profile.nickname && <span className="ml-1 text-xs text-neon-300">(apelido seu)</span>}
              {profile.cosmicAdmin && <span className="ml-1.5 rounded bg-violet-500/20 px-2 py-1 text-xs font-extrabold text-neon-300" title="Administrador oficial da plataforma">♛ Cosmic Admin</span>}
              {profile.bot && <span className="ml-1.5 rounded bg-brand-500/30 px-1 text-[10px] font-extrabold text-brand-100">BOT</span>}
            </p>
            {profile.status && <p className="mt-2 text-sm text-fog-200" data-testid="profile-status">{profile.status}</p>}
            <ProfileActivity userId={profile.id} />
            {profile.bio && <p className="mt-2 text-sm leading-snug whitespace-pre-line text-fog-300" data-testid="profile-bio">{profile.bio}</p>}
            {roles.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1" data-testid="profile-roles">
                {roles.map((role) => (
                  <span key={role.id} className="flex items-center gap-1 rounded-md border border-ink-600 px-1.5 py-0.5 text-xs font-semibold">
                    <span className="size-2 rounded-full" style={{ background: role.color ?? 'var(--color-fog-500)' }} />
                    {role.name}
                  </span>
                ))}
              </div>
            )}
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-fog-400">
              <dt>Conta desde</dt>
              <dd className="text-fog-300">{new Date(profile.createdAt).toLocaleDateString('pt-BR')}</dd>
              {member && (
                <>
                  <dt>No grupo desde</dt>
                  <dd className="text-fog-300">{new Date(member.joinedAt).toLocaleDateString('pt-BR')}</dd>
                </>
              )}
              {profile.friendSince && (
                <>
                  <dt>Amigos desde</dt>
                  <dd className="text-fog-300">{new Date(profile.friendSince).toLocaleDateString('pt-BR')}</dd>
                </>
              )}
            </dl>
            {profile.mutualGroups && profile.mutualGroups.length > 0 && (
              <p className="mt-2 text-xs text-fog-400">
                Grupos em comum: <span className="text-fog-300">{profile.mutualGroups.map((group) => group.name).join(', ')}</span>
              </p>
            )}
            {profile.note && (
              <p className="mt-2 rounded-lg border border-ink-700 bg-ink-850 px-2 py-1.5 text-xs text-fog-300" data-testid="profile-note">
                <span className="font-bold text-fog-400">Sua nota: </span>
                {profile.note}
              </p>
            )}
            {!self && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="cn-dialog-btn cn-dialog-primary min-w-0 flex-1 text-sm" disabled={!profile.canMessage} onClick={() => (onClose(), void startDm(userId))} data-testid="profile-message">
                  <MessageSquare className="size-4" aria-hidden="true" /> Mensagem
                </button>
                <FriendButton userId={userId} state={friendship} />
              </div>
            )}
            {!self && view && member && canModerate(view) && (
              <button type="button" className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-warn-400/40 py-2 text-sm font-bold text-warn-400 hover:bg-warn-400/10" onClick={onModerate} data-testid="profile-moderate">
                <ShieldCheck className="size-4" aria-hidden="true" /> Abrir como moderador
              </button>
            )}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

function FriendButton({ userId, state }: { userId: string; state: string }) {
  const base = 'cn-dialog-btn cn-dialog-secondary min-w-0 flex-1 text-sm';
  if (state === 'amigos') {
    return (
      <button type="button" className={base} onClick={() => void act(() => social.removeFriend(userId), 'Amizade desfeita.')} data-testid="profile-friend" data-state="amigos">
        <UserCheck className="size-4" aria-hidden="true" /> Amigos
      </button>
    );
  }
  if (state === 'recebida') {
    return (
      <button type="button" className={base} onClick={() => void act(() => social.acceptFriend(userId), 'Agora vocês são amigos.')} data-testid="profile-friend" data-state="recebida">
        <UserCheck className="size-4" aria-hidden="true" /> Aceitar pedido
      </button>
    );
  }
  if (state === 'enviada') {
    return (
      <button type="button" className={base} onClick={() => void act(() => social.removeFriend(userId), 'Pedido cancelado.')} data-testid="profile-friend" data-state="enviada">
        <Clock className="size-4" aria-hidden="true" /> Pedido enviado
      </button>
    );
  }
  return (
    <button type="button" className={base} onClick={() => void act(() => social.requestFriend({ userId }), 'Pedido de amizade enviado.')} data-testid="profile-friend" data-state="nenhuma">
      <UserPlus className="size-4" aria-hidden="true" /> Adicionar
    </button>
  );
}

/** Fecha com clique fora, Esc ou rolagem da página. */
function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const timer = setTimeout(() => document.addEventListener('pointerdown', onPointer), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onClose]);
}

// --- Menu de botão direito ------------------------------------------------------------------------

type Panel = 'principal' | 'mover' | 'cargos' | 'castigo';

function Item({ icon, children, onSelect, danger, testId, disabled, hint }: { icon: ReactNode; children: ReactNode; onSelect: () => void; danger?: boolean; testId?: string; disabled?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold transition-colors focus:outline-none disabled:opacity-40',
        danger ? 'text-live-300 hover:bg-live-500/15 focus:bg-live-500/15' : 'text-fog-100 hover:bg-brand-500/20 focus:bg-brand-500/20',
      )}
      data-testid={testId}
    >
      <span className={cx('shrink-0', danger ? 'text-live-300' : 'text-neon-300')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-fog-500">{hint}</span>}
    </button>
  );
}

const Separator = () => <div className="my-1 h-px bg-ink-700" role="separator" />;
const Heading = ({ children }: { children: ReactNode }) => <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-extrabold tracking-wide text-fog-500 uppercase">{children}</p>;

export function UserMenu({
  userId,
  x,
  y,
  view,
  voice,
  onClose,
  onProfile,
  onModerate,
}: {
  userId: string;
  x: number;
  y: number;
  view: GroupView | null;
  voice: Ctx['voice'];
  onClose: () => void;
  onProfile: (anchor: DOMRect) => void;
  onModerate: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<Panel>('principal');
  const [position, setPosition] = useState({ left: x, top: y });
  const me = useStore(groups.store, (state) => state.account?.id);
  const friendship = useFriendship(userId);
  const profile = useStore(social.store, (state) => state.profiles[userId]);
  useDismiss(ref, onClose);
  useEffect(() => {
    if (!profile) void social.profile(userId).catch(() => undefined);
  }, [userId, profile]);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({ left: Math.min(x, window.innerWidth - width - 8), top: Math.min(y, window.innerHeight - height - 8) });
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [x, y, panel]);

  const member = view?.members.find((item) => item.userId === userId);
  const name = member ? memberName(member) : profile ? social.nameFor(userId, profile.displayName) : 'esta pessoa';
  const self = me === userId;
  const close = (then: () => void) => () => {
    onClose();
    then();
  };
  // Canal de voz em que a pessoa está neste grupo (se estiver).
  const voiceChannelId = view ? Object.entries(view.voice).find(([, people]) => people.includes(userId))?.[0] : undefined;
  const voiceChannel = view?.channels.find((channel) => channel.id === voiceChannelId);
  const above = view ? outranks(view, member) : false;
  const voicePerms = voiceChannel?.permissions ?? 0n;
  const moderate = (action: string, extra: object = {}) =>
    act(() => groups.call('POST', `/api/channels/${voiceChannelId}/voice/moderate`, { userId, action, ...extra }));

  const keyNav = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  let content: ReactNode;
  if (panel === 'mover' && view) {
    const targets = view.channels.filter((channel) => channel.kind === 'voz' && channel.id !== voiceChannelId && has(channel.permissions, P.CONNECT));
    content = (
      <>
        <Item icon={<ChevronLeft className="size-4" />} onSelect={() => setPanel('principal')}>Voltar</Item>
        <Heading>Mover {name} para</Heading>
        {targets.length === 0 && <p className="px-2.5 py-1.5 text-sm text-fog-400">Nenhum outro canal de voz disponível.</p>}
        {targets.map((channel) => (
          <Item key={channel.id} icon={<MoveRight className="size-4" />} onSelect={close(() => void moveToVoice(view, voiceChannelId!, userId, channel.id))} testId="menu-move-target" hint={channel.private ? 'privado' : undefined}>
            {channel.name}
          </Item>
        ))}
      </>
    );
  } else if (panel === 'cargos' && view && member) {
    const manageable = view.roles.filter((role) => !role.isEveryone && !role.botId && (view.me.isOwner || view.me.isCosmicAdmin || role.position < (view.me.top ?? -1)));
    content = (
      <>
        <Item icon={<ChevronLeft className="size-4" />} onSelect={() => setPanel('principal')}>Voltar</Item>
        <Heading>Cargos de {name}</Heading>
        {manageable.map((role) => {
          const on = member.roleIds.includes(role.id);
          const next = on ? member.roleIds.filter((id) => id !== role.id) : [...member.roleIds, role.id];
          return (
            <button
              key={role.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold hover:bg-brand-500/20 focus:bg-brand-500/20 focus:outline-none"
              onClick={() => void act(() => groups.change('PATCH', `/api/groups/${view.group.id}/members/${userId}`, { roleIds: next }))}
              data-testid="menu-role"
              data-role={role.name}
            >
              <span className={cx('flex size-4 items-center justify-center rounded border', on ? 'border-neon-400 bg-neon-500/30' : 'border-ink-500')}>{on && '✓'}</span>
              <span className="size-2.5 rounded-full" style={{ background: role.color ?? 'var(--color-fog-500)' }} />
              {role.name}
            </button>
          );
        })}
      </>
    );
  } else if (panel === 'castigo' && view) {
    content = (
      <>
        <Item icon={<ChevronLeft className="size-4" />} onSelect={() => setPanel('principal')}>Voltar</Item>
        <Heading>Castigo para {name}</Heading>
        {[
          [5, '5 minutos'],
          [60, '1 hora'],
          [24 * 60, '1 dia'],
          [7 * 24 * 60, '1 semana'],
          [0, 'Tirar do castigo'],
        ].map(([minutes, label]) => (
          <Item key={label} icon={<Clock className="size-4" />} onSelect={close(() => void act(() => groups.change('POST', `/api/groups/${view.group.id}/members/${userId}/timeout`, { minutes }), minutes ? `Castigo de ${label} aplicado.` : 'Castigo retirado.'))}>
            {label}
          </Item>
        ))}
      </>
    );
  } else {
    content = (
      <>
        <Item icon={<UserRound className="size-4" />} onSelect={() => onProfile(new DOMRect(x, y, 0, 0))} testId="menu-profile">Ver perfil</Item>
        {!self && member && (
          <Item icon={<AtSign className="size-4" />} onSelect={close(() => window.dispatchEvent(new CustomEvent('cn:mention', { detail: member.username })))} testId="menu-mention">
            Mencionar
          </Item>
        )}
        {!self && (
          <>
            <Item icon={<MessageSquare className="size-4" />} onSelect={close(() => void startDm(userId))} testId="menu-message" disabled={profile ? !profile.canMessage : false}>
              Enviar mensagem
            </Item>
            {friendship === 'amigos' ? (
              <Item icon={<UserMinus className="size-4" />} onSelect={close(() => void dialogs.confirm({ title: `Desfazer a amizade com ${name}?`, confirmLabel: 'Desfazer amizade', tone: 'perigo', action: () => social.removeFriend(userId) }))} testId="menu-unfriend">
                Remover amizade
              </Item>
            ) : friendship === 'recebida' ? (
              <Item icon={<UserCheck className="size-4" />} onSelect={close(() => void act(() => social.acceptFriend(userId), 'Agora vocês são amigos.'))} testId="menu-accept">
                Aceitar pedido de amizade
              </Item>
            ) : friendship === 'enviada' ? (
              <Item icon={<Clock className="size-4" />} onSelect={close(() => void act(() => social.removeFriend(userId), 'Pedido cancelado.'))} testId="menu-cancel-request">
                Cancelar pedido de amizade
              </Item>
            ) : (
              <Item icon={<UserPlus className="size-4" />} onSelect={close(() => void act(() => social.requestFriend({ userId }), 'Pedido de amizade enviado.'))} testId="menu-add-friend" disabled={profile?.bot}>
                Adicionar como amigo
              </Item>
            )}
            <Item icon={<NotebookPen className="size-4" />} onSelect={close(() => editNote(userId, name))} testId="menu-note">Nota pessoal</Item>
            <Item icon={<Tag className="size-4" />} onSelect={close(() => editNickname(userId, name))} testId="menu-nickname">Apelido pessoal</Item>
          </>
        )}
        {voice && !self && <CallSection session={voice.session} userId={userId} name={name} onClose={onClose} />}
        <Separator />
        <Item icon={<Copy className="size-4" />} onSelect={close(() => void copyText(userId).then((done) => groups.notify(done ? 'ID copiado.' : 'Não foi possível copiar.')))} testId="menu-copy-id">
          Copiar ID do usuário
        </Item>
        {view && member && !self && above && (
          <>
            <Separator />
            <Heading>Moderação</Heading>
            {voiceChannel && has(voicePerms, P.MUTE_MEMBERS) && <Item icon={<MicOff className="size-4" />} onSelect={close(() => void moderate('mute'))} testId="menu-mod-mute">Silenciar na chamada</Item>}
            {voiceChannel && has(voicePerms, P.BLOCK_SPEAK) && (
              <>
                <Item icon={<Ban className="size-4" />} onSelect={close(() => void moderate('block'))} testId="menu-mod-block">Impedir de falar</Item>
                <Item icon={<Volume2 className="size-4" />} onSelect={close(() => void moderate('unblock'))} testId="menu-mod-unblock">Remover silenciamento administrativo</Item>
              </>
            )}
            {voiceChannel && has(voicePerms, P.MOVE_MEMBERS) && (
              <>
                <Item icon={<MoveRight className="size-4" />} onSelect={() => setPanel('mover')} testId="menu-move" hint="▸">Mover para</Item>
                <Item icon={<LogOut className="size-4" />} onSelect={close(() => void moderate('disconnect'))} testId="menu-mod-disconnect">Desconectar da chamada</Item>
              </>
            )}
            {has(view.me.permissions, P.MANAGE_ROLES) && <Item icon={<Shield className="size-4" />} onSelect={() => setPanel('cargos')} testId="menu-roles" hint="▸">Cargos</Item>}
            {has(view.me.permissions, P.KICK_MEMBERS) && <Item icon={<Clock className="size-4" />} onSelect={() => setPanel('castigo')} testId="menu-timeout" hint="▸">Castigo</Item>}
            {has(view.me.permissions, P.KICK_MEMBERS) && (
              <Item
                icon={<UserX className="size-4" />}
                danger
                onSelect={close(() => void dialogs.confirm({ title: `Expulsar ${name}?`, message: 'A pessoa sai do grupo agora e pode voltar com um convite.', confirmLabel: 'Expulsar', tone: 'perigo', action: () => groups.change('POST', `/api/groups/${view.group.id}/members/${userId}/kick`, {}) }))}
                testId="menu-kick"
              >
                Expulsar do grupo
              </Item>
            )}
            {has(view.me.permissions, P.BAN_MEMBERS) && (
              <Item
                icon={<Gavel className="size-4" />}
                danger
                onSelect={close(() => void dialogs.prompt({ title: `Banir ${name}?`, message: 'A pessoa não volta nem com convite, até alguém desfazer o banimento.', label: 'Motivo (opcional, aparece na auditoria)', maxLength: 300, confirmLabel: 'Banir', tone: 'perigo', action: (reason) => groups.change('POST', `/api/groups/${view.group.id}/members/${userId}/ban`, { reason }) }))}
                testId="menu-ban"
              >
                Banir do grupo
              </Item>
            )}
          </>
        )}
        {view && member && !self && canModerate(view) && <Item icon={<ShieldCheck className="size-4" />} onSelect={close(onModerate)} testId="menu-moderate">Abrir como moderador</Item>}
        {!self && (
          <>
            <Separator />
            {profile?.blocked ? (
              <Item icon={<Ban className="size-4" />} onSelect={close(() => void act(() => social.unblock(userId), 'Desbloqueado.'))} testId="menu-unblock">Desbloquear</Item>
            ) : (
              <Item icon={<Ban className="size-4" />} danger onSelect={close(() => void dialogs.confirm({ title: `Bloquear ${name}?`, message: 'Vocês deixam de ser amigos e nenhum dos dois consegue mandar mensagem privada ou pedido de amizade para o outro.', confirmLabel: 'Bloquear', tone: 'perigo', action: () => social.block(userId) }))} testId="menu-block">
                Bloquear
              </Item>
            )}
          </>
        )}
      </>
    );
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`Ações para ${name}`}
      className="fixed z-[70] max-h-[85vh] w-64 animate-fade overflow-y-auto rounded-xl border border-brand-400/50 bg-ink-900/98 p-1 shadow-glow backdrop-blur"
      style={position}
      onKeyDown={keyNav}
      onContextMenu={(event) => event.preventDefault()}
      data-testid="user-menu"
      data-user={userId}
    >
      {content}
    </div>,
    document.body,
  );
}

/** Envolve qualquer coisa que representa uma pessoa (avatar, nome, linha da lista). */
export function UserTrigger({ userId, className, children, testId }: { userId: string | null | undefined; className?: string; children: ReactNode; testId?: string }) {
  const triggers = useUserTriggers(userId);
  return (
    <span className={cx(className, 'onClick' in triggers && 'cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-neon-400')} {...triggers} data-testid={testId}>
      {children}
    </span>
  );
}

/** Para listas que já têm o próprio botão: abre o menu de alguém pelo teclado ou por um botão "…". */
export function useOpenUserMenu() {
  const ctx = useContext(InteractionsContext);
  return useCallback((userId: string, x: number, y: number) => ctx?.openMenu(userId, x, y), [ctx]);
}

/** Volume, "silenciar só para mim" e assistir: só para quem está na mesma chamada desta conta. */
function CallSection({ session, userId, name, onClose }: { session: RoomSession; userId: string; name: string; onClose: () => void }) {
  const participants = useStore(session.store, (state) => state.participants);
  const muted = useStore(session.store, (state) => state.localMutes[userId] === true);
  const person = participants.find((item) => item.identity === userId);
  if (!person) return null;
  return (
    <>
      <Separator />
      <Heading>Na chamada</Heading>
      <PersonVolume session={session} volumeKey={`voz:${userId}`} name={name} className="px-2.5 py-1" />
      <Item icon={muted ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} onSelect={() => session.setLocalMute(userId, !muted)} testId="menu-local-mute">
        {muted ? 'Voltar a ouvir' : 'Silenciar só para mim'}
      </Item>
      {person.sharing && (
        <Item
          icon={<Eye className="size-4" />}
          onSelect={() => {
            onClose();
            session.select(userId);
          }}
          testId="menu-watch"
        >
          Assistir transmissão
        </Item>
      )}
    </>
  );
}

/** Jogo atual e jogos do perfil, se a pessoa deixar quem está vendo ver (Configurações → Jogos e atividades). */
function ProfileActivity({ userId }: { userId: string }) {
  const [data, setData] = useState<{ activity: CurrentActivity | null; games: { name: string; icon: string | null }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    void activities
      .forProfile(userId)
      .then((result) => alive && setData(result))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId]);
  if (!data || (!data.activity && data.games.length === 0)) return null;
  return (
    <div className="mt-3 grid gap-2" data-testid="profile-activity">
      {data.activity && (
        <div className="flex items-center gap-2.5 rounded-xl bg-ink-900/70 p-2">
          <GameIcon icon={data.activity.icon} size={36} />
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold tracking-wide text-fog-500 uppercase">Jogando</p>
            <p className="truncate text-sm font-bold" data-testid="profile-playing">{data.activity.name}</p>
            <p className="text-xs text-fog-500">{playingFor(data.activity.startedAt)}</p>
          </div>
        </div>
      )}
      {data.games.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid="profile-games">
          {data.games.map((game) => (
            <span key={game.name} className="flex items-center gap-1.5 rounded-md border border-ink-600 px-1.5 py-0.5 text-xs font-semibold">
              <GameIcon icon={game.icon} size={16} />
              {game.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
