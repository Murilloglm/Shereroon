import { Bell, BellOff, Check, CornerUpLeft, LoaderCircle, MessageSquare, Paperclip, Pencil, Search, SendHorizontal, Smile, Ticket, Trash2, UserCheck, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { navigate } from '../../App.tsx';
import { dialogs } from '../../lib/dialogs.ts';
import { groups } from '../../lib/groups/client.ts';
import { social, type Conversation, type DmAttachment, type DmMessage, type Friend } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { Attachments, FileSourceProvider } from '../groups/Attachments.tsx';
import { EmojiPicker } from '../groups/EmojiPicker.tsx';
import { errorText, groupHash, GroupIcon, useAction } from '../groups/common.tsx';
import { Avatar, Button, cx, IconButton, TextInput } from '../ui.tsx';
import { startDm, useUserTriggers } from './UserInteractions.tsx';

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

// --- Coluna da esquerda: amigos e conversas -----------------------------------------------------

export function SocialSidebar({ selected }: { selected: string }) {
  const conversations = useStore(social.store, (state) => state.conversations);
  const friends = useStore(social.store, (state) => state.friends);
  const [search, setSearch] = useState('');
  useEffect(() => {
    void social.loadConversations().catch(() => undefined);
    void social.loadFriends().catch(() => undefined);
  }, []);
  const pending = friends?.filter((item) => item.state === 'recebida').length ?? 0;
  const term = search.trim().toLocaleLowerCase('pt-BR');
  const shown = (conversations ?? []).filter((item) => !term || social.nameFor(item.user.id, item.user.displayName).toLocaleLowerCase('pt-BR').includes(term) || item.user.username.includes(term));
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="social-sidebar">
      <div className="border-b border-brand-500/15 p-2.5">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fog-500" aria-hidden="true" />
          <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conversas" aria-label="Buscar conversas" className="h-9 w-full pl-8" data-testid="dm-search" />
        </label>
      </div>
      <button
        type="button"
        onClick={() => navigate('#/mensagens')}
        className={cx('mx-2 mt-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[15px] font-semibold', selected === 'inicio' ? 'cn-selected text-white' : 'text-fog-300 hover:bg-white/5')}
        data-testid="friends-home"
      >
        <Users className="size-5" aria-hidden="true" />
        <span className="flex-1">Amigos</span>
        {pending > 0 && <span className="rounded-full bg-live-500 px-1.5 text-xs font-extrabold text-white">{pending}</span>}
      </button>
      <p className="px-4 pt-3 pb-1 text-xs font-extrabold tracking-wide text-fog-500 uppercase">Mensagens privadas</p>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {conversations === null && <li className="px-2 py-3 text-sm text-fog-500">Carregando…</li>}
        {conversations !== null && shown.length === 0 && <li className="px-2 py-3 text-sm text-fog-500">{term ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda. Abra o perfil de alguém e mande uma mensagem.'}</li>}
        {shown.map((item) => (
          <ConversationRow key={item.id} conversation={item} active={item.id === selected} />
        ))}
      </ul>
    </div>
  );
}

function ConversationRow({ conversation, active }: { conversation: Conversation; active: boolean }) {
  const name = social.nameFor(conversation.user.id, conversation.user.displayName);
  const unread = conversation.notify === 'nada' ? 0 : conversation.unread;
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(`#/mensagens/${conversation.id}`)}
        className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', active ? 'cn-selected' : 'hover:bg-white/5')}
        data-testid="dm-conversation"
        data-user={conversation.user.username}
        data-unread={unread}
      >
        <Avatar id={conversation.user.id} name={conversation.user.displayName} size={34} image={conversation.user.avatar} online={conversation.online} />
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate text-[15px]', unread > 0 ? 'font-extrabold text-white' : 'font-semibold text-fog-200')}>{name}</span>
          {conversation.last && (
            <span className="block truncate text-xs text-fog-500">
              {conversation.last.mine ? 'Você: ' : ''}
              {conversation.last.content || 'Anexo'}
            </span>
          )}
        </span>
        {unread > 0 && <span className="rounded-full bg-neon-500 px-1.5 text-xs font-extrabold text-ink-950" data-testid="dm-unread">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </li>
  );
}

// --- Amigos ---------------------------------------------------------------------------------------

type FriendsTab = 'online' | 'todos' | 'pendentes' | 'bloqueados' | 'adicionar';

export function FriendsHome() {
  const friends = useStore(social.store, (state) => state.friends);
  const blocks = useStore(social.store, (state) => state.blocks);
  const [tab, setTab] = useState<FriendsTab>('online');
  const [username, setUsername] = useState('');
  const [search, setSearch] = useState('');
  const { busy, run } = useAction();
  useEffect(() => {
    void social.loadFriends().catch(() => undefined);
  }, []);
  const term = search.trim().toLocaleLowerCase('pt-BR');
  const match = (item: Friend) => !term || social.nameFor(item.user.id, item.user.displayName).toLocaleLowerCase('pt-BR').includes(term) || item.user.username.includes(term);
  const list = (friends ?? []).filter(match).filter((item) => (tab === 'online' ? item.state === 'amigos' && item.online : tab === 'todos' ? item.state === 'amigos' : tab === 'pendentes' ? item.state !== 'amigos' : false));
  const pending = friends?.filter((item) => item.state === 'recebida').length ?? 0;

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const state = await social.requestFriend({ username: username.trim() });
      groups.notify(state === 'amigos' ? 'Agora vocês são amigos.' : 'Pedido de amizade enviado.');
      setUsername('');
    });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="friends">
      <header className="flex flex-wrap items-center gap-2 border-b border-brand-500/15 px-4 py-2.5">
        <h1 className="mr-2 flex items-center gap-2 text-lg font-extrabold">
          <Users className="size-5 text-neon-300" aria-hidden="true" /> Amigos
        </h1>
        {(
          [
            ['online', 'Online'],
            ['todos', 'Todos'],
            ['pendentes', pending > 0 ? `Pendentes (${pending})` : 'Pendentes'],
            ['bloqueados', 'Bloqueados'],
          ] as [FriendsTab, string][]
        ).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value} className={cx('rounded-lg px-2.5 py-1 text-sm font-bold', tab === value ? 'bg-brand-500/30 text-white' : 'text-fog-400 hover:bg-white/5 hover:text-fog-100')} data-testid={`friends-tab-${value}`}>
            {label}
          </button>
        ))}
        <Button size="sm" variant={tab === 'adicionar' ? 'primary' : 'neon'} onClick={() => setTab('adicionar')} data-testid="friends-tab-adicionar">
          <UserPlus className="size-4" aria-hidden="true" /> Adicionar amigo
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'adicionar' ? (
          <form onSubmit={add} className="grid max-w-xl gap-2">
            <p className="text-sm text-fog-400">Adicione pelo nome de usuário (o que aparece depois do @ no perfil).</p>
            <div className="flex gap-2">
              <TextInput value={username} onChange={(event) => setUsername(event.target.value)} placeholder="nome_de_usuario" aria-label="Nome de usuário" className="min-w-0 flex-1" data-testid="friend-username" />
              <Button type="submit" variant="primary" disabled={busy || !username.trim()} data-testid="friend-send">
                Enviar pedido
              </Button>
            </div>
          </form>
        ) : tab === 'bloqueados' ? (
          <ul className="grid gap-1.5">
            {(blocks ?? []).length === 0 && <li className="text-sm text-fog-500">Ninguém bloqueado.</li>}
            {(blocks ?? []).map((user) => (
              <li key={user.id} className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-2">
                <Avatar id={user.id} name={user.displayName} size={36} image={user.avatar} />
                <span className="min-w-0 flex-1 truncate font-semibold">{user.displayName} <span className="text-sm text-fog-500">@{user.username}</span></span>
                <Button size="sm" onClick={() => void run(() => social.unblock(user.id))} data-testid="friend-unblock">
                  Desbloquear
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar amigos" aria-label="Buscar amigos" className="mb-3 w-full max-w-md" data-testid="friends-search" />
            <ul className="grid gap-1.5">
              {friends === null && <li className="text-sm text-fog-500">Carregando…</li>}
              {friends !== null && list.length === 0 && <li className="text-sm text-fog-500">{tab === 'online' ? 'Nenhum amigo online agora.' : tab === 'pendentes' ? 'Nenhum pedido pendente.' : 'Nenhum amigo ainda.'}</li>}
              {list.map((item) => (
                <FriendRow key={item.user.id} friend={item} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function FriendRow({ friend }: { friend: Friend }) {
  const triggers = useUserTriggers(friend.user.id);
  const name = social.nameFor(friend.user.id, friend.user.displayName);
  const { busy, run } = useAction();
  return (
    <li className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-2" data-testid="friend-row" data-user={friend.user.username} data-state={friend.state}>
      <span className="flex min-w-0 flex-1 cursor-pointer items-center gap-3" {...triggers}>
        <Avatar id={friend.user.id} name={friend.user.displayName} size={38} image={friend.user.avatar} online={friend.online} />
        <span className="min-w-0">
          <span className="block truncate font-bold">{name}</span>
          <span className="block truncate text-xs text-fog-500">
            {friend.state === 'amigos' ? friend.status || (friend.online ? 'Online' : 'Offline') : friend.state === 'recebida' ? 'Pedido recebido' : 'Pedido enviado'}
          </span>
        </span>
      </span>
      {friend.state === 'amigos' && (
        <>
          <IconButton label={`Mandar mensagem para ${name}`} onClick={() => void startDm(friend.user.id)} data-testid="friend-message">
            <MessageSquare className="size-4.5" />
          </IconButton>
          <IconButton label={`Remover ${name} dos amigos`} disabled={busy} onClick={() => void dialogs.confirm({ title: `Desfazer a amizade com ${name}?`, confirmLabel: 'Desfazer amizade', tone: 'perigo', action: () => social.removeFriend(friend.user.id) })} data-testid="friend-remove">
            <UserMinus className="size-4.5" />
          </IconButton>
        </>
      )}
      {friend.state === 'recebida' && (
        <>
          <IconButton label={`Aceitar ${name}`} disabled={busy} onClick={() => void run(() => social.acceptFriend(friend.user.id))} data-testid="friend-accept">
            <Check className="size-4.5 text-ok-400" />
          </IconButton>
          <IconButton label={`Recusar ${name}`} disabled={busy} onClick={() => void run(() => social.removeFriend(friend.user.id))} data-testid="friend-decline">
            <X className="size-4.5 text-live-300" />
          </IconButton>
        </>
      )}
      {friend.state === 'enviada' && (
        <IconButton label={`Cancelar o pedido para ${name}`} disabled={busy} onClick={() => void run(() => social.removeFriend(friend.user.id))} data-testid="friend-cancel">
          <X className="size-4.5" />
        </IconButton>
      )}
    </li>
  );
}

// --- Conversa ------------------------------------------------------------------------------------

interface Pending {
  key: string;
  file: File;
  progress: number;
  attachment: DmAttachment | null;
  error: string | null;
  cancel: () => void;
}

export function DmChat({ dmId }: { dmId: string }) {
  const conversation = useStore(social.store, (state) => state.conversations?.find((item) => item.id === dmId));
  const state = useStore(social.store, (store) => store.messages[dmId]);
  const me = useStore(groups.store, (store) => store.account?.id);
  const myGroups = useStore(groups.store, (store) => store.groups);
  const items = state?.items ?? [];
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<DmMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [inviting, setInviting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const triggers = useUserTriggers(conversation?.user.id);

  useEffect(() => {
    void social.loadMessages(dmId).catch(() => undefined);
    if (!social.store.get().conversations) void social.loadConversations().catch(() => undefined);
  }, [dmId]);

  // Lida de verdade só quando a conversa está na tela, com a janela em foco e o fim da lista visível.
  const last = items.at(-1);
  useEffect(() => {
    if (!last) return;
    const mark = () => {
      if (document.visibilityState === 'visible' && document.hasFocus() && atBottom.current) void social.markRead(dmId, last.id);
    };
    mark();
    window.addEventListener('focus', mark);
    document.addEventListener('visibilitychange', mark);
    return () => {
      window.removeEventListener('focus', mark);
      document.removeEventListener('visibilitychange', mark);
    };
  }, [dmId, last]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && atBottom.current) list.scrollTop = list.scrollHeight;
  }, [items.length, dmId]);

  const upload = (files: Iterable<File>) => {
    for (const file of files) {
      const key = `${file.name}-${Math.random()}`;
      const job = social.upload(dmId, file, (progress) => setPending((list) => list.map((item) => (item.key === key ? { ...item, progress } : item))));
      setPending((list) => [...list, { key, file, progress: 0, attachment: null, error: null, cancel: job.cancel }]);
      job.done.then(
        (attachment) => setPending((list) => list.map((item) => (item.key === key ? { ...item, attachment, progress: 1 } : item))),
        (error: unknown) => setPending((list) => list.map((item) => (item.key === key ? { ...item, error: errorText(error) } : item))),
      );
    }
  };

  const ready = pending.filter((item) => item.attachment);
  const uploading = pending.some((item) => !item.attachment && !item.error);
  const send = async () => {
    const content = draft.trim();
    if (sending || uploading || (!content && ready.length === 0)) return;
    setSending(true);
    try {
      await social.send(dmId, { content, replyTo: replyTo?.id, attachments: ready.map((item) => item.attachment!.id) });
      setDraft('');
      setReplyTo(null);
      setPending([]);
      atBottom.current = true;
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Mensagem não enviada', message: errorText(error) });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    } else if (event.key === 'Escape' && replyTo) setReplyTo(null);
  };

  // O backend confere se a conta pode convidar em cada grupo; aqui a lista mostra todos os grupos dela.
  const invitable = myGroups;
  const sendInvite = async (groupId: string) => {
    setInviting(false);
    try {
      await social.send(dmId, { invite: { groupId } });
    } catch (error) {
      await dialogs.alert({ kind: 'aviso', title: 'Não foi possível convidar', message: errorText(error) });
    }
  };

  const name = conversation ? social.nameFor(conversation.user.id, conversation.user.displayName) : 'Conversa';
  const grouped = useMemo(() => items.map((message, index) => ({ message, newDay: index === 0 || day(items[index - 1]!.createdAt) !== day(message.createdAt) })), [items]);

  return (
    <FileSourceProvider value={(fileId) => social.fileUrl(fileId)}>
      <section className="flex min-h-0 flex-1 flex-col" data-testid="dm-chat" data-dm={dmId}>
        <header className="flex items-center gap-3 border-b border-brand-500/15 px-4 py-2.5">
          {conversation && (
            <span className="flex min-w-0 flex-1 cursor-pointer items-center gap-3" {...triggers}>
              <Avatar id={conversation.user.id} name={conversation.user.displayName} size={34} image={conversation.user.avatar} online={conversation.online} />
              <span className="min-w-0">
                <span className="block truncate font-extrabold" data-testid="dm-title">{name}</span>
                <span className="block truncate text-xs text-fog-500">@{conversation.user.username} • {conversation.online ? 'online' : 'offline'}</span>
              </span>
            </span>
          )}
          {conversation && (
            <IconButton
              label={conversation.notify === 'nada' ? 'Voltar a receber avisos desta conversa' : 'Silenciar os avisos desta conversa'}
              onClick={() => void social.setNotify(dmId, conversation.notify === 'nada' ? 'tudo' : 'nada')}
              aria-pressed={conversation.notify === 'nada'}
              data-testid="dm-notify"
            >
              {conversation.notify === 'nada' ? <BellOff className="size-5 text-fog-500" /> : <Bell className="size-5" />}
            </IconButton>
          )}
        </header>

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
          onScroll={(event) => {
            const list = event.currentTarget;
            atBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
            if (list.scrollTop < 60 && state?.hasMore) void social.loadMessages(dmId, true).catch(() => undefined);
            if (atBottom.current && last) void social.markRead(dmId, last.id);
          }}
          data-testid="dm-messages"
        >
          {state?.loaded && items.length === 0 && <p className="py-8 text-center text-sm text-fog-500">Este é o começo da sua conversa com {name}.</p>}
          {grouped.map(({ message, newDay }) => (
            <div key={message.id}>
              {newDay && (
                <p className="my-3 flex items-center gap-3 text-xs font-bold text-fog-500 capitalize">
                  <span className="h-px flex-1 bg-ink-700" />
                  {day(message.createdAt)}
                  <span className="h-px flex-1 bg-ink-700" />
                </p>
              )}
              <DmBubble
                message={message}
                mine={message.author.id === me}
                me={me ?? ''}
                editing={editing?.id === message.id ? editing : null}
                onEdit={setEditing}
                onReply={() => {
                  setReplyTo(message);
                  inputRef.current?.focus();
                }}
                onPicker={() => setPicker(picker === message.id ? null : message.id)}
                picker={picker === message.id}
                onClosePicker={() => setPicker(null)}
              />
            </div>
          ))}
        </div>

        <form
          className="relative border-t border-brand-500/15 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          onDragOver={(event: DragEvent) => event.preventDefault()}
          onDrop={(event: DragEvent) => {
            event.preventDefault();
            if (event.dataTransfer.files.length) upload(event.dataTransfer.files);
          }}
        >
          {replyTo && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm" data-testid="dm-replying">
              <CornerUpLeft className="size-4 text-neon-300" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                Respondendo a <b>{replyTo.author.name}</b>: {replyTo.content || 'anexo'}
              </span>
              <IconButton label="Cancelar resposta" className="size-7" onClick={() => setReplyTo(null)}>
                <X className="size-4" />
              </IconButton>
            </div>
          )}
          {pending.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-2">
              {pending.map((item) => (
                <li key={item.key} className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-850 px-2.5 py-1 text-xs" data-testid="dm-pending-file">
                  {item.attachment ? <Check className="size-3.5 text-ok-400" aria-hidden="true" /> : item.error ? <X className="size-3.5 text-live-300" aria-hidden="true" /> : <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
                  <span className="max-w-40 truncate">{item.file.name}</span>
                  {!item.attachment && !item.error && <span>{Math.round(item.progress * 100)}%</span>}
                  {item.error && <span className="text-live-300">{item.error}</span>}
                  <button type="button" aria-label={`Tirar ${item.file.name}`} onClick={() => (item.cancel(), setPending((list) => list.filter((other) => other.key !== item.key)))}>
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {conversation && !social.store.get().profiles[conversation.user.id]?.canMessage && social.store.get().profiles[conversation.user.id] && (
            <p className="mb-2 text-xs text-warn-400">Você não pode mandar novas mensagens para esta pessoa agora (bloqueio ou privacidade).</p>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-ink-600 bg-ink-850 px-2 py-1.5 focus-within:border-neon-400">
            <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fog-300 hover:bg-white/10" title="Anexar arquivo">
              <Paperclip className="size-5" aria-hidden="true" />
              <span className="sr-only">Anexar arquivo</span>
              <input type="file" multiple className="sr-only" onChange={(event) => (event.target.files && upload(event.target.files), (event.target.value = ''))} data-testid="dm-file" />
            </label>
            <div className="relative">
              <IconButton label="Convidar para um grupo" className="size-9" onClick={() => setInviting((value) => !value)} data-testid="dm-invite">
                <Ticket className="size-5" />
              </IconButton>
              {inviting && (
                <div className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl border border-brand-400/50 bg-ink-900 p-1 shadow-glow" role="menu" data-testid="dm-invite-menu">
                  <p className="px-2 pt-1 pb-1.5 text-xs font-bold text-fog-500">Convidar para</p>
                  {invitable.length === 0 && <p className="px-2 pb-2 text-sm text-fog-400">Você não pode criar convites em nenhum grupo.</p>}
                  {invitable.map((group) => (
                    <button key={group.id} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold hover:bg-brand-500/20" onClick={() => void sendInvite(group.id)} data-testid="dm-invite-group" data-name={group.name}>
                      <GroupIcon group={group} size={26} />
                      <span className="truncate">{group.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKey}
              onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
                if (event.clipboardData.files.length) {
                  event.preventDefault();
                  upload(event.clipboardData.files);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder={`Mensagem para ${name}`}
              aria-label={`Mensagem para ${name}`}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none"
              data-testid="dm-input"
            />
            <IconButton label="Enviar" type="submit" className="size-9" disabled={sending || uploading || (!draft.trim() && ready.length === 0)} data-testid="dm-send">
              <SendHorizontal className="size-5" />
            </IconButton>
          </div>
        </form>
      </section>
    </FileSourceProvider>
  );
}

function DmBubble({
  message,
  mine,
  me,
  editing,
  onEdit,
  onReply,
  onPicker,
  picker,
  onClosePicker,
}: {
  message: DmMessage;
  mine: boolean;
  me: string;
  editing: { id: string; text: string } | null;
  onEdit: (value: { id: string; text: string } | null) => void;
  onReply: () => void;
  onPicker: () => void;
  picker: boolean;
  onClosePicker: () => void;
}) {
  const toggle = (emoji: string) => {
    const mineAlready = message.reactions.find((item) => item.emoji === emoji)?.users.includes(me);
    void social.react(message, emoji, !mineAlready).catch((error: unknown) => groups.notify(errorText(error)));
  };
  return (
    <article className={cx('group relative my-1 flex', mine ? 'justify-end' : 'justify-start')} data-testid="dm-message" data-mine={mine} data-id={message.id}>
      <div className={cx('max-w-[78%] rounded-2xl px-3 py-2', mine ? 'rounded-br-md bg-brand-600/35 ring-1 ring-brand-400/30' : 'rounded-bl-md bg-ink-800 ring-1 ring-ink-600/70')}>
        {message.reply && (
          <p className="mb-1 truncate border-l-2 border-neon-400 pl-2 text-xs text-fog-400" data-testid="dm-reply-quote">
            <b>{message.reply.authorName}</b>: {message.reply.excerpt || 'anexo'}
          </p>
        )}
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void social.edit(message.id, editing.text).then(() => onEdit(null), (error: unknown) => groups.notify(errorText(error)));
            }}
          >
            <TextInput value={editing.text} onChange={(event) => onEdit({ id: message.id, text: event.target.value })} autoFocus className="w-72 max-w-full" data-testid="dm-edit-input" onKeyDown={(event) => event.key === 'Escape' && onEdit(null)} />
            <p className="mt-1 text-xs text-fog-500">Enter salva • Esc cancela</p>
          </form>
        ) : (
          message.content && <p className="text-[15px] leading-snug break-words whitespace-pre-wrap" data-testid="dm-content">{message.content}</p>
        )}
        {message.meta?.type === 'convite' && <InviteMessage meta={message.meta} />}
        {message.attachments.length > 0 && <Attachments files={message.attachments.map((file) => ({ ...file, width: file.width ?? undefined, height: file.height ?? undefined })) as never} />}
        <p className="mt-0.5 text-right text-[11px] text-fog-500">
          {time(message.createdAt)}
          {message.editedAt && ' • editada'}
        </p>
        {message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((reaction) => (
              <button key={reaction.emoji} type="button" onClick={() => toggle(reaction.emoji)} className={cx('rounded-full border px-1.5 text-sm', reaction.users.includes(me) ? 'border-neon-400 bg-neon-500/15' : 'border-ink-600')} data-testid="dm-reaction">
                {reaction.emoji} {reaction.users.length}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={cx('absolute -top-3 hidden gap-0.5 rounded-lg border border-ink-600 bg-ink-900 p-0.5 group-focus-within:flex group-hover:flex', mine ? 'right-2' : 'left-2')}>
        <IconButton label="Reagir" className="size-7" onClick={onPicker} data-testid="dm-react">
          <Smile className="size-4" />
        </IconButton>
        <IconButton label="Responder" className="size-7" onClick={onReply} data-testid="dm-reply">
          <CornerUpLeft className="size-4" />
        </IconButton>
        {mine && (
          <>
            <IconButton label="Editar" className="size-7" onClick={() => onEdit({ id: message.id, text: message.content })} data-testid="dm-edit">
              <Pencil className="size-4" />
            </IconButton>
            <IconButton
              label="Apagar"
              className="size-7 hover:text-live-300"
              onClick={() => void dialogs.confirm({ title: 'Apagar esta mensagem?', message: 'Ela some para os dois.', confirmLabel: 'Apagar', tone: 'perigo', action: () => social.remove(message) })}
              data-testid="dm-delete"
            >
              <Trash2 className="size-4" />
            </IconButton>
          </>
        )}
      </div>
      {picker && <EmojiPicker className={cx('top-full z-30 mt-1', mine ? 'right-2' : 'left-2')} onPick={(emoji) => (toggle(emoji), onClosePicker())} onClose={onClosePicker} />}
    </article>
  );
}

/** Cartão de convite para um grupo dentro da conversa. */
function InviteMessage({ meta }: { meta: NonNullable<DmMessage['meta']> }) {
  const list = useStore(groups.store, (state) => state.groups);
  const joined = list.some((group) => group.id === meta.group.id);
  const expired = meta.expiresAt !== null && new Date(meta.expiresAt) <= new Date();
  const { busy, run } = useAction();
  return (
    <div className="mt-1 w-72 max-w-full rounded-xl border border-neon-400/40 bg-ink-900/80 p-3" data-testid="dm-invite-card">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wide text-neon-300 uppercase">
        <Ticket className="size-3.5" aria-hidden="true" /> Convite para um grupo
      </p>
      <div className="flex items-center gap-2.5">
        <GroupIcon group={meta.group} size={44} />
        <div className="min-w-0">
          <p className="truncate font-extrabold">{meta.group.name}</p>
          {meta.group.description && <p className="truncate text-xs text-fog-400">{meta.group.description}</p>}
          {meta.expiresAt && <p className="text-xs text-fog-500">{expired ? 'Convite vencido' : `Vale até ${new Date(meta.expiresAt).toLocaleDateString('pt-BR')}`}</p>}
        </div>
      </div>
      <Button
        variant={joined ? 'quiet' : 'primary'}
        className="mt-3 w-full"
        disabled={busy || (expired && !joined)}
        onClick={() =>
          void run(async () => {
            if (!joined) await groups.call('POST', `/api/invites/${meta.code}/accept`);
            await groups.refreshGroups();
            navigate(groupHash(meta.group.id));
          })
        }
        data-testid="dm-invite-join"
      >
        {joined ? 'Abrir o grupo' : (
          <>
            <UserCheck className="size-4" aria-hidden="true" /> Entrar no servidor
          </>
        )}
      </Button>
    </div>
  );
}
