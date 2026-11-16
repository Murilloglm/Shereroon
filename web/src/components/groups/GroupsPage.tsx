import { ArrowLeft, ChevronDown, Compass, Crown, FolderPlus, Hash, Home, Lock, LogOut, Mic, MicOff, PhoneOff, Plus, Settings, UserPlus, Users, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { has, P } from '../../../../shared/permissions.ts';
import { navigate } from '../../App.tsx';
import { copyText } from '../../lib/format.ts';
import { groups, type ChannelKind, type ChannelView, type GroupView, type MemberView } from '../../lib/groups/client.ts';
import { useStore } from '../../lib/store.ts';
import { RoomView } from '../room/RoomView.tsx';
import { Avatar, Button, Card, cx, IconButton, Logo, Menu, MenuItem, Modal, Notice, TextInput, Toast, Toggle } from '../ui.tsx';
import { AuthPage } from './AuthPage.tsx';
import { Chat } from './Chat.tsx';
import { can, fieldLabel, groupHash, GroupIcon, memberName, nameColor, topRole, useAction } from './common.tsx';
import { CreateChannelModal } from './settings/ChannelsTab.tsx';
import { extractGroupInvite, groupInviteLink, GroupSettings, type SettingsTab } from './settings/GroupSettings.tsx';
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
  const [preview, setPreview] = useState<{ code: string; group: { id: string; name: string; description: string; icon: string | null; memberCount: number }; joined: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<any[] | null>(null);
  const { busy, run } = useAction();

  const look = useCallback(
    (value: string) => {
      const parsed = extractGroupInvite(value);
      if (!parsed) return groups.notify('Cole o link de convite inteiro ou só o código.');
      void run(async () => {
        const result = await groups.call('GET', `/api/invites/${parsed}`);
        setPreview({ code: parsed, group: result.group, joined: result.joined });
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

function MemberList({ view, className }: { view: GroupView; className?: string }) {
  const rank = (member: MemberView) => (member.userId === view.group.ownerId ? 1e9 : (topRole(view, member)?.position ?? 0));
  const sorted = [...view.members].sort((a, b) => rank(b) - rank(a) || memberName(a).localeCompare(memberName(b)));
  const sections: [string, MemberView[]][] = [
    ['Online', sorted.filter((member) => member.online)],
    ['Offline', sorted.filter((member) => !member.online)],
  ];
  return (
    <aside className={cx('min-h-0 overflow-y-auto p-3', className)} data-testid="member-list">
      {sections.map(
        ([title, members]) =>
          members.length > 0 && (
            <section key={title} className="mb-4">
              <h2 className="px-2 pb-1.5 text-xs font-extrabold tracking-wide text-fog-500 uppercase">
                {title} — {members.length}
              </h2>
              <ul className="grid gap-0.5">
                {members.map((member) => {
                  const role = topRole(view, member);
                  return (
                    <li key={member.userId} className={cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-800', !member.online && 'opacity-55')} data-testid="member" data-user={member.username} data-online={member.online}>
                      <Avatar id={member.userId} name={memberName(member)} size={34} online={member.online} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 truncate text-sm font-bold" style={{ color: nameColor(view, member) }}>
                          <span className="truncate" data-testid="member-name">
                            {memberName(member)}
                          </span>
                          {member.userId === view.group.ownerId && <Crown className="size-3.5 shrink-0 text-warn-400" aria-label="Dono do grupo" />}
                        </p>
                        {role && (
                          <p className="truncate text-xs text-fog-500" data-testid="member-top-role">
                            {role.name}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
      )}
    </aside>
  );
}

function VoiceBar({ view, voice, onLeave }: { view: GroupView | null; voice: VoiceState; onLeave: () => void }) {
  const micOn = useStore(voice.session.store, (state) => state.micOn);
  const micBusy = useStore(voice.session.store, (state) => state.micBusy);
  const sharing = useStore(voice.session.store, (state) => state.share.active);
  const speak = useStore(voice.session.store, (state) => state.rights.speak);
  const channel = view?.group.id === voice.groupId ? view.channels.find((item) => item.id === voice.channelId) : undefined;
  return (
    <div className="flex items-center gap-2 border-t border-ink-700 bg-ink-850 px-3 py-2.5" data-testid="voice-bar">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate(groupHash(voice.groupId, voice.channelId))}>
        <p className="flex items-center gap-1.5 text-sm font-bold text-ok-400">
          <span className="size-2 rounded-full bg-ok-400" /> {sharing ? 'Transmitindo a tela' : 'Voz conectada'}
        </p>
        <p className="truncate text-xs text-fog-400">{channel?.name ?? 'outro grupo'}</p>
      </button>
      <IconButton label={micOn ? 'Desligar o microfone' : 'Ligar o microfone'} disabled={micBusy || (!speak && !micOn)} onClick={() => void voice.session.setMic(!micOn)} data-testid="voice-bar-mic">
        {micOn ? <Mic className="size-5 text-ok-400" /> : <MicOff className="size-5" />}
      </IconButton>
      <IconButton label="Sair do canal de voz" className="hover:text-live-300" onClick={onLeave} data-testid="voice-bar-leave">
        <PhoneOff className="size-5" />
      </IconButton>
    </div>
  );
}

function ChannelList({ view, selected, voice, onPick, onModal, onLeaveVoice }: {
  view: GroupView;
  selected: string | undefined;
  voice: VoiceState | null;
  onPick: (channel: ChannelView) => void;
  onModal: (modal: ModalState) => void;
  onLeaveVoice: () => void;
}) {
  const { run } = useAction();
  const byPosition = (a: ChannelView, b: ChannelView) => a.position - b.position || a.name.localeCompare(b.name);
  const categories = view.channels.filter((channel) => channel.kind === 'categoria').sort(byPosition);
  const childrenOf = (parentId: string | null) => view.channels.filter((channel) => channel.kind !== 'categoria' && channel.parentId === parentId).sort(byPosition);
  const manage = can(view, P.MANAGE_CHANNELS);

  const row = (channel: ChannelView) => {
    const inside = (view.voice[channel.id] ?? []).map((userId) => view.members.find((member) => member.userId === userId)).filter((member) => member !== undefined);
    const Icon = channel.private ? Lock : channel.kind === 'voz' ? Volume2 : Hash;
    return (
      <li key={channel.id}>
        <button
          type="button"
          onClick={() => onPick(channel)}
          data-testid="channel"
          data-kind={channel.kind}
          data-name={channel.name}
          aria-current={selected === channel.id}
          className={cx(
            'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[15px] font-semibold transition-colors',
            selected === channel.id ? 'bg-brand-500/20 text-white' : 'text-fog-300 hover:bg-ink-800 hover:text-fog-100',
          )}
        >
          <Icon className="size-4 shrink-0 text-fog-500" aria-hidden="true" />
          <span className="truncate">{channel.name}</span>
          {channel.kind === 'voz' && channel.userLimit > 0 && (
            <span className="ml-auto shrink-0 text-xs text-fog-500">
              {inside.length}/{channel.userLimit}
            </span>
          )}
        </button>
        {inside.length > 0 && (
          <ul className="mt-0.5 mb-1 ml-7 grid gap-0.5" data-testid="channel-voice-people">
            {inside.map((member) => (
              <li key={member.userId} className="flex items-center gap-2 text-sm text-fog-300" data-user={member.username}>
                <Avatar id={member.userId} name={memberName(member)} size={22} online />
                <span className="truncate">{memberName(member)}</span>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-col">
      <Menu
        side="bottom"
        trigger={({ toggle, open }) => (
          <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 border-b border-ink-700 px-4 py-3.5 text-left hover:bg-ink-800/60" data-testid="group-menu">
            <span className="min-w-0 flex-1 truncate text-[17px] font-extrabold" data-testid="group-title">
              {view.group.name}
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
                  const nickname = window.prompt('Seu apelido neste grupo (deixe vazio para usar o nome da conta):', view.members.find((member) => member.userId === view.me.userId)?.nickname ?? '');
                  if (nickname !== null) void run(() => groups.change('PATCH', `/api/groups/${view.group.id}/members/${view.me.userId}`, { nickname }));
                }}
              >
                Meu apelido neste grupo
              </MenuItem>
            </div>
          );
        }}
      </Menu>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Canais" data-testid="channel-list">
        <ul className="grid gap-0.5">{childrenOf(null).map(row)}</ul>
        {categories.map((category) => (
          <section key={category.id} className="mt-3">
            <h2 className="flex items-center gap-1 px-2 pb-1 text-xs font-extrabold tracking-wide text-fog-500 uppercase" data-testid="category" data-name={category.name}>
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
              {manage && (
                <IconButton label={`Criar canal em ${category.name}`} className="size-6" onClick={() => onModal({ type: 'canal', kind: 'texto', parentId: category.id })}>
                  <Plus className="size-4" />
                </IconButton>
              )}
            </h2>
            <ul className="grid gap-0.5">{childrenOf(category.id).map(row)}</ul>
          </section>
        ))}
      </nav>
      {voice && <VoiceBar view={view} voice={voice} onLeave={onLeaveVoice} />}
    </div>
  );
}

function Shell({ groupId, channelId, invite }: { groupId?: string; channelId?: string; invite?: string }) {
  const account = useStore(groups.store, (state) => state.account)!;
  const list = useStore(groups.store, (state) => state.groups);
  const view = useStore(groups.store, (state) => state.view);
  const loading = useStore(groups.store, (state) => state.viewLoading);
  const live = useStore(groups.store, (state) => state.live);
  const wide = useWide();
  const [modal, setModal] = useState<ModalState>(invite ? { type: 'entrar', code: invite } : null);
  const [pane, setPane] = useState<'lista' | 'conteudo'>(channelId ? 'conteudo' : 'lista');
  const { voice, joining, join, leave } = useVoice(view);
  const openedFor = useRef<string | undefined>(undefined);

  // Link de convite aberto com o site já na tela (só o endereço mudou): mostra o convite.
  useEffect(() => {
    if (invite) setModal({ type: 'entrar', code: invite });
  }, [invite]);

  useEffect(() => {
    if (!groupId) {
      groups.closeGroup();
      openedFor.current = undefined;
      // Sem grupo escolhido, abre o primeiro da lista.
      if (list[0] && !invite) redirect(groupHash(list[0].id));
      return;
    }
    if (openedFor.current === groupId) return;
    openedFor.current = groupId;
    groups.openGroup(groupId).catch(() => {
      groups.notify('Esse grupo não existe ou você não faz mais parte dele.');
      openedFor.current = undefined;
      redirect(groupHash());
    });
  }, [groupId, list, invite]);

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

  const pick = (target: ChannelView) => {
    navigate(groupHash(current!.group.id, target.id));
    setPane('conteudo');
    // Canal de voz: clicar já entra (se a pessoa pode conectar).
    if (target.kind === 'voz' && voice?.channelId !== target.id && has(target.permissions, P.CONNECT)) void join(current!.group.id, target.id);
  };

  const inThisVoice = Boolean(voice && channel && voice.channelId === channel.id);
  const showContent = wide || pane === 'conteudo';
  const showList = wide || pane === 'lista';

  return (
    <div className="flex h-dvh overflow-hidden" data-testid="groups" data-live={live}>
      {showList && (
        <>
          <nav className="flex w-[4.5rem] shrink-0 flex-col items-center gap-2 border-r border-ink-700 bg-ink-900/70 py-3" aria-label="Seus grupos" data-testid="group-rail">
            <IconButton label="Voltar para o início do ShareRoom" className="size-12 rounded-2xl bg-ink-800" onClick={() => navigate('#/')}>
              <Home className="size-5" />
            </IconButton>
            <span className="h-px w-8 bg-ink-600" aria-hidden="true" />
            <ul className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-1 py-0.5">
              {list.map((group) => (
                <li key={group.id}>
                  <button type="button" title={group.name} aria-label={group.name} aria-current={group.id === groupId} onClick={() => navigate(groupHash(group.id))} data-testid="rail-group" data-name={group.name}>
                    <GroupIcon group={group} active={group.id === groupId} />
                  </button>
                </li>
              ))}
            </ul>
            <IconButton label="Criar um grupo" className="size-12 rounded-2xl border border-dashed border-ink-500 text-brand-300" onClick={() => setModal({ type: 'criar-grupo' })} data-testid="rail-create">
              <Plus className="size-5" />
            </IconButton>
            <IconButton label="Entrar em um grupo" className="size-12 rounded-2xl border border-dashed border-ink-500 text-brand-300" onClick={() => setModal({ type: 'entrar' })} data-testid="rail-join">
              <Compass className="size-5" />
            </IconButton>
            <Menu
              side="top"
              trigger={({ toggle }) => (
                <button type="button" onClick={toggle} aria-label="Sua conta" className="mt-1 rounded-full" data-testid="account-menu">
                  <Avatar id={account.id} name={account.displayName} size={40} online={live} />
                </button>
              )}
            >
              <div className="w-56">
                <p className="truncate px-2.5 pt-1.5 text-sm font-bold">{account.displayName}</p>
                <p className="truncate px-2.5 pb-2 text-xs text-fog-500">@{account.username}</p>
                <MenuItem icon={<LogOut className="size-4" />} onClick={() => void groups.logout()} data-testid="account-logout">
                  Sair da conta
                </MenuItem>
              </div>
            </Menu>
          </nav>

          <div className={cx('flex min-h-0 flex-col border-r border-ink-700 bg-ink-850/80', wide ? 'w-64 shrink-0' : 'min-w-0 flex-1')}>
            {current ? (
              <ChannelList view={current} selected={channelId} voice={voice} onPick={pick} onModal={setModal} onLeaveVoice={() => void leave()} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="p-4">
                  <Logo compact />
                  <p className="mt-4 text-sm leading-relaxed text-fog-400">
                    {list.length === 0
                      ? 'Você ainda não está em nenhum grupo. Crie um ou entre com um convite.'
                      : loading
                        ? 'Abrindo o grupo…'
                        : 'Escolha um grupo na barra ao lado.'}
                  </p>
                  <div className="mt-4 grid gap-2">
                    <Button variant="primary" onClick={() => setModal({ type: 'criar-grupo' })}>
                      Criar um grupo
                    </Button>
                    <Button onClick={() => setModal({ type: 'entrar' })}>Entrar em um grupo</Button>
                  </div>
                </div>
                {voice && (
                  <div className="mt-auto">
                    <VoiceBar view={view} voice={voice} onLeave={() => void leave()} />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* A sala de voz fica montada enquanto a conexão existir, mesmo com um canal de texto na tela: assim a
          transmissão e o mixer não param quando a pessoa vai conversar por texto. */}
      <div className={cx('min-w-0 flex-1 flex-col', showContent ? 'flex' : 'hidden')}>
        {!wide && current && (
          <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-2 py-1.5">
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
          <div className={cx('min-h-0 flex-1', inThisVoice ? 'flex flex-col' : 'hidden')} data-testid="voice-room">
            <RoomView session={voice.session} invite="" embedded onLeave={() => void leave()} />
          </div>
        )}
        {!inThisVoice &&
          (current && channel ? (
            channel.kind === 'texto' ? (
              <Chat key={channel.id} view={current} channel={channel} />
            ) : (
              <VoiceLobby view={current} channel={channel} joining={joining === channel.id} onJoin={() => void join(current.group.id, channel.id)} />
            )
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-fog-400">
              {loading ? 'Carregando…' : groupId ? 'Escolha um canal.' : 'Seus grupos aparecem na barra à esquerda.'}
            </div>
          ))}
      </div>

      {wide && current && (
        <div className="flex w-64 shrink-0 flex-col border-l border-ink-700 bg-ink-850/60">
          {inThisVoice && voice ? <VoicePeople view={current} voice={voice} className="m-2 min-h-0 flex-1" /> : <MemberList view={current} className="flex-1" />}
        </div>
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
  );
}

/** Página dos grupos: conta, lista de grupos, canais, chat e voz. */
export function GroupsPage({ groupId, channelId, invite }: { groupId?: string; channelId?: string; invite?: string }) {
  const status = useStore(groups.store, (state) => state.status);
  const notice = useStore(groups.store, (state) => state.notice);
  const clear = useCallback(() => groups.clearNotice(), []);

  useEffect(() => {
    void groups.start();
    document.title = 'Grupos – ShareRoom';
  }, []);

  return (
    <>
      {status === 'verificando' && <div className="flex min-h-dvh items-center justify-center text-fog-400">Conectando ao servidor…</div>}
      {status === 'indisponivel' && (
        <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-5">
          <Logo />
          <Notice tone="aviso" data-testid="groups-unavailable">
            Os grupos não estão disponíveis neste servidor agora. Eles precisam de um banco de dados configurado no backend. As salas por link continuam funcionando.
          </Notice>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => navigate('#/')}>
              Voltar para o início
            </Button>
            <Button onClick={() => void groups.start()}>Tentar de novo</Button>
          </div>
        </div>
      )}
      {status === 'fora' && <AuthPage invited={Boolean(invite)} />}
      {status === 'dentro' && <Shell groupId={groupId} channelId={channelId} invite={invite} />}
      <Toast message={notice} onDone={clear} />
    </>
  );
}
