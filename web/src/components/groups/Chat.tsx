import { messageLayout } from '../../lib/messages.ts';
import { Bell, BellOff, CornerUpLeft, Hash, Lock, Pencil, Pin, PinOff, Plus, Reply, SendHorizontal, Smile, SmilePlus, Trash2, Users, X } from 'lucide-react';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { has, P } from '../../../../shared/permissions.ts';
import { groups, type Attachment, type ChannelView, type ChatMessage, type GroupView, type MemberView, type NotifyLevel } from '../../lib/groups/client.ts';
import { UserTrigger } from '../social/UserInteractions.tsx';
import { dialogs } from '../../lib/dialogs.ts';
import { applyMention, insertAt, mentionQuery, splitMessage } from '../../lib/groups/text.ts';
import { isConfirmed, messageKey } from '../../lib/outbox.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar, Button, cx, emojiUrl, IconButton, Menu, MenuItem, MenuLabel, MotionSafeImage, Notice } from '../ui.tsx';
import { CosmeticName, DecoratedAvatar } from '../cosmetics/Decoration.tsx';
import { Attachments, formatBytes, kindOf } from './Attachments.tsx';
import { errorText, memberName, nameColor, useAction } from './common.tsx';
import { EmojiGlyph, EmojiPicker, QUICK_EMOJIS, type CustomEmoji } from './EmojiPicker.tsx';
import { MessageDelivery } from '../MessageDelivery.tsx';
import { compareIds, serverId } from '../../lib/messages.ts';

const MAX_ATTACHMENTS = 10;

export const NOTIFY_LABELS: Record<NotifyLevel, string> = { tudo: 'Todas as mensagens', mencoes: 'Só menções', nada: 'Nada (silenciado)' };

const clock = (iso: string): string => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

/** "Hoje às 21:14", "Ontem às 09:02" ou a data completa. */
function stamp(iso: string): string {
  const date = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((start.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `Hoje às ${clock(iso)}`;
  if (days === 1) return `Ontem às ${clock(iso)}`;
  return `${date.toLocaleDateString('pt-BR')} ${clock(iso)}`;
}

interface Upload {
  key: string;
  name: string;
  size: number;
  progress: number;
  /** Endereço local da prévia (só imagens). */
  preview: string | null;
  file: Attachment | null;
  error: string | null;
  cancel: () => void;
}

/** Texto da mensagem: links abrem fora, menções viram destaque e todo o resto é texto puro (nada de HTML). */
const Content = memo(function Content({ message, members, me, emojis }: { message: ChatMessage; members: Map<string, MemberView>; me: string; emojis: readonly CustomEmoji[] }) {
  const pieces = useMemo(
    () =>
      splitMessage(message.content, {
        mentionEveryone: message.mentionEveryone,
        mentions: message.mentions,
        lookup: (username) => {
          const member = members.get(username);
          return member ? { userId: member.userId, label: memberName(member) } : undefined;
        },
        emoji: (name) => emojis.find((item) => item.name === name),
      }),
    [message.content, message.mentionEveryone, message.mentions, members, emojis],
  );
  // Mensagem só de emojis do grupo: eles aparecem maiores.
  const onlyEmojis = pieces.length > 0 && pieces.every((piece) => piece.type === 'emoji' || (piece.type === 'texto' && !piece.text.trim()));
  if (!message.content) return null;
  return (
    <p className="text-[15px] leading-relaxed wrap-anywhere whitespace-pre-wrap text-fog-100">
      {pieces.map((piece, index) =>
        piece.type === 'link' ? (
          <a key={index} href={piece.text} target="_blank" rel="noreferrer noopener" className="text-neon-300 underline decoration-neon-400/50 underline-offset-2 hover:text-neon-200">
            {piece.text}
          </a>
        ) : piece.type === 'emoji' ? (
          <MotionSafeImage key={index} src={emojiUrl(piece.id)} alt={`:${piece.name}:`} className={cx('inline-block object-contain align-[-0.3em]', onlyEmojis ? 'size-12' : 'size-6')} />
        ) : piece.type === 'mencao' ? (
          <mark key={index} className={cx('rounded px-1 font-semibold', piece.userId === me || piece.userId === null ? 'bg-brand-500/45 text-white' : 'bg-brand-500/20 text-brand-200')} data-testid="mention">
            {piece.text}
          </mark>
        ) : (
          <Fragment key={index}>{piece.text}</Fragment>
        ),
      )}
    </p>
  );
});


/** Mensagens fixadas do canal, buscadas no servidor (inclui as antigas que não estão carregadas na tela). */
function PinsPanel({ channel, canUnpin, onJump, onClose }: { channel: ChannelView; canUnpin: boolean; onJump: (id: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<ChatMessage[] | null>(null);
  const { run } = useAction();
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(() => groups.pinned(channel.id).then(setItems, () => setItems([])), [channel.id]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const timer = setTimeout(() => document.addEventListener('pointerdown', onPointer), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="absolute top-full right-3 z-30 mt-2 w-[min(26rem,calc(100vw-2rem))] animate-rise rounded-2xl border border-brand-500/30 bg-ink-850 shadow-panel" data-testid="pins-panel">
      <header className="flex items-center gap-2 border-b border-ink-700 px-4 py-3">
        <Pin className="size-4 text-brand-300" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-extrabold">Mensagens fixadas</h2>
        <IconButton label="Fechar" className="size-7" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>
      <ul className="grid max-h-[60dvh] gap-2 overflow-y-auto p-3">
        {items === null && <li className="py-6 text-center text-sm text-fog-400">Carregando…</li>}
        {items?.length === 0 && <li className="py-6 text-center text-sm text-fog-400">Nenhuma mensagem fixada neste canal.</li>}
        {items?.map((message) => (
          <li key={message.id} className="rounded-xl border border-ink-700 bg-ink-800/70 p-3" data-testid="pinned-message">
            <p className="flex items-baseline gap-2 text-sm">
              <span className="truncate font-bold text-neon-300">{message.author.name}</span>
              <time className="shrink-0 text-xs text-fog-500">{stamp(message.createdAt)}</time>
            </p>
            <p className="mt-0.5 line-clamp-4 text-sm wrap-anywhere whitespace-pre-wrap text-fog-100">
              {message.content || (message.attachments.length > 0 ? `📎 ${message.attachments[0]!.name}` : '')}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  onJump(message.id);
                  onClose();
                }}
              >
                Ir para a mensagem
              </Button>
              {canUnpin && (
                <Button size="sm" variant="bare" onClick={() => void run(() => groups.pin(message.id, false)).then(load)}>
                  <PinOff className="size-4" aria-hidden="true" /> Desafixar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Chat({ view, channel, membersOpen, onToggleMembers }: { view: GroupView; channel: ChannelView; membersOpen?: boolean; onToggleMembers?: () => void }) {
  const state = useStore(groups.store, (store) => store.messages[channel.id]);
  const maxFileBytes = useStore(groups.store, (store) => store.maxFileBytes);
  const items = state?.items ?? [];
  const [draft, setDraft] = useState('');
  // "Mencionar" no menu de uma pessoa: põe @usuario na caixa de mensagem deste canal.
  useEffect(() => {
    const onMention = (event: Event) => {
      const username = (event as CustomEvent<string>).detail;
      if (typeof username !== 'string') return;
      setDraft((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${username} `);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]')?.focus());
    };
    window.addEventListener('cn:mention', onMention);
    return () => window.removeEventListener('cn:mention', onMention);
  }, []);
  const [caret, setCaret] = useState(0);
  const [suggestion, setSuggestion] = useState(0);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [picker, setPicker] = useState<{ id: string; up: boolean } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // Até onde a pessoa tinha lido ao abrir o canal: é onde entra a linha "novas mensagens".
  const [boundary] = useState<string | null>(() => view.unread[channel.id]?.read ?? null);
  const { busy, run } = useAction();
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  const restore = useRef<number | null>(null);
  const uploadsRef = useRef<Upload[]>([]);
  uploadsRef.current = uploads;
  const lastId = items.findLast(isConfirmed)?.id;
  const firstId = items[0]?.id;

  const me = view.me.userId;
  const perms = channel.permissions;
  const timedOut = view.me.timeoutUntil !== null && Date.parse(view.me.timeoutUntil) > Date.now();
  const canSend = has(perms, P.SEND_MESSAGES) && !timedOut;
  const canAttach = canSend && has(perms, P.ATTACH_FILES);
  const canReact = has(perms, P.ADD_REACTIONS) && !timedOut;
  const level = view.notify.channels[channel.id];

  const members = useMemo(() => new Map(view.members.map((member) => [member.userId, member])), [view.members]);
  const byUsername = useMemo(() => new Map(view.members.map((member) => [member.username.toLowerCase(), member])), [view.members]);

  useEffect(() => {
    groups.watchChannel(channel.id);
    if (!groups.messagesOf(channel.id).loaded) void groups.loadMessages(channel.id).catch(() => undefined);
    return () => {
      groups.watchChannel(null);
      // Saiu do canal com envio pela metade: cancela e solta as prévias.
      for (const upload of uploadsRef.current) {
        upload.cancel();
        if (upload.preview) URL.revokeObjectURL(upload.preview);
      }
    };
  }, [channel.id]);

  const markRead = useCallback(() => {
    // Só conta como lido o que está de fato na tela: conversa no fim, janela em foco e o chat visível (não
    // escondido atrás da lista de canais no celular, nem numa aba de fundo).
    const visible = (list.current?.getClientRects().length ?? 0) > 0;
    if (stick.current && visible && document.visibilityState === 'visible' && document.hasFocus()) groups.markRead(channel.id, lastId);
  }, [channel.id, lastId]);

  // Com a conversa no fim e a janela em foco, o que chega já conta como lido.
  useEffect(() => {
    markRead();
    window.addEventListener('focus', markRead);
    document.addEventListener('visibilitychange', markRead);
    return () => {
      window.removeEventListener('focus', markRead);
      document.removeEventListener('visibilitychange', markRead);
    };
  }, [markRead, state?.loaded]);

  // Mensagem nova com a conversa já no fim: acompanha. Se a pessoa subiu para ler, fica onde está.
  useLayoutEffect(() => {
    const element = list.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [lastId, state?.loaded, uploads.length, replyTo]);

  // Mensagens antigas entraram por cima: mantém na tela o que a pessoa estava lendo.
  useLayoutEffect(() => {
    const element = list.current;
    if (element && restore.current !== null) {
      element.scrollTop = element.scrollHeight - restore.current;
      restore.current = null;
    }
  }, [firstId]);

  const loadOlder = () => {
    const element = list.current;
    if (!element || !state?.loaded || state.complete || state.loading) return;
    stick.current = false;
    restore.current = element.scrollHeight - element.scrollTop;
    void groups.loadMessages(channel.id, true).catch(() => undefined);
  };

  const jump = useCallback((id: string) => {
    const target = list.current?.querySelector(`[data-id="${id}"]`);
    if (!target) return groups.notify('Essa mensagem é mais antiga. Suba a conversa para carregar as anteriores.');
    stick.current = false;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlash(id);
    setTimeout(() => setFlash((current) => (current === id ? null : current)), 1600);
  }, []);

  // --- Anexos ---------------------------------------------------------------------------------

  const patchUpload = (key: string, patch: Partial<Upload>) => setUploads((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (!canAttach) return groups.notify('Você não tem permissão para enviar arquivos neste canal.');
    const room = MAX_ATTACHMENTS - uploadsRef.current.length;
    if (files.length > room) groups.notify(`Cada mensagem leva no máximo ${MAX_ATTACHMENTS} arquivos.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      if (file.size === 0) {
        groups.notify(`“${file.name}” está vazio.`);
        continue;
      }
      if (file.size > maxFileBytes) {
        groups.notify(`“${file.name}” tem ${formatBytes(file.size)}. O limite é ${formatBytes(maxFileBytes)} por arquivo.`);
        continue;
      }
      const image = kindOf(file.type) === 'imagem';
      let size: { width: number; height: number } | null = null;
      if (image) {
        try {
          const bitmap = await createImageBitmap(file);
          size = { width: bitmap.width, height: bitmap.height };
          bitmap.close();
        } catch {
          // imagem que o navegador não decodifica: segue sem as medidas
        }
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const sending = groups.upload(channel.id, file, size, (progress) => patchUpload(key, { progress }));
      setUploads((current) => [...current, { key, name: file.name, size: file.size, progress: 0, preview: image ? URL.createObjectURL(file) : null, file: null, error: null, cancel: sending.cancel }]);
      sending.done.then(
        (attachment) => patchUpload(key, { file: attachment, progress: 1 }),
        (error) => patchUpload(key, { error: errorText(error, 'Não foi possível enviar.') }),
      );
    }
    input.current?.focus();
  };

  const removeUpload = (upload: Upload) => {
    upload.cancel();
    if (upload.preview) URL.revokeObjectURL(upload.preview);
    setUploads((current) => current.filter((item) => item.key !== upload.key));
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDropping(false);
    void addFiles([...event.dataTransfer.files]);
  };

  // --- Envio, menções e emojis ----------------------------------------------------------------

  const ready = uploads.filter((upload) => upload.file !== null);
  const uploading = uploads.some((upload) => upload.file === null && upload.error === null);

  const send = async () => {
    const content = draft.trim();
    if (busy || uploading || (!content && ready.length === 0)) return;
    stick.current = true;
    void groups.send(channel.id, content, { replyTo: replyTo?.id, attachments: ready.map((upload) => upload.file!.id), files: ready.map(upload => upload.file!) });
    for (const upload of uploads) if (upload.preview) URL.revokeObjectURL(upload.preview);
    setDraft('');
    setReplyTo(null);
    setUploads([]);
  };

  const query = mentionQuery(draft, caret);
  const suggestions = useMemo(() => {
    if (!query) return [];
    const found: { username: string; label: string; id: string | null }[] = view.members
      .filter((member) => member.username.toLowerCase().startsWith(query.query) || memberName(member).toLowerCase().includes(query.query))
      .slice(0, 6)
      .map((member) => ({ username: member.username, label: memberName(member), id: member.userId }));
    if (has(perms, P.MENTION_EVERYONE) && 'everyone'.startsWith(query.query)) found.push({ username: 'everyone', label: 'Avisar todo mundo do canal', id: null });
    return found;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query?.query, view.members, perms]);
  const chosen = Math.min(suggestion, Math.max(0, suggestions.length - 1));

  const moveCaret = (position: number) => {
    setCaret(position);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
    });
  };

  const complete = (username: string) => {
    if (!query) return;
    const next = applyMention(draft, caret, query.start, username);
    setDraft(next.text);
    moveCaret(next.caret);
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSuggestion((chosen + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        complete(suggestions[chosen]!.username);
        return;
      }
    }
    if (event.key === 'Escape' && replyTo) return setReplyTo(null);
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const toggleReaction = useCallback((message: ChatMessage, emoji: string) => {
    const mine = message.reactions.find((reaction) => reaction.emoji === emoji)?.users.includes(me) ?? false;
    void run(() => groups.react(message, emoji, !mine));
  }, [me, run]);

  const openPicker = useCallback((id: string, anchor: HTMLElement) => setPicker((current) => (current?.id === id ? null : { id, up: anchor.getBoundingClientRect().top > window.innerHeight / 2 })), []);

  const firstUnread = boundary === null ? undefined : items.find((message) => serverId(message.id) && compareIds(message.id, boundary) > 0 && message.author.id !== me)?.id;

  const rows = useMemo(() => items.map((message, index) => {
            const { newDay, grouped } = messageLayout(items[index - 1], message);
            const member = message.author.id ? members.get(message.author.id) : undefined;
            const own = message.author.id === me;
            const name = member ? memberName(member) : message.author.name;
            const mentioned = !own && (message.mentionEveryone || message.mentions.includes(me));
            const isEditing = editing?.id === message.id;
            return (
              <Fragment key={message.clientId ?? message.id}>
                {newDay && (
                  <li className="my-3 flex items-center gap-3 text-xs font-bold text-fog-500" aria-label={day(message.createdAt)}>
                    <span className="h-px flex-1 bg-ink-700" />
                    {day(message.createdAt)}
                    <span className="h-px flex-1 bg-ink-700" />
                  </li>
                )}
                {message.id === firstUnread && (
                  <li className="my-1 flex items-center gap-3 text-xs font-extrabold text-live-300" data-testid="unread-divider">
                    <span className="h-px flex-1 bg-live-500/60" />
                    Novas mensagens
                  </li>
                )}
                <li
                  data-testid="chat-message"
                  data-grouped={grouped}
                  data-id={message.id}
                  data-author={message.author.username ?? ''}
                  data-delivery={message.delivery ?? 'sent'}
                  data-mentioned={mentioned}
                  className={cx(
                    'group relative flex gap-3 rounded-lg px-2 py-0.5 transition-colors hover:bg-white/[0.035]',
                    !grouped && 'mt-2.5',
                    mentioned && 'bg-brand-500/10 shadow-[inset_3px_0_0_var(--color-brand-400)]',
                    flash === message.id && 'bg-neon-400/15',
                  )}
                >
                  <div className="w-10 shrink-0 pt-0.5">
                    {grouped ? (
                      <span className="hidden text-[11px] leading-6 text-fog-500 group-hover:block">{clock(message.createdAt)}</span>
                    ) : (
                      <span className={cx('block', message.reply && 'mt-5')}>
                        <UserTrigger userId={message.author.id}>
                          <DecoratedAvatar userId={message.author.id ?? message.author.name} name={name} size={40} image={member?.avatar} />
                        </UserTrigger>
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {message.reply && (
                      <button type="button" className="mb-0.5 flex max-w-full items-center gap-1.5 text-left text-[13px] text-fog-400 hover:text-fog-100" onClick={() => jump(message.reply!.id)} data-testid="reply-reference">
                        <CornerUpLeft className="size-3.5 shrink-0 text-brand-300" aria-hidden="true" />
                        <span className="shrink-0 font-bold text-brand-200">{message.reply.authorId ? memberName(members.get(message.reply.authorId) ?? { nickname: null, displayName: message.reply.authorName }) : message.reply.authorName}</span>
                        <span className="truncate">{message.reply.excerpt || 'enviou um arquivo'}</span>
                      </button>
                    )}
                    {!grouped && (
                      <p className="flex items-baseline gap-2">
                        <UserTrigger userId={message.author.id} className="min-w-0 truncate">
                          <span className="truncate font-bold text-neon-300 hover:underline" style={{ color: member ? nameColor(view, member) : undefined }} data-testid="chat-author">
                            <CosmeticName userId={message.author.id}>{name}</CosmeticName>
                          </span>
                        </UserTrigger>
                        {message.author.bot && <span className="shrink-0 rounded bg-brand-500 px-1 text-[10px] leading-4 font-extrabold text-on-accent">BOT</span>}
                        <time className="shrink-0 text-xs text-fog-500" dateTime={message.createdAt}>
                          {stamp(message.createdAt)}
                        </time>
                      </p>
                    )}
                    {isEditing ? (
                      <form
                        className="grid gap-2 py-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const text = editing.text.trim();
                          if (text || message.attachments.length > 0) void run(() => groups.edit(message.id, text)).then((done) => done && setEditing(null));
                        }}
                      >
                        <textarea
                          autoFocus
                          aria-label="Editar mensagem"
                          value={editing.text}
                          maxLength={4000}
                          rows={Math.min(8, editing.text.split('\n').length + 1)}
                          onChange={(event) => setEditing({ id: message.id, text: event.target.value })}
                          onKeyDown={(event) => event.key === 'Escape' && setEditing(null)}
                          className="w-full resize-none rounded-lg border border-brand-400 bg-ink-900/80 px-3 py-2 text-[15px] outline-none"
                        />
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" variant="primary" disabled={busy}>
                            Salvar
                          </Button>
                          <Button size="sm" onClick={() => setEditing(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <>
                        {message.author.bot && message.meta?.style === 'destaque' ? (
                          <Highlight by={message.meta.highlightOf}>
                            <Content message={message} members={byUsername} me={me} emojis={view.emojis ?? []} />
                          </Highlight>
                        ) : (
                          <Content message={message} members={byUsername} me={me} emojis={view.emojis ?? []} />
                        )}
                        {message.author.bot && message.meta?.effect && <ChatEffect effect={message.meta.effect} />}
                        <Attachments files={message.attachments} />
                        {message.meta?.buttons && message.meta.buttons.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-2" data-testid="bot-buttons">
                            {message.meta.buttons.map((button) => (
                              <Button key={button.command} size="sm" variant={button.style === 'perigo' ? 'danger' : button.style === 'primario' ? 'primary' : 'quiet'} disabled={!canSend || busy} onClick={() => void run(() => groups.send(channel.id, button.command))}>
                                {button.label}
                              </Button>
                            ))}
                          </div>
                        )}
                        {(message.editedAt || message.pinned) && (
                          <p className="flex items-center gap-2 text-xs text-fog-500">
                            {message.pinned && (
                              <span className="inline-flex items-center gap-1 text-brand-300">
                                <Pin className="size-3" aria-hidden="true" /> fixada
                              </span>
                            )}
                            {message.editedAt && <span title={new Date(message.editedAt).toLocaleString('pt-BR')}>editada</span>}
                          </p>
                        )}
                        {message.reactions.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1.5" data-testid="reactions">
                            {message.reactions.map((reaction) => {
                              const mine = reaction.users.includes(me);
                              return (
                                <button
                                  key={reaction.emoji}
                                  type="button"
                                  disabled={!canReact && !mine}
                                  aria-pressed={mine}
                                  title={reaction.users.map((id) => (members.get(id) ? memberName(members.get(id)!) : 'alguém')).join(', ')}
                                  onClick={() => toggleReaction(message, reaction.emoji)}
                                  className={cx(
                                    'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-sm font-bold transition-colors',
                                    mine ? 'border-brand-400 bg-brand-500/25 text-white shadow-glow' : 'border-ink-600 bg-ink-800 text-fog-300 hover:border-brand-400/60',
                                  )}
                                  data-testid="reaction"
                                  data-emoji={reaction.emoji}
                                >
                                  <span className="flex size-5 items-center justify-center text-base leading-none">
                                    <EmojiGlyph emoji={reaction.emoji} custom={view.emojis} size={16} />
                                  </span>
                                  <span data-testid="reaction-count">{reaction.users.length}</span>
                                </button>
                              );
                    })}
                            {canReact && (
                              <button type="button" aria-label="Adicionar reação" className="inline-flex size-7 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-fog-400 hover:border-brand-400/60 hover:text-white" onClick={(event) => openPicker(message.id, event.currentTarget)}>
                                <SmilePlus className="size-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  <MessageDelivery message={message} retry={id => groups.retry(id)} />
                  </div>
                  {!isEditing && !message.delivery?.match(/sending|failed/) && (
                    <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-lg border border-ink-600 bg-ink-800 p-0.5 shadow-panel group-focus-within:flex group-hover:flex [@media(hover:none)]:static [@media(hover:none)]:flex [@media(hover:none)]:border-0 [@media(hover:none)]:bg-transparent [@media(hover:none)]:shadow-none" data-testid="message-actions">
                      {canReact && (
                        <>
                          {QUICK_EMOJIS.map((emoji) => (
                            <button key={emoji} type="button" aria-label={`Reagir com ${emoji}`} className="hidden size-8 items-center justify-center rounded-lg text-lg leading-none hover:bg-white/10 xl:flex" onClick={() => toggleReaction(message, emoji)} data-testid="quick-reaction" data-emoji={emoji}>
                              {emoji}
                            </button>
                          ))}
                          <IconButton label="Reagir" className="size-8" onClick={(event) => openPicker(message.id, event.currentTarget)} data-testid="chat-react">
                            <Smile className="size-4" />
                          </IconButton>
                        </>
                      )}
                      {canSend && (
                        <IconButton
                          label="Responder"
                          className="size-8"
                          onClick={() => {
                            setReplyTo(message);
                            input.current?.focus();
                          }}
                          data-testid="chat-reply"
                        >
                          <Reply className="size-4" />
                        </IconButton>
                      )}
                      {has(perms, P.PIN_MESSAGES) && (
                        <IconButton label={message.pinned ? 'Desafixar' : 'Fixar'} className="size-8" onClick={() => void run(() => groups.pin(message.id, !message.pinned))} data-testid="chat-pin">
                          {message.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                        </IconButton>
                      )}
                      {own && canSend && (
                        <IconButton label="Editar" className="size-8" onClick={() => setEditing({ id: message.id, text: message.content })} data-testid="chat-edit">
                          <Pencil className="size-4" />
                        </IconButton>
                      )}
                      {(own || has(perms, P.DELETE_MESSAGES)) && (
                        <IconButton label="Apagar" className="size-8 hover:text-live-300" data-testid="chat-delete" onClick={() =>
                            void dialogs.confirm({
                              title: 'Apagar esta mensagem?',
                              message: 'Ela some para todos no canal.',
                              confirmLabel: 'Apagar',
                              tone: 'perigo',
                              action: () => groups.remove(message),
                            })
                          }>
                          <Trash2 className="size-4" />
                        </IconButton>
                      )}
                    </div>
                  )}
                  {picker?.id === message.id && <EmojiPicker className={cx('right-2', picker.up ? 'bottom-full mb-1' : 'top-full mt-1')} custom={view.emojis} onPick={(emoji) => toggleReaction(message, emoji)} onClose={() => setPicker(null)} />}
                </li>
              </Fragment>
            );
  }), [items, members, byUsername, me, editing, picker, flash, firstUnread, canReact, canSend, perms, busy, channel.id, view.roles, view.emojis, run, jump, openPicker, toggleReaction]);

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="chat"
      data-channel={channel.id}
      onDragOver={(event) => {
        if (!canAttach || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => event.currentTarget === event.target && setDropping(false)}
      onDrop={onDrop}
    >
      <header className="relative flex shrink-0 items-center gap-3 border-b border-brand-500/15 px-4 py-3">
        {channel.private ? <Lock className="size-5 shrink-0 text-fog-400" aria-label="Canal privado" /> : <Hash className="size-5 shrink-0 text-fog-400" aria-hidden="true" />}
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="truncate text-lg leading-tight font-extrabold" data-testid="chat-title">
            {channel.name}
          </h1>
          {channel.topic && <p className="hidden min-w-0 truncate border-l border-ink-600 pl-3 text-sm text-fog-400 sm:block">{channel.topic}</p>}
        </div>
        <IconButton label="Mensagens fixadas" className={cx(pinsOpen && 'bg-brand-500/20 text-white')} onClick={() => setPinsOpen((value) => !value)} data-testid="chat-pins">
          <Pin className="size-5" />
        </IconButton>
        <Menu
          side="bottom"
          align="end"
          trigger={({ toggle }) => (
            <IconButton label="Notificações deste canal" onClick={toggle} data-testid="chat-notify">
              {(level ?? view.notify.level) === 'nada' ? <BellOff className="size-5" /> : <Bell className={cx('size-5', level && 'text-neon-300')} />}
            </IconButton>
          )}
        >
          {(close) => (
            <div className="w-64">
              <MenuLabel>Avisar sobre #{channel.name}</MenuLabel>
              <MenuItem selected={level === undefined} hint={NOTIFY_LABELS[view.notify.level]} onClick={() => (close(), void run(() => groups.setNotify(view.group.id, null, channel.id)))} data-testid="notify-herdar">
                Seguir o grupo
              </MenuItem>
              {(Object.keys(NOTIFY_LABELS) as NotifyLevel[]).map((value) => (
                <MenuItem key={value} selected={level === value} onClick={() => (close(), void run(() => groups.setNotify(view.group.id, value, channel.id)))} data-testid={`notify-${value}`}>
                  {NOTIFY_LABELS[value]}
                </MenuItem>
              ))}
            </div>
          )}
        </Menu>
        {onToggleMembers && (
          <IconButton label={membersOpen ? 'Esconder a lista de membros' : 'Mostrar a lista de membros'} className={cx(membersOpen && 'bg-brand-500/20 text-white')} onClick={onToggleMembers} data-testid="toggle-members">
            <Users className="size-5" />
          </IconButton>
        )}
        {pinsOpen && <PinsPanel channel={channel} canUnpin={has(perms, P.PIN_MESSAGES)} onJump={jump} onClose={() => setPinsOpen(false)} />}
      </header>

      <div
        ref={list}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 py-3 sm:px-4"
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          if (stick.current) markRead();
          if (element.scrollTop < 120) loadOlder();
        }}
        data-testid="chat-messages"
      >
        {state?.loaded && !state.complete && (
          <div className="mb-3 flex justify-center">
            <Button size="sm" variant="outline" disabled={state.loading} onClick={loadOlder}>
              {state.loading ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </Button>
          </div>
        )}
        {state?.loaded && state.complete && (
          <div className="mb-4 px-2 pt-6">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-500/20 text-brand-200">
              <Hash className="size-8" aria-hidden="true" />
            </span>
            <p className="mt-3 text-2xl font-extrabold">Este é o começo de #{channel.name}</p>
            <p className="text-fog-400">{items.length === 0 ? 'Ninguém escreveu ainda. Diga oi.' : (channel.topic || 'Tudo o que foi dito neste canal está aqui embaixo.')}</p>
          </div>
        )}
        {!state?.loaded && <p className="py-10 text-center text-fog-400">Carregando a conversa…</p>}

        <ol className="grid gap-0.5">
          {rows}

        </ol>
      </div>

      <footer className="relative shrink-0 px-2 pb-3 sm:px-4 sm:pb-4">
        {canSend ? (
          <>
            {suggestions.length > 0 && (
              <ul className="absolute right-4 bottom-full left-4 z-20 mb-1 grid gap-0.5 rounded-xl border border-brand-500/30 bg-ink-850 p-1.5 shadow-panel" role="listbox" aria-label="Mencionar" data-testid="mention-list">
                {suggestions.map((item, index) => (
                  <li key={item.username}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === chosen}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        complete(item.username);
                      }}
                      className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm', index === chosen ? 'bg-brand-500/25 text-white' : 'text-fog-300 hover:bg-ink-700')}
                      data-testid="mention-option"
                    >
                      {item.id ? <Avatar id={item.id} name={item.label} size={24} /> : <span className="flex size-6 items-center justify-center rounded-full bg-brand-500/30 text-xs font-extrabold">@</span>}
                      <span className="truncate font-bold">{item.id ? item.label : '@everyone'}</span>
                      <span className="truncate text-xs text-fog-500">{item.id ? `@${item.username}` : item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="rounded-2xl border border-brand-500/20 bg-ink-800/80 transition-colors focus-within:border-brand-400 focus-within:shadow-glow">
              {replyTo && (
                <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-1.5 text-sm text-fog-300" data-testid="reply-banner">
                  <CornerUpLeft className="size-4 shrink-0 text-brand-300" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    Respondendo a <b className="text-fog-100">{replyTo.author.id && members.get(replyTo.author.id) ? memberName(members.get(replyTo.author.id)!) : replyTo.author.name}</b>
                    <span className="text-fog-500"> — {replyTo.content.slice(0, 80) || 'arquivo'}</span>
                  </span>
                  <IconButton label="Cancelar a resposta" className="size-7" onClick={() => setReplyTo(null)}>
                    <X className="size-4" />
                  </IconButton>
                </div>
              )}
              {uploads.length > 0 && (
                <ul className="flex flex-wrap gap-2 border-b border-ink-700 p-2.5" data-testid="uploads">
                  {uploads.map((upload) => (
                    <li key={upload.key} className={cx('relative flex w-36 flex-col overflow-hidden rounded-xl border bg-ink-850', upload.error ? 'border-live-500/70' : 'border-ink-600')} data-testid="upload" data-ready={upload.file !== null} data-name={upload.name}>
                      <div className="flex h-20 items-center justify-center bg-ink-900">
                        {upload.preview ? <img src={upload.preview} alt="" className="size-full object-cover" /> : <span className="px-2 text-center text-xs font-bold break-all text-brand-200">{upload.name.split('.').pop()?.toUpperCase().slice(0, 6)}</span>}
                      </div>
                      <p className="truncate px-2 pt-1 text-xs font-semibold" title={upload.name}>
                        {upload.name}
                      </p>
                      <p className={cx('truncate px-2 pb-1.5 text-[11px]', upload.error ? 'text-live-300' : 'text-fog-500')} title={upload.error ?? undefined}>
                        {upload.error ?? (upload.file ? formatBytes(upload.size) : `Enviando… ${Math.round(upload.progress * 100)}%`)}
                      </p>
                      {!upload.file && !upload.error && <span className="absolute bottom-0 left-0 h-0.5 bg-neon-400 transition-[width]" style={{ width: `${upload.progress * 100}%` }} />}
                      <button type="button" aria-label={`Remover ${upload.name}`} onClick={() => removeUpload(upload)} className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-ink-950/80 text-fog-100 hover:bg-live-600">
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-end gap-1.5 p-2">
                {canAttach && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      multiple
                      hidden
                      onChange={(event) => {
                        void addFiles([...(event.target.files ?? [])]);
                        event.target.value = '';
                      }}
                      data-testid="chat-file"
                    />
                    <IconButton label="Anexar arquivos" className="size-10 rounded-xl bg-ink-750" onClick={() => fileInput.current?.click()} data-testid="chat-attach">
                      <Plus className="size-5" />
                    </IconButton>
                  </>
                )}
                <textarea
                  ref={input}
                  aria-label={`Mensagem para #${channel.name}`}
                  placeholder={`Conversar em #${channel.name}`}
                  value={draft}
                  maxLength={4000}
                  rows={Math.min(6, draft.split('\n').length)}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setCaret(event.target.selectionStart);
                    setSuggestion(0);
                  }}
                  onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
                  onKeyDown={onKey}
                  onPaste={onPaste}
                  className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-fog-500"
                  data-testid="chat-input"
                />
                <div className="relative">
                  <IconButton label="Emojis" className="size-10" onClick={(event) => openPicker('compositor', event.currentTarget)} data-testid="chat-emoji">
                    <Smile className="size-5" />
                  </IconButton>
                  {picker?.id === 'compositor' && (
                    <EmojiPicker
                      className="right-0 bottom-full mb-2"
                      custom={view.emojis}
                      onClose={() => setPicker(null)}
                      onPick={(emoji) => {
                        const element = input.current;
                        const next = insertAt(draft, element?.selectionStart ?? draft.length, element?.selectionEnd ?? draft.length, emoji);
                        setDraft(next.text);
                        moveCaret(next.caret);
                      }}
                    />
                  )}
                </div>
                <Button variant="neon" size="sm" className="h-10 w-11 rounded-xl px-0" disabled={busy || uploading || (!draft.trim() && ready.length === 0)} onClick={() => void send()} data-testid="chat-send" aria-label="Enviar mensagem">
                  <SendHorizontal className="size-5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Notice data-testid="chat-readonly">
            {timedOut ? 'Você está de castigo neste grupo: pode ler, mas não escrever por enquanto.' : 'Você pode ler este canal, mas não tem permissão para enviar mensagens nele.'}
          </Notice>
        )}
      </footer>

      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-neon-400 bg-ink-950/80 text-lg font-extrabold text-neon-200" data-testid="drop-zone">
          Solte para anexar em #{channel.name}
        </div>
      )}
    </section>
  );
}

/** Mensagem em destaque (Destaques Cósmicos): moldura em gradiente e quem pediu. */
function Highlight({ by, children }: { by?: string; children: React.ReactNode }) {
  return (
    <div className="mt-0.5 max-w-xl rounded-xl bg-linear-to-r from-brand-500/60 via-neon-500/50 to-brand-500/60 p-px" data-testid="chat-highlight">
      <div className="rounded-[11px] bg-ink-900/95 px-3 py-2">
        <p className="mb-0.5 text-[11px] font-extrabold tracking-wide text-neon-300 uppercase">✦ Destaque{by ? ` de ${by}` : ''}</p>
        <div className="text-[15px]">{children}</div>
      </div>
    </div>
  );
}

/** Efeito visual de uma vez (confete, estrelas, aurora). Some sozinho e não toca com as animações reduzidas. */
function ChatEffect({ effect }: { effect: 'confete' | 'estrelas' | 'aurora' }) {
  const colors = effect === 'aurora' ? ['#7ff0c0', '#3fdcff', '#b79dff'] : effect === 'estrelas' ? ['#ffd98a', '#ffffff', '#82e9ff'] : ['#ff8aa6', '#ffc65c', '#3fdcff', '#9873ff'];
  return (
    <div className="pointer-events-none relative h-8 overflow-visible" aria-hidden="true" data-testid="chat-effect" data-effect={effect}>
      {Array.from({ length: 14 }, (_, index) => (
        <span
          key={index}
          className="cn-chat-particle absolute top-6"
          style={{ left: `${4 + index * 6.5}%`, background: colors[index % colors.length], animationDelay: `${(index % 5) * 70}ms`, borderRadius: effect === 'confete' ? 2 : 999, width: effect === 'aurora' ? 18 : 6, height: effect === 'aurora' ? 4 : 6 }}
        />
      ))}
    </div>
  );
}
