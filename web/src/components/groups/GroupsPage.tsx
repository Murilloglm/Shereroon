import { ArrowLeft, AudioLines, Bell, BellOff, ChevronDown, ChevronRight, Compass, Crown, FolderPlus, Hash, Link2, Lock, MessageSquare, MicOff, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, PhoneOff, Plus, Settings, UserPlus, Users, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { has, P } from '../../../../shared/permissions.ts';
import { navigate } from '../../App.tsx';
import { copyText } from '../../lib/format.ts';
import { channelLink, moveToVoice } from '../../lib/groups/actions.ts';
import { alertIncoming } from '../../lib/groups/alerts.ts';
import { groups, type ChannelKind, type ChannelView, type GroupView, type MemberView, type NotifyLevel } from '../../lib/groups/client.ts';
import { dialogs } from '../../lib/dialogs.ts';
import type { ParticipantView, RoomSession } from '../../lib/session.ts';
import { storage } from '../../lib/storage.ts';
import { useStore } from '../../lib/store.ts';
import { RoomView } from '../room/RoomView.tsx';
import { StreamHover } from '../room/StreamHover.tsx';
import { UserInteractions, UserTrigger } from '../social/UserInteractions.tsx';
import { DmChat, FriendsHome, SocialSidebar } from '../social/Messages.tsx';
import { social } from '../../lib/social/client.ts';
import { AppLinks, inviteValidity, type InvitePreview } from './InviteCard.tsx';
import { Avatar, Button, Card, cx, IconButton, Logo, LogoMark, Menu, MenuItem, MenuLabel, Modal, Notice, TextInput, Toast, Toggle } from '../ui.tsx';
import { AuthPage } from './AuthPage.tsx';
import { Chat, NOTIFY_LABELS } from './Chat.tsx';
import { can, fieldLabel, groupHash, GroupIcon, memberName, nameColor, topRole, useAction } from './common.tsx';
import { usePanel } from './panels.tsx';
import { CreateChannelModal } from './settings/ChannelsTab.tsx';
import { extractGroupInvite, groupInviteLink, GroupSettings, type SettingsTab } from './settings/GroupSettings.tsx';
import { UserPanel } from './UserPanel.tsx';
import { useVoice, VoiceLobby, VoicePeople, type VoiceState } from './Voice.tsx';

const WIDE = '(min-width: 1024px)';
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(WIDE).matches,
  );
}

type ModalState =
  | null
  | { type: 'criar-grupo' }
  | { type: 'entrar'; code?: string }
  | { type: 'config'; tab: SettingsTab }
  | { type: 'canal'; kind: ChannelKind; parentId: string | null }
  | { type: 'convidar' }
  | { type: 'membros' };

/** Troca de rota sem deixar um passo a mais no "voltar" do navegador. */
const redirect = (hash: string) => window.location.replace(hash);

function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setPublic] = useState(false);
  const { busy, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { group } = await groups.call('POST', '/api/groups', { name, description, isPublic });
      await groups.refreshGroups();
      onClose();
      navigate(groupHash(group.id));
    });
  };
  return (
    <Modal title="Criar um grupo" onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit} data-testid="create-group">
        <label className={fieldLabel}>
          Nome do grupo
          <TextInput value={name} maxLength={48} required autoFocus onChange={(event) => setName(event.target.value)} data-testid="group-name" />
        </label>
        <label className={fieldLabel}>
          Descrição (opcional)
          <TextInput value={description} maxLength={300} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Grupo público</p>
            <p className="text-[13px] leading-snug text-fog-400">Qualquer conta encontra e entra. Desligado, só por convite.</p>
          </div>
          <Toggle on={isPublic} label="Grupo público" onChange={setPublic} />
        </div>
        <p className="text-[13px] leading-snug text-fog-500">O grupo já nasce com um canal de texto, um canal de voz e os cargos Administrador e Moderador, que você pode mudar depois.</p>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()} data-testid="group-create">
          {busy ? 'Criando…' : 'Criar grupo'}
        </Button>
      </form>
    </Modal>
  );
}

function JoinGroupModal({ code, onClose }: { code?: string; onClose: () => void }) {
  const [mode, setMode] = useState<'convite' | 'publicos'>('convite');
  const [text, setText] = useState(code ?? '');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<any[] | null>(null);
  const { busy, run } = useAction();

  const look = useCallback(
    (value: string) => {
      const parsed = extractGroupInvite(value);
      if (!parsed) return groups.notify('Cole o link de convite inteiro ou só o código.');
      void run(async () => {
        const result = await groups.call('GET', `/api/invites/${parsed}`);
        setPreview({ ...result, code: parsed });
      });
    },
    [run],
  );
  useEffect(() => {
    if (code) look(code);
  }, [code, look]);
  useEffect(() => {
    if (mode !== 'publicos') return;
    const timer = setTimeout(() => void run(async () => setFound((await groups.call('GET', `/api/groups/public?q=${encodeURIComponent(search)}`)).groups)), 250);
    return () => clearTimeout(timer);
  }, [mode, search, run]);

  const entered = async (groupId: string) => {
    await groups.refreshGroups();
    onClose();
    navigate(groupHash(groupId));
  };

  return (
    <Modal title="Entrar em um grupo" onClose={onClose}>
      <div className="grid gap-4" data-testid="join-group">
        <div className="grid grid-cols-2 gap-2">
          {(['convite', 'publicos'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              data-testid={`join-tab-${value}`}
              onClick={() => setMode(value)}
              className={cx('h-10 rounded-xl border text-sm font-bold', mode === value ? 'border-brand-300 bg-brand-500/25 text-white' : 'border-ink-600 bg-ink-800 text-fog-300 hover:border-ink-500')}
            >
              {value === 'convite' ? 'Tenho um convite' : 'Grupos públicos'}
            </button>
          ))}
        </div>
        {mode === 'convite' ? (
          <>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                look(text);
              }}
            >
              <TextInput aria-label="Link ou código do convite" placeholder="Cole o link ou o código do convite" value={text} onChange={(event) => setText(event.target.value)} className="min-w-0 flex-1" data-testid="join-code" />
              <Button type="submit" disabled={busy || !text.trim()}>
                Ver
              </Button>
            </form>
            {preview && (
              <Card className="flex items-center gap-3 p-3" data-testid="join-preview">
                <GroupIcon group={preview.group} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold">{preview.group.name}</p>
                  <p className="truncate text-sm text-fog-400">
                    {preview.group.memberCount} {preview.group.memberCount === 1 ? 'membro' : 'membros'}
                    {preview.group.description && ` • ${preview.group.description}`}
                  </p>
                  {inviteValidity(preview.invite) && (
                    <p className="truncate text-xs text-fog-500" data-testid="invite-validity">
                      Convite: {inviteValidity(preview.invite)}
                    </p>
                  )}
                </div>
                <Button
                  variant="primary"
                  disabled={busy}
                  data-testid="join-accept"
                  onClick={() => void run(async () => entered((await groups.call('POST', `/api/invites/${preview.code}/accept`)).group.id))}
                >
                  {preview.joined ? 'Abrir' : 'Entrar'}
                </Button>
              </Card>
            )}
            {preview && !preview.joined && <AppLinks code={preview.code} />}
          </>
        ) : (
          <>
            <TextInput aria-label="Procurar grupos públicos" placeholder="Procurar por nome ou descrição" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="join-search" />
            <ul className="grid max-h-80 gap-2 overflow-y-auto">
              {found?.map((group) => (
                <li key={group.id} className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-800/40 p-2.5" data-testid="public-group">
                  <GroupIcon group={group} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{group.name}</p>
                    <p className="truncate text-sm text-fog-400">
                      {group.memberCount} {group.memberCount === 1 ? 'membro' : 'membros'}
                      {group.description && ` • ${group.description}`}
                    </p>
                  </div>
                  <Button size="sm" variant={group.joined ? 'quiet' : 'primary'} disabled={busy} onClick={() => void run(async () => (group.joined || (await groups.call('POST', `/api/groups/${group.id}/join`)), entered(group.id)))}>
                    {group.joined ? 'Abrir' : 'Entrar'}
                  </Button>
                </li>
              ))}
              {found?.length === 0 && <li className="py-4 text-center text-sm text-fog-400">Nenhum grupo público encontrado.</li>}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

function InviteModal({ view, onClose }: { view: GroupView; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const { run } = useAction();
  useEffect(() => {
    void run(async () => setLink(groupInviteLink((await groups.call('POST', `/api/groups/${view.group.id}/invites`, { expiresInHours: 168 })).invite.code)));
  }, [view.group.id, run]);
  return (
    <Modal title={`Convidar para ${view.group.name}`} onClose={onClose}>
      <div className="grid gap-3" data-testid="invite-modal">
        <p className="text-sm text-fog-400">Mande este link. Quem abrir entra no grupo depois de entrar na própria conta. Vale por 7 dias.</p>
        <div className="flex gap-2">
          <TextInput readOnly aria-label="Link de convite do grupo" value={link ?? 'Gerando…'} className="min-w-0 flex-1" onFocus={(event) => event.target.select()} data-testid="group-invite-link" />
          <Button variant="primary" disabled={!link} onClick={() => link && void copyText(link).then((done) => groups.notify(done ? 'Link copiado.' : 'Selecione e copie o link.'))}>
            Copiar
          </Button>
        </div>
        <p className="text-xs text-fog-500">Para escolher validade e número de usos, ou revogar convites, use Configurações → Convites.</p>
      </div>
    </Modal>
  );
}

/** Novidade de um canal para esta conta, já descontado o que ela silenciou. */
function unreadOf(view: GroupView, channelId: string): { unread: boolean; mentions: number; muted: boolean; count: number } {
  const state = view.unread[channelId];
  const muted = (view.notify.channels[channelId] ?? view.notify.level) === 'nada';
  const unread = !muted && state !== undefined && Number(state.last ?? 0) > Number(state.read ?? 0);
  return { muted, mentions: muted ? 0 : (state?.mentions ?? 0), unread, count: unread ? (state?.count ?? 0) : 0 };
}

/** Membros agrupados como no restante do app: dono, depois cada cargo (do mais alto ao mais baixo), online sem cargo e offline. */
function MemberList({ view, className }: { view: GroupView; className?: string }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const inVoice = new Set(Object.values(view.voice).flat());
  const byName = (a: MemberView, b: MemberView) => memberName(a).localeCompare(memberName(b));
  // Bots: junto dos membros, numa categoria própria ou fora da lista (só aparência; dá para abrir no fim).
  const [showHidden, setShowHidden] = useState(false);
  const hiddenBots = view.members.filter((member) => member.bot && member.botList === 'ocultar').sort(byName);
  const categorized = view.members.filter((member) => member.bot && (member.botList ?? 'categoria') === 'categoria').sort(byName);
  const listed = view.members.filter((member) => !member.bot || member.botList === 'mostrar');
  const online = listed.filter((member) => member.online).sort(byName);
  const owner = online.filter((member) => member.userId === view.group.ownerId);
  const rest = online.filter((member) => member.userId !== view.group.ownerId);
  const sections: { id: string; title: string; color?: string; icon?: ReactNode; members: MemberView[] }[] = [
    { id: 'dono', title: 'Dono', color: 'var(--color-warn-400)', icon: <Crown className="size-3.5" aria-hidden="true" />, members: owner },
    ...view.roles
      .filter((role) => !role.isEveryone)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({ id: role.id, title: role.name, color: role.color ?? undefined, members: rest.filter((member) => topRole(view, member)?.id === role.id) })),
    { id: 'online', title: 'Online', members: rest.filter((member) => !topRole(view, member)) },
    { id: 'offline', title: 'Offline', members: listed.filter((member) => !member.online).sort(byName) },
    { id: 'bots', title: 'Bots', members: categorized },
    ...(showHidden ? [{ id: 'ocultos', title: 'Bots fora da lista', members: hiddenBots }] : []),
  ];
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <aside className={cx('min-h-0 overflow-y-auto p-2.5', className)} data-testid="member-list">
      <h2 className="px-2 pt-1 pb-2 text-[15px] font-extrabold">Membros — {view.members.length}</h2>
      {sections.map(
        (section) =>
          section.members.length > 0 && (
            <section key={section.id} className="mb-2">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5 text-left text-xs font-extrabold tracking-wide text-fog-400 uppercase hover:bg-white/[0.06]"
                style={{ color: section.color }}
                aria-expanded={!collapsed.has(section.id)}
                onClick={() => toggle(section.id)}
                data-testid="member-section"
                data-section={section.title}
              >
                <ChevronRight className={cx('size-3.5 shrink-0 transition-transform', !collapsed.has(section.id) && 'rotate-90')} aria-hidden="true" />
                {section.icon}
                <span className="min-w-0 flex-1 truncate">
                  {section.title} — {section.members.length}
                </span>
              </button>
              {!collapsed.has(section.id) && (
                <ul className="mt-1 grid gap-0.5">
                  {section.members.map((member) => {
                    const role = topRole(view, member);
                    const status = !member.online ? 'Offline' : inVoice.has(member.userId) ? 'Em chamada' : 'Online';
                    return (
                      <li key={member.userId} className={cx('rounded-lg hover:bg-white/5', !member.online && 'opacity-50')} data-testid="member" data-user={member.username} data-online={member.online}>
                        <UserTrigger userId={member.userId} className="flex items-center gap-2.5 px-2 py-1.5">
                        <Avatar id={member.userId} name={memberName(member)} size={34} online={member.online} image={member.avatar} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1 truncate text-sm font-bold text-neon-300" style={{ color: nameColor(view, member) }}>
                            <span className="truncate" data-testid="member-name">
                              {memberName(member)}
                            </span>
                            {member.userId === view.group.ownerId && <Crown className="size-3.5 shrink-0 text-warn-400" aria-label="Dono do grupo" />}
                            {member.bot && <span className="shrink-0 rounded bg-brand-500 px-1 text-[10px] leading-4 font-extrabold text-white" data-testid="member-bot-tag">BOT</span>}
                          </p>
                          <p className="flex items-center gap-1 truncate text-xs text-fog-500">
                            <span className={cx('size-1.5 shrink-0 rounded-full', !member.online ? 'bg-fog-500' : status === 'Em chamada' ? 'bg-neon-400' : 'bg-ok-400')} />
                            {role && (
                              <>
                                <span className="truncate" data-testid="member-top-role">
                                  {role.name}
                                </span>
                                <span aria-hidden="true">•</span>
                              </>
                            )}
                            <span className="shrink-0">{status}</span>
                          </p>
                        </div>
                        </UserTrigger>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ),
      )}
      {hiddenBots.length > 0 && (
        <button type="button" className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-fog-500 hover:bg-white/5 hover:text-fog-300" onClick={() => setShowHidden((value) => !value)} aria-expanded={showHidden} data-testid="hidden-bots">
          {showHidden ? 'Esconder' : 'Mostrar'} {hiddenBots.length === 1 ? '1 bot fora da lista' : `${hiddenBots.length} bots fora da lista`}
        </button>
      )}
    </aside>
  );
}

function VoiceBar({ view, voice, onLeave }: { view: GroupView | null; voice: VoiceState; onLeave: () => void }) {
  const sharing = useStore(voice.session.store, (state) => state.share.active);
  const phase = useStore(voice.session.store, (state) => state.phase);
  const channel = view?.group.id === voice.groupId ? view.channels.find((item) => item.id === voice.channelId) : undefined;
  const reconnecting = phase === 'reconnecting';
  return (
    <div className="flex items-center gap-2 border-t border-brand-500/15 bg-ok-400/[0.06] px-3 py-2" data-testid="voice-bar">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate(groupHash(voice.groupId, voice.channelId))}>
        <p className={cx('flex items-center gap-1.5 text-sm font-bold', reconnecting ? 'text-warn-400' : 'text-ok-400')}>
          <AudioLines className={cx('size-4', reconnecting && 'animate-pulse')} aria-hidden="true" />
          {reconnecting ? 'Reconectando…' : sharing ? 'Transmitindo a tela' : 'Voz conectada'}
        </p>
        <p className="truncate text-xs text-fog-400">{channel?.name ?? 'em outro grupo'}</p>
      </button>
      <IconButton label="Sair do canal de voz" className="bg-live-600/25 text-live-300 hover:bg-live-600 hover:text-white" onClick={onLeave} data-testid="voice-bar-leave">
        <PhoneOff className="size-5" />
      </IconButton>
    </div>
  );
}

/** Quem está num canal de voz. No canal em que esta conta está conectada, mostra também quem fala, microfone e transmissão. */
/** Quem está sendo arrastado de um canal de voz para outro (na mesma página). */
let draggingMember: { userId: string; from: string } | null = null;
const MEMBER_DRAG = 'application/x-cosmic-member';

function VoicePeopleRows({ people, session, channel }: { people: MemberView[]; session: RoomSession | null; channel: ChannelView }) {
  return session ? <LiveVoicePeople people={people} session={session} channel={channel} /> : <VoicePeopleList people={people} live={new Map()} session={null} channel={channel} />;
}

function LiveVoicePeople({ people, session, channel }: { people: MemberView[]; session: RoomSession; channel: ChannelView }) {
  const participants = useStore(session.store, (state) => state.participants);
  return <VoicePeopleList people={people} live={new Map(participants.map((participant) => [participant.identity, participant]))} session={session} channel={channel} />;
}

function VoicePeopleList({ people, live, session, channel }: { people: MemberView[]; live: Map<string, ParticipantView>; session: RoomSession | null; channel: ChannelView }) {
  // Quem pode mover participantes deste canal arrasta a pessoa até outro canal de voz.
  const canMove = has(channel.permissions, P.MOVE_MEMBERS);
  return (
    <ul className="mt-0.5 mb-1 ml-7 grid gap-0.5" data-testid="channel-voice-people">
      {people.map((member) => {
        const state = live.get(member.userId);
        return (
          <li
            key={member.userId}
            className={cx('flex items-center gap-2 rounded-md py-0.5 text-sm text-fog-300', canMove && 'cursor-grab active:cursor-grabbing')}
            data-user={member.username}
            data-speaking={state?.speaking === true}
            draggable={canMove}
            onDragStart={(event) => {
              if (!canMove) return;
              draggingMember = { userId: member.userId, from: channel.id };
              event.dataTransfer.setData(MEMBER_DRAG, member.userId);
              event.dataTransfer.effectAllowed = 'move';
              event.stopPropagation();
            }}
            onDragEnd={() => {
              draggingMember = null;
            }}
            data-testid="voice-member"
          >
            {session ? (
              <StreamHover session={session} identity={member.userId} name={memberName(member)} enabled={state?.sharing === true} className="flex min-w-0 flex-1 items-center gap-2">
                <UserTrigger userId={member.userId} className="flex min-w-0 flex-1 items-center gap-2">
                  <Avatar id={member.userId} name={memberName(member)} size={22} speaking={state?.speaking} image={member.avatar} />
                  <span className={cx('min-w-0 flex-1 truncate', state?.speaking && 'text-white')}>{memberName(member)}</span>
                </UserTrigger>
              </StreamHover>
            ) : (
              <UserTrigger userId={member.userId} className="flex min-w-0 flex-1 items-center gap-2">
                <Avatar id={member.userId} name={memberName(member)} size={22} speaking={state?.speaking} image={member.avatar} />
                <span className={cx('min-w-0 flex-1 truncate', state?.speaking && 'text-white')}>{memberName(member)}</span>
              </UserTrigger>
            )}
            {state?.sharing && <span className="shrink-0 rounded bg-live-500 px-1 text-[10px] font-extrabold text-white">AO VIVO</span>}
            {state && !state.micOn && <MicOff className="size-3.5 shrink-0 text-fog-500" aria-label="Microfone desligado" />}
          </li>
        );
      })}
    </ul>
  );
}

function ChannelList({ view, selected, voice, onPick, onModal, onOpenChat }: {
  view: GroupView;
  selected: string | undefined;
  voice: VoiceState | null;
  onPick: (channel: ChannelView) => void;
  onModal: (modal: ModalState) => void;
  onOpenChat: (channel: ChannelView) => void;
}) {
  const [memberOver, setMemberOver] = useState<{ channelId: string; allowed: boolean } | null>(null);
  const { run } = useAction();
  const collapsedKey = `shareroom:categorias:${view.group.id}`;
  const [collapsed, setCollapsed] = useState<string[]>(() => storage.get<string[]>(collapsedKey, []));
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const byPosition = (a: ChannelView, b: ChannelView) => a.position - b.position || a.name.localeCompare(b.name);
  const categories = view.channels.filter((channel) => channel.kind === 'categoria').sort(byPosition);
  const childrenOf = (parentId: string | null) => view.channels.filter((channel) => channel.kind !== 'categoria' && channel.parentId === parentId).sort(byPosition);
  const manage = can(view, P.MANAGE_CHANNELS);
  const online = view.members.filter((member) => member.online).length;
  const dragged = drag ? view.channels.find((channel) => channel.id === drag) : undefined;

  const toggleCategory = (id: string) =>
    setCollapsed((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      storage.set(collapsedKey, next);
      return next;
    });

  /** Solta o canal arrastado antes de `before`, ou no fim da categoria `into`. O backend confere a permissão. */
  const drop = (target: { before?: ChannelView; into?: string | null }) => {
    setOver(null);
    setDrag(null);
    if (!dragged || dragged.id === target.before?.id) return;
    let items: { id: string; position: number; parentId?: string | null }[];
    if (dragged.kind === 'categoria') {
      if (target.before?.kind !== 'categoria') return;
      const order = categories.filter((item) => item.id !== dragged.id);
      order.splice(order.findIndex((item) => item.id === target.before!.id), 0, dragged);
      items = order.map((item, position) => ({ id: item.id, position }));
    } else {
      const parentId = target.before && target.before.kind !== 'categoria' ? target.before.parentId : (target.into ?? null);
      const siblings = childrenOf(parentId).filter((item) => item.id !== dragged.id);
      const at = target.before && target.before.kind !== 'categoria' ? siblings.findIndex((item) => item.id === target.before!.id) : -1;
      siblings.splice(at < 0 ? siblings.length : at, 0, dragged);
      items = siblings.map((item, position) => ({ id: item.id, position, parentId }));
    }
    void run(() => groups.change('PUT', `/api/groups/${view.group.id}/channels/order`, { items }));
  };

  const dragProps = (channel: ChannelView, target: { before?: ChannelView; into?: string | null }) =>
    manage
      ? {
          draggable: true,
          onDragStart: (event: DragEvent<HTMLElement>) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', channel.name);
            setDrag(channel.id);
          },
          onDragEnd: () => {
            setDrag(null);
            setOver(null);
          },
          onDragOver: (event: DragEvent<HTMLElement>) => {
            if (!dragged || dragged.id === channel.id || (dragged.kind === 'categoria' && channel.kind !== 'categoria')) return;
            event.preventDefault();
            event.stopPropagation();
            setOver(channel.id);
          },
          onDrop: (event: DragEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            drop(target);
          },
        }
      : {};

  const row = (channel: ChannelView) => {
    const inside = (view.voice[channel.id] ?? []).map((userId) => view.members.find((member) => member.userId === userId)).filter((member) => member !== undefined);
    const Icon = channel.private ? Lock : channel.kind === 'voz' ? Volume2 : Hash;
    const news = unreadOf(view, channel.id);
    // Soltar alguém arrastado aqui: só em canal de voz diferente, onde quem move pode conectar.
    const dropAllowed = (from: string | undefined) => channel.kind === 'voz' && from !== undefined && from !== channel.id && has(channel.permissions, P.CONNECT);
    const memberHere = memberOver?.channelId === channel.id ? memberOver : null;
    const memberDrop =
      channel.kind === 'voz'
        ? {
            onDragOver: (event: DragEvent<HTMLElement>) => {
              if (!event.dataTransfer.types.includes(MEMBER_DRAG)) return;
              event.stopPropagation();
              const allowed = dropAllowed(draggingMember?.from);
              if (allowed) event.preventDefault();
              event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
              if (memberOver?.channelId !== channel.id || memberOver.allowed !== allowed) setMemberOver({ channelId: channel.id, allowed });
            },
            onDragLeave: () => setMemberOver((current) => (current?.channelId === channel.id ? null : current)),
            onDrop: (event: DragEvent<HTMLElement>) => {
              if (!event.dataTransfer.types.includes(MEMBER_DRAG)) return;
              event.preventDefault();
              event.stopPropagation();
              setMemberOver(null);
              const dragged = draggingMember;
              draggingMember = null;
              if (!dragged || !dropAllowed(dragged.from)) {
                groups.notify('Você não pode mover para este canal.');
                return;
              }
              void moveToVoice(view, dragged.from, dragged.userId, channel.id);
            },
          }
        : {};
    const active = selected === channel.id;
    const connected = voice?.channelId === channel.id;
    return (
      <li key={channel.id} className={cx('relative', over === channel.id && 'shadow-[0_-2px_0_var(--color-neon-400)]', drag === channel.id && 'opacity-40')} data-testid="channel-item" data-unread={news.unread} data-mentions={news.mentions} {...dragProps(channel, { before: channel })}>
        {news.unread && !active && <span className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-white" aria-hidden="true" />}
        <div
          className={cx(
            'group/row flex items-center rounded-lg border border-transparent transition-colors',
            active ? 'cn-selected text-white' : connected ? 'bg-ok-400/10' : 'hover:bg-white/5',
            memberHere?.allowed && 'border-neon-400 bg-neon-500/15',
            memberHere && !memberHere.allowed && 'border-live-400/70 bg-live-500/10',
          )}
          data-drop={memberHere ? (memberHere.allowed ? 'pode' : 'nao-pode') : undefined}
          {...memberDrop}
        >
          <button
            type="button"
            onClick={() => onPick(channel)}
            data-testid="channel"
            data-kind={channel.kind}
            data-name={channel.name}
            aria-current={active}
            className={cx(
              'flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[15px] font-semibold',
              active ? 'text-white' : news.unread ? 'text-white' : news.muted ? 'text-fog-500' : 'text-fog-300 hover:text-fog-100',
            )}
          >
            <Icon className={cx('size-4 shrink-0', active ? 'text-brand-200' : 'text-fog-500')} aria-hidden="true" />
            <span className="truncate">{channel.name}</span>
          </button>
          {news.mentions > 0 && (
            <span className="mr-2 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 px-1.5 text-xs font-extrabold text-white shadow-glow" data-testid="channel-mentions" aria-label={`${news.mentions} menções`}>
              {news.mentions > 99 ? '99+' : news.mentions}
            </span>
          )}
          {news.mentions === 0 && news.count > 0 && !active && (
            <span className="mr-2 shrink-0 text-xs font-bold text-fog-400 tabular-nums" data-testid="channel-unread-count" aria-label={`${news.count} mensagens novas`}>
              {news.count >= 100 ? '99+' : news.count}
            </span>
          )}
          {news.muted && <BellOff className="mr-2 size-3.5 shrink-0 text-fog-500" aria-label="Canal silenciado" />}
          {memberHere && !memberHere.allowed && <span className="mr-2 shrink-0 text-xs font-bold text-live-300">Sem permissão</span>}
          {channel.kind === 'voz' && (
            <span className="mr-1 hidden shrink-0 items-center group-focus-within/row:flex group-hover/row:flex" data-testid="voice-channel-actions">
              <IconButton label={`Abrir o chat de ${channel.name}`} className="size-7" onClick={() => onOpenChat(channel)} data-testid="voice-channel-chat">
                <MessageSquare className="size-3.5" />
              </IconButton>
              <IconButton
                label={`Copiar o link de ${channel.name}`}
                className="size-7"
                onClick={() => void copyText(channelLink(view.group.id, channel.id)).then((done) => groups.notify(done ? 'Link do canal copiado.' : 'Não foi possível copiar.'))}
                data-testid="voice-channel-link"
              >
                <Link2 className="size-3.5" />
              </IconButton>
              {manage && (
                <IconButton label={`Editar ${channel.name}`} className="size-7" onClick={() => onModal({ type: 'config', tab: 'canais' })} data-testid="voice-channel-edit">
                  <Settings className="size-3.5" />
                </IconButton>
              )}
            </span>
          )}
          {channel.kind === 'voz' && (inside.length > 0 || channel.userLimit > 0) && (
            <span className="mr-2 shrink-0 text-xs text-fog-500 group-focus-within/row:hidden group-hover/row:hidden">
              {inside.length}
              {channel.userLimit > 0 && `/${channel.userLimit}`}
            </span>
          )}
        </div>
        {inside.length > 0 && <VoicePeopleRows people={inside} session={connected ? voice.session : null} channel={channel} />}
      </li>
    );
  };

  const level = view.notify.level;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Menu
        side="bottom"
        trigger={({ toggle, open }) => (
          <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 border-b border-brand-500/15 bg-linear-to-br from-brand-500/20 via-transparent to-neon-500/10 px-3.5 py-3 text-left hover:from-brand-500/30" data-testid="group-menu">
            <GroupIcon group={view.group} size={42} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] leading-tight font-extrabold" data-testid="group-title">
                {view.group.name}
              </span>
              <span className="flex items-center gap-1.5 truncate text-xs text-fog-400">
                <span className="size-1.5 shrink-0 rounded-full bg-ok-400" />
                {online} online • {view.members.length} {view.members.length === 1 ? 'membro' : 'membros'}
              </span>
            </span>
            <ChevronDown className={cx('size-4 shrink-0 text-fog-400 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      >
        {(close) => {
          const open = (modal: ModalState) => {
            close();
            onModal(modal);
          };
          return (
            <div className="w-64">
              {can(view, P.CREATE_INVITE) && (
                <MenuItem icon={<UserPlus className="size-4" />} onClick={() => open({ type: 'convidar' })} data-testid="group-invite">
                  Convidar pessoas
                </MenuItem>
              )}
              <MenuItem icon={<Settings className="size-4" />} onClick={() => open({ type: 'config', tab: 'geral' })} data-testid="group-settings-open">
                Configurações do grupo
              </MenuItem>
              {manage && (
                <>
                  <MenuItem icon={<Plus className="size-4" />} onClick={() => open({ type: 'canal', kind: 'texto', parentId: null })} data-testid="group-new-channel">
                    Criar canal
                  </MenuItem>
                  <MenuItem icon={<FolderPlus className="size-4" />} onClick={() => open({ type: 'canal', kind: 'categoria', parentId: null })}>
                    Criar categoria
                  </MenuItem>
                </>
              )}
              <MenuItem
                onClick={() => {
                  close();
                  void dialogs.prompt({
                    title: 'Meu apelido neste grupo',
                    message: 'Deixe vazio para usar o nome da conta.',
                    label: 'Apelido',
                    defaultValue: view.members.find((member) => member.userId === view.me.userId)?.nickname ?? '',
                    maxLength: 32,
                    confirmLabel: 'Salvar',
                    action: (nickname) => groups.change('PATCH', `/api/groups/${view.group.id}/members/${view.me.userId}`, { nickname }),
                  });
                }}
              >
                Meu apelido neste grupo
              </MenuItem>
              <MenuLabel>Avisos deste grupo</MenuLabel>
              {(Object.keys(NOTIFY_LABELS) as NotifyLevel[]).map((value) => (
                <MenuItem key={value} icon={value === 'nada' ? <BellOff className="size-4" /> : <Bell className="size-4" />} selected={level === value} onClick={() => (close(), void run(() => groups.setNotify(view.group.id, value)))} data-testid={`group-notify-${value}`}>
                  {NOTIFY_LABELS[value]}
                </MenuItem>
              ))}
            </div>
          );
        }}
      </Menu>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Canais" data-testid="channel-list">
        <ul className="grid gap-0.5">{childrenOf(null).map(row)}</ul>
        {categories.map((category) => {
          const closed = collapsed.includes(category.id);
          const children = childrenOf(category.id);
          return (
            <section key={category.id} className={cx('mt-3', over === category.id && 'rounded-lg shadow-[0_0_0_1px_var(--color-neon-400)]', drag === category.id && 'opacity-40')} {...dragProps(category, dragged?.kind === 'categoria' ? { before: category } : { into: category.id })}>
              <h2 className="flex items-center gap-1 px-1 pb-1 text-xs font-extrabold tracking-wide text-fog-500 uppercase" data-testid="category" data-name={category.name}>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left uppercase hover:text-fog-100" aria-expanded={!closed} onClick={() => toggleCategory(category.id)}>
                  <ChevronRight className={cx('size-3.5 shrink-0 transition-transform', !closed && 'rotate-90')} aria-hidden="true" />
                  <span className="truncate">{category.name}</span>
                </button>
                {manage && (
                  <IconButton label={`Criar canal em ${category.name}`} className="size-6" onClick={() => onModal({ type: 'canal', kind: 'texto', parentId: category.id })}>
                    <Plus className="size-4" />
                  </IconButton>
                )}
              </h2>
              {/* Categoria recolhida ainda mostra o canal aberto, o que tem novidade e a chamada em que a pessoa está. */}
              <ul className="grid gap-0.5">{children.filter((channel) => !closed || channel.id === selected || voice?.channelId === channel.id || (channel.kind === 'texto' && unreadOf(view, channel.id).unread)).map(row)}</ul>
            </section>
          );
        })}
      </nav>
    </div>
  );
}

function Shell({ groupId, channelId, invite, dm }: { groupId?: string; channelId?: string; invite?: string; dm?: string }) {
  const account = useStore(groups.store, (state) => state.account)!;
  const list = useStore(groups.store, (state) => state.groups);
  const view = useStore(groups.store, (state) => state.view);
  const loading = useStore(groups.store, (state) => state.viewLoading);
  const live = useStore(groups.store, (state) => state.live);
  const wide = useWide();
  const [modal, setModal] = useState<ModalState>(invite ? { type: 'entrar', code: invite } : null);
  const [pane, setPane] = useState<'lista' | 'conteudo'>(channelId ? 'conteudo' : 'lista');
  const { voice, joining, join, leave } = useVoice(view);
  // O chat do canal de voz fica aberto ao lado da chamada (a escolha fica guardada neste aparelho).
  const [voiceChat, setVoiceChatState] = useState(() => storage.get<boolean>('shareroom:chat-da-chamada', true) === true);
  const setVoiceChat = (open: boolean) => {
    storage.set('shareroom:chat-da-chamada', open);
    setVoiceChatState(open);
  };
  const openedFor = useRef<string | undefined>(undefined);
  const channelsPanel = usePanel('canais', 'left', 264, 208, 420, 'a coluna de canais');
  const membersPanel = usePanel('membros', 'right', 256, 200, 400, 'a lista de membros');

  // Link de convite aberto com o site já na tela (só o endereço mudou): mostra o convite.
  useEffect(() => {
    if (invite) setModal({ type: 'entrar', code: invite });
  }, [invite]);

  useEffect(() => {
    if (!groupId) {
      groups.closeGroup();
      openedFor.current = undefined;
      // Sem grupo escolhido (e fora das mensagens privadas), abre o primeiro da lista.
      if (list[0] && !invite && !dm) redirect(groupHash(list[0].id));
      return;
    }
    if (openedFor.current === groupId) return;
    openedFor.current = groupId;
    groups.openGroup(groupId).catch(() => {
      groups.notify('Esse grupo não existe ou você não faz mais parte dele.');
      openedFor.current = undefined;
      redirect(groupHash());
    });
  }, [groupId, list, invite, dm]);

  const current = view && view.group.id === groupId ? view : null;
  const channel = current?.channels.find((item) => item.id === channelId && item.kind !== 'categoria');

  // Sem canal na rota (ou canal que sumiu): vai para o primeiro canal de texto que a pessoa vê.
  useEffect(() => {
    if (!current || channel) return;
    const first = [...current.channels].filter((item) => item.kind === 'texto').sort((a, b) => a.position - b.position)[0] ?? current.channels.find((item) => item.kind === 'voz');
    if (first) redirect(groupHash(current.group.id, first.id));
  }, [current, channel]);

  // O grupo aberto deixou de existir para esta conta (expulsão, exclusão).
  useEffect(() => {
    if (groupId && !loading && !view && openedFor.current === groupId && !list.some((group) => group.id === groupId)) {
      openedFor.current = undefined;
      redirect(groupHash());
    }
  }, [groupId, loading, view, list]);

  // Mensagem que chega de outra pessoa: notificação e som, conforme o que a conta escolheu para o canal.
  useEffect(() => {
    groups.onIncoming = (incoming) => {
      const state = groups.store.get();
      const inView = state.view?.group.id === incoming.groupId ? state.view : null;
      const author = inView?.members.find((member) => member.userId === incoming.message.author.id);
      const name = author ? memberName(author) : incoming.message.author.name;
      const where = inView?.channels.find((item) => item.id === incoming.message.channelId)?.name;
      const group = state.groups.find((item) => item.id === incoming.groupId)?.name ?? 'Cosmic Night';
      alertIncoming(incoming, {
        title: where ? `${name} em #${where}` : `${name} • ${group}`,
        watching: incoming.message.channelId === channelId && document.visibilityState === 'visible' && document.hasFocus(),
        open: () => navigate(groupHash(incoming.groupId, incoming.message.channelId)),
      });
    };
    return () => {
      groups.onIncoming = null;
    };
  }, [channelId]);

  // O título da janela mostra quantas menções esperam e se há algo não lido.
  // Mensagem privada que chega: aviso e som (menos se a conversa está aberta e em foco, ou silenciada).
  const conversations = useStore(social.store, (state) => state.conversations);
  useStore(social.store, (state) => state.notes);
  useEffect(() => {
    if (social.store.get().conversations === null) void social.loadConversations().catch(() => undefined);
    social.onIncoming = (message, conversation) => {
      if (conversation?.notify === 'nada') return;
      alertIncoming(
        { groupId: '', message: { ...message, channelId: message.dmId, mentions: [], mentionEveryone: false } as never, mentioned: true, level: 'tudo' } as never,
        {
          title: social.nameFor(message.author.id ?? '', message.author.name),
          watching: dm === message.dmId && document.visibilityState === 'visible' && document.hasFocus(),
          open: () => navigate(`#/mensagens/${message.dmId}`),
        },
      );
    };
    return () => {
      social.onIncoming = null;
    };
  }, [dm]);
  const dmUnread = (conversations ?? []).reduce((total, item) => total + (item.notify === 'nada' ? 0 : item.unread), 0);

  const pendingMentions = list.reduce((total, group) => total + (group.mentions ?? 0), 0);
  const anyUnread = list.some((group) => group.unread);
  useEffect(() => {
    const waiting = pendingMentions + dmUnread;
    document.title = `${waiting > 0 ? `(${waiting}) ` : anyUnread ? '• ' : ''}${dm ? 'Mensagens – ' : current ? `${current.group.name} – ` : ''}Cosmic Night`;
  }, [pendingMentions, anyUnread, current, dmUnread, dm]);

  // Movida para outro canal de voz (por um moderador) enquanto olhava a chamada: a tela acompanha.
  const lastVoiceChannel = useRef<string | null>(null);
  useEffect(() => {
    const now = voice?.channelId ?? null;
    // Entre sair do canal antigo e entrar no novo a conexão some por um instante: lembra o último canal real.
    if (!now) return;
    const before = lastVoiceChannel.current;
    lastVoiceChannel.current = now;
    if (before && before !== now && channelId === before && voice) redirect(groupHash(voice.groupId, now));
  }, [voice, channelId]);

  const pick = (target: ChannelView) => {
    navigate(groupHash(current!.group.id, target.id));
    setPane('conteudo');
    // Canal de voz: clicar já entra (se a pessoa pode conectar).
    if (target.kind === 'voz' && voice?.channelId !== target.id && has(target.permissions, P.CONNECT)) void join(current!.group.id, target.id);
  };

  const inThisVoice = Boolean(voice && channel && voice.channelId === channel.id);
  const voiceChannel = current && voice ? current.channels.find((item) => item.id === voice.channelId) : undefined;
  const openChat = (target: ChannelView) => {
    navigate(groupHash(current!.group.id, target.id));
    setPane('conteudo');
    setVoiceChat(true);
  };
  const voiceChatPanel = (target: ChannelView) =>
    voiceChat && has(target.permissions, P.VIEW_CHANNEL) ? (
      <aside className="flex w-[min(26rem,40%)] min-w-72 shrink-0 flex-col border-l border-brand-500/15" data-testid="voice-chat">
        <Chat key={target.id} view={current!} channel={target} />
      </aside>
    ) : null;
  const voiceChatToggle = (target: ChannelView) => {
    const news = unreadOf(current!, target.id);
    return (
      <Button
        size="sm"
        variant={voiceChat ? 'quiet' : 'outline'}
        className="absolute top-2 right-3 z-10"
        onClick={() => setVoiceChat(!voiceChat)}
        aria-pressed={voiceChat}
        data-testid="voice-chat-toggle"
      >
        <MessageSquare className="size-4" aria-hidden="true" />
        {voiceChat ? 'Fechar chat' : 'Chat da chamada'}
        {!voiceChat && news.unread && <span className="size-2 rounded-full bg-neon-300" aria-label="mensagens novas" />}
      </Button>
    );
  };
  const showContent = wide || pane === 'conteudo';
  const showList = wide || pane === 'lista';
  const showChannels = !wide || channelsPanel.open;
  const showMembers = wide && current !== null && membersPanel.open && !dm;
  const gap = <span className="w-2.5 shrink-0" aria-hidden="true" />;

  return (
    <UserInteractions view={dm ? null : current} voice={voice ? { channelId: voice.channelId, session: voice.session } : null}>
    <div className="flex h-(--app-h) overflow-hidden p-2 sm:p-2.5" data-testid="groups" data-live={live}>
      {showList && (
        <>
          <nav className="cn-panel flex w-[4.5rem] shrink-0 flex-col items-center gap-2 py-2.5" aria-label="Seus grupos" data-testid="group-rail">
            <button type="button" title="Mensagens e amigos" aria-label="Mensagens privadas e amigos" className="rounded-2xl p-0.5 transition-shadow hover:shadow-glow" onClick={() => navigate('#/mensagens')} data-testid="rail-home">
              <LogoMark size={48} />
            </button>
            <div className="relative">
              {dm && <span className="absolute top-1/2 -left-2.5 h-9 w-1 -translate-y-1/2 rounded-r-full bg-neon-400 shadow-neon" aria-hidden="true" />}
              <IconButton
                label="Mensagens privadas e amigos"
                className={cx('size-12 rounded-2xl border', dm ? 'border-neon-400 bg-neon-500/20 text-white' : 'border-brand-400/40 text-neon-300')}
                onClick={() => navigate('#/mensagens')}
                aria-current={dm ? 'page' : undefined}
                data-testid="rail-dms"
              >
                <MessageSquare className="size-5" />
              </IconButton>
              {dmUnread > 0 && (
                <span className="pointer-events-none absolute -right-1 -bottom-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-ink-900 bg-live-500 px-1 text-[11px] font-extrabold text-white" data-testid="rail-dm-unread">
                  {dmUnread > 99 ? '99+' : dmUnread}
                </span>
              )}
            </div>
            <span className="h-px w-8 bg-brand-500/30" aria-hidden="true" />
            <ul className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-1 py-0.5">
              {list.map((group) => (
                <li key={group.id} className="relative">
                  {group.id === groupId ? (
                    <span className="absolute top-1/2 -left-2.5 h-9 w-1 -translate-y-1/2 rounded-r-full bg-neon-400 shadow-neon" aria-hidden="true" />
                  ) : (
                    group.unread && <span className="absolute top-1/2 -left-2.5 h-2.5 w-1 -translate-y-1/2 rounded-r-full bg-white" aria-hidden="true" />
                  )}
                  <button type="button" title={group.name} aria-label={group.name} aria-current={group.id === groupId} onClick={() => navigate(groupHash(group.id))} data-testid="rail-group" data-name={group.name} data-unread={group.unread === true} data-mentions={group.mentions ?? 0}>
                    <GroupIcon group={group} active={group.id === groupId} />
                  </button>
                  {(group.mentions ?? 0) > 0 && (
                    <span className="pointer-events-none absolute -right-1 -bottom-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-ink-900 bg-live-500 px-1 text-[11px] font-extrabold text-white" data-testid="rail-mentions">
                      {group.mentions! > 99 ? '99+' : group.mentions}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <IconButton label="Criar um grupo" className="size-12 rounded-2xl border border-dashed border-brand-400/50 text-brand-300" onClick={() => setModal({ type: 'criar-grupo' })} data-testid="rail-create">
              <Plus className="size-5" />
            </IconButton>
            <IconButton label="Entrar em um grupo" className="size-12 rounded-2xl border border-dashed border-brand-400/50 text-brand-300" onClick={() => setModal({ type: 'entrar' })} data-testid="rail-join">
              <Compass className="size-5" />
            </IconButton>
            <IconButton label="Salas por link (sem conta)" className="size-12 rounded-2xl border border-dashed border-brand-400/50 text-brand-300" onClick={() => navigate('#/salas')} data-testid="rail-rooms">
              <Link2 className="size-5" />
            </IconButton>
            {wide && (
              <div className="mt-1 flex flex-col gap-1 border-t border-brand-500/20 pt-2">
                <IconButton label={channelsPanel.open ? 'Recolher a coluna de canais' : 'Mostrar a coluna de canais'} onClick={channelsPanel.toggle} data-testid="toggle-channels" aria-pressed={channelsPanel.open}>
                  {channelsPanel.open ? <PanelLeftClose className="size-5" /> : <PanelLeftOpen className="size-5" />}
                </IconButton>
                <IconButton label={membersPanel.open ? 'Recolher a lista de membros' : 'Mostrar a lista de membros'} onClick={membersPanel.toggle} data-testid="toggle-members-rail" aria-pressed={membersPanel.open}>
                  {membersPanel.open ? <PanelRightClose className="size-5" /> : <PanelRightOpen className="size-5" />}
                </IconButton>
              </div>
            )}
          </nav>

          {showChannels && (
            <>
              {gap}
              <div className={cx('cn-panel flex min-h-0 flex-col overflow-hidden', wide ? 'shrink-0' : 'min-w-0 flex-1')} style={wide ? { width: channelsPanel.width } : undefined} data-testid="channels-panel">
                {dm ? (
                  <SocialSidebar selected={dm} />
                ) : current ? (
                  <ChannelList view={current} selected={channelId} voice={voice} onPick={pick} onModal={setModal} onOpenChat={openChat} />
                ) : (
                  <div className="min-h-0 flex-1 p-4">
                    <Logo compact />
                    <p className="mt-4 text-sm leading-relaxed text-fog-400">
                      {list.length === 0 ? 'Você ainda não está em nenhum grupo. Crie um ou entre com um convite.' : loading ? 'Abrindo o grupo…' : 'Escolha um grupo na barra ao lado.'}
                    </p>
                    <div className="mt-4 grid gap-2">
                      <Button variant="primary" onClick={() => setModal({ type: 'criar-grupo' })}>
                        Criar um grupo
                      </Button>
                      <Button onClick={() => setModal({ type: 'entrar' })}>Entrar em um grupo</Button>
                    </div>
                  </div>
                )}
                {voice && <VoiceBar view={view} voice={voice} onLeave={() => void leave()} />}
                <UserPanel account={account} live={live} session={voice?.session ?? null} />
              </div>
            </>
          )}
        </>
      )}

      {wide && (showChannels ? channelsPanel.resizer : gap)}

      {/* A sala de voz fica montada enquanto a conexão existir, mesmo com um canal de texto na tela: assim a
          transmissão e o mixer não param quando a pessoa vai conversar por texto. */}
      <main className={cx('cn-panel min-w-0 flex-1 flex-col overflow-hidden', showContent ? 'flex' : 'hidden')}>
        {!wide && current && (
          <div className="flex shrink-0 items-center gap-2 border-b border-brand-500/15 px-2 py-1.5">
            <Button size="sm" onClick={() => setPane('lista')} data-testid="back-to-channels">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Canais
            </Button>
            <Button size="sm" className="ml-auto" onClick={() => setModal({ type: 'membros' })}>
              <Users className="size-4" aria-hidden="true" />
              Membros
            </Button>
          </div>
        )}
        {voice && (
          <div className={cx('relative min-h-0 flex-1', inThisVoice ? 'flex' : 'hidden')}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="voice-room">
              <RoomView
                session={voice.session}
                invite=""
                embedded
                onLeave={() => void leave()}
                lookup={(identity) => {
                  const member = view?.group.id === voice.groupId ? view.members.find((item) => item.userId === identity) : undefined;
                  return member ? { image: member.avatar } : undefined;
                }}
              />
            </div>
            {inThisVoice && voiceChannel && voiceChatPanel(voiceChannel)}
            {inThisVoice && voiceChannel && voiceChatToggle(voiceChannel)}
          </div>
        )}
        {dm && (dm === 'inicio' ? <FriendsHome /> : <DmChat key={dm} dmId={dm} />)}
        {!dm && !inThisVoice &&
          (current && channel ? (
            channel.kind === 'texto' ? (
              <Chat key={channel.id} view={current} channel={channel} membersOpen={membersPanel.open} onToggleMembers={wide ? membersPanel.toggle : undefined} />
            ) : (
              <div className="relative flex min-h-0 flex-1">
                <VoiceLobby view={current} channel={channel} joining={joining === channel.id} onJoin={() => void join(current.group.id, channel.id)} />
                {voiceChatPanel(channel)}
                {voiceChatToggle(channel)}
              </div>
            )
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-fog-400">
              <LogoMark size={120} className="opacity-80" />
              {loading ? 'Carregando…' : groupId ? 'Escolha um canal.' : 'Seus grupos aparecem na barra à esquerda.'}
            </div>
          ))}
      </main>

      {showMembers && current && (
        <>
          {membersPanel.resizer}
          <div className="cn-panel flex shrink-0 flex-col overflow-hidden" style={{ width: membersPanel.width }} data-testid="members-panel">
            {inThisVoice && voice ? <VoicePeople view={current} voice={voice} className="m-2 min-h-0 flex-1" /> : <MemberList view={current} className="flex-1" />}
          </div>
        </>
      )}

      {modal?.type === 'criar-grupo' && <CreateGroupModal onClose={() => setModal(null)} />}
      {modal?.type === 'entrar' && (
        <JoinGroupModal
          code={modal.code}
          onClose={() => {
            setModal(null);
            if (invite) redirect(groupHash(groupId));
          }}
        />
      )}
      {current && modal?.type === 'config' && <GroupSettings view={current} tab={modal.tab} onTab={(tab) => setModal({ type: 'config', tab })} onClose={() => setModal(null)} />}
      {current && modal?.type === 'canal' && <CreateChannelModal view={current} initial={modal} onClose={() => setModal(null)} />}
      {current && modal?.type === 'convidar' && <InviteModal view={current} onClose={() => setModal(null)} />}
      {current && modal?.type === 'membros' && (
        <Modal title="Membros" onClose={() => setModal(null)}>
          {inThisVoice && voice ? <VoicePeople view={current} voice={voice} /> : <MemberList view={current} />}
        </Modal>
      )}
    </div>
    </UserInteractions>
  );
}

/** Página dos grupos: conta, lista de grupos, canais, chat e voz. */
export function GroupsPage({ groupId, channelId, invite, dm }: { groupId?: string; channelId?: string; invite?: string; dm?: string }) {
  const status = useStore(groups.store, (state) => state.status);
  const notice = useStore(groups.store, (state) => state.notice);
  const clear = useCallback(() => groups.clearNotice(), []);

  useEffect(() => {
    void groups.start();
    document.title = 'Grupos – Cosmic Night';
  }, []);

  return (
    <>
      {status === 'verificando' && <div className="flex min-h-(--app-h) items-center justify-center text-fog-400">Conectando ao servidor…</div>}
      {status === 'indisponivel' && (
        <div className="mx-auto flex min-h-(--app-h) max-w-md flex-col justify-center gap-4 px-5">
          <Logo />
          <Notice tone="aviso" data-testid="groups-unavailable">
            Os grupos não estão disponíveis neste servidor agora. Eles precisam de um banco de dados configurado no backend. As salas por link continuam funcionando.
          </Notice>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => navigate('#/salas')}>
              Usar uma sala por link
            </Button>
            <Button onClick={() => void groups.start()}>Tentar de novo</Button>
          </div>
        </div>
      )}
      {status === 'fora' && <AuthPage invite={invite} />}
      {status === 'dentro' && <Shell groupId={groupId} channelId={channelId} invite={invite} dm={dm} />}
      <Toast message={notice} onDone={clear} />
    </>
  );
}
