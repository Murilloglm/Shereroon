import { Hash, Lock, Pencil, Pin, PinOff, Send, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { has, P } from '../../../../shared/permissions.ts';
import { groups, type ChannelView, type ChatMessage, type GroupView } from '../../lib/groups/client.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar, Button, cx, IconButton, Notice } from '../ui.tsx';
import { nameColor, useAction } from './common.tsx';

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;

/** Texto da mensagem: endereços http(s) viram links que abrem fora; o resto é texto puro (nada de HTML). */
function Content({ message }: { message: ChatMessage }) {
  const parts: ReactNode[] = [];
  for (const [index, piece] of message.content.split(URL_PATTERN).entries()) {
    if (index % 2 === 1) {
      parts.push(
        <a key={index} href={piece} target="_blank" rel="noreferrer noopener" className="text-brand-200 underline decoration-brand-400/50 underline-offset-2 hover:text-brand-100">
          {piece}
        </a>,
      );
    } else if (message.mentionEveryone) {
      parts.push(
        <Fragment key={index}>
          {piece.split(/(@everyone\b)/).map((chunk, at) =>
            chunk === '@everyone' ? (
              <mark key={at} className="rounded bg-brand-500/30 px-1 font-semibold text-brand-100">
                @everyone
              </mark>
            ) : (
              chunk
            ),
          )}
        </Fragment>,
      );
    } else {
      parts.push(piece);
    }
  }
  return <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-fog-100">{parts}</p>;
}

const clock = (iso: string): string => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

export function Chat({ view, channel }: { view: GroupView; channel: ChannelView }) {
  const state = useStore(groups.store, (store) => store.messages[channel.id]);
  const items = state?.items ?? [];
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [onlyPinned, setOnlyPinned] = useState(false);
  const { busy, run } = useAction();
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastId = items.at(-1)?.id;

  const perms = channel.permissions;
  const timedOut = view.me.timeoutUntil !== null && Date.parse(view.me.timeoutUntil) > Date.now();
  const canSend = has(perms, P.SEND_MESSAGES) && !timedOut;

  useEffect(() => {
    groups.watchChannel(channel.id);
    setDraft('');
    setEditing(null);
    setOnlyPinned(false);
    stick.current = true;
    if (!groups.messagesOf(channel.id).loaded) void groups.loadMessages(channel.id).catch(() => undefined);
    return () => groups.watchChannel(null);
  }, [channel.id]);

  // Mensagem nova com a conversa já no fim: acompanha. Se a pessoa subiu para ler, fica onde está.
  useLayoutEffect(() => {
    const element = list.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [lastId, state?.loaded, onlyPinned]);

  const send = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    stick.current = true;
    if (await run(() => groups.send(channel.id, content))) setDraft('');
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const shown = onlyPinned ? items.filter((message) => message.pinned) : items;
  const members = new Map(view.members.map((member) => [member.userId, member]));

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="chat" data-channel={channel.id}>
      <header className="flex shrink-0 items-center gap-3 border-b border-ink-700/80 px-4 py-3">
        {channel.private ? <Lock className="size-5 shrink-0 text-fog-400" aria-label="Canal privado" /> : <Hash className="size-5 shrink-0 text-fog-400" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg leading-tight font-extrabold" data-testid="chat-title">
            {channel.name}
          </h1>
          {channel.topic && <p className="truncate text-sm text-fog-400">{channel.topic}</p>}
        </div>
        <Button size="sm" active={onlyPinned} onClick={() => setOnlyPinned((value) => !value)} data-testid="chat-pins">
          <Pin className="size-4" aria-hidden="true" />
          Fixadas
        </Button>
      </header>

      <div
        ref={list}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        data-testid="chat-messages"
      >
        {!onlyPinned && state?.loaded && !state.complete && (
          <div className="mb-3 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              disabled={state.loading}
              onClick={() => {
                stick.current = false;
                void groups.loadMessages(channel.id, true).catch(() => undefined);
              }}
            >
              {state.loading ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </Button>
          </div>
        )}
        {state?.loaded && shown.length === 0 && (
          <p className="py-10 text-center text-fog-400">{onlyPinned ? 'Nenhuma mensagem fixada neste canal.' : `Este é o começo de #${channel.name}. Diga oi.`}</p>
        )}
        {!state?.loaded && <p className="py-10 text-center text-fog-400">Carregando a conversa…</p>}

        <ol className="grid gap-0.5">
          {shown.map((message, index) => {
            const previous = shown[index - 1];
            const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
            const grouped =
              !newDay && previous!.author.id === message.author.id && message.author.id !== null && Date.parse(message.createdAt) - Date.parse(previous!.createdAt) < 5 * 60_000;
            const member = message.author.id ? members.get(message.author.id) : undefined;
            const own = message.author.id === view.me.userId;
            const name = member ? member.nickname || member.displayName : message.author.name;
            return (
              <Fragment key={message.id}>
                {newDay && (
                  <li className="my-3 flex items-center gap-3 text-xs font-bold text-fog-500" aria-label={day(message.createdAt)}>
                    <span className="h-px flex-1 bg-ink-700" />
                    {day(message.createdAt)}
                    <span className="h-px flex-1 bg-ink-700" />
                  </li>
                )}
                <li
                  data-testid="chat-message"
                  data-id={message.id}
                  data-author={message.author.username ?? ''}
                  className={cx('group relative flex gap-3 rounded-lg px-2 py-0.5 hover:bg-ink-800/70', !grouped && 'mt-2.5', message.mentionEveryone && 'bg-brand-500/10')}
                >
                  <div className="w-10 shrink-0 pt-0.5">
                    {grouped ? (
                      <span className="hidden text-[11px] leading-6 text-fog-500 group-hover:block">{clock(message.createdAt)}</span>
                    ) : (
                      <Avatar id={message.author.id ?? message.author.name} name={name} size={40} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {!grouped && (
                      <p className="flex items-baseline gap-2">
                        <span className="truncate font-bold" style={{ color: member ? nameColor(view, member) : undefined }} data-testid="chat-author">
                          {name}
                        </span>
                        <time className="shrink-0 text-xs text-fog-500" dateTime={message.createdAt}>
                          {clock(message.createdAt)}
                        </time>
                      </p>
                    )}
                    {editing?.id === message.id ? (
                      <form
                        className="grid gap-2 py-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const text = editing.text.trim();
                          if (text) void run(() => groups.edit(message.id, text)).then((done) => done && setEditing(null));
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
                        <Content message={message} />
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
                      </>
                    )}
                  </div>
                  {editing?.id !== message.id && (own || has(perms, P.DELETE_MESSAGES) || has(perms, P.PIN_MESSAGES)) && (
                    <div className="absolute -top-3 right-2 hidden gap-0.5 rounded-lg border border-ink-600 bg-ink-800 p-0.5 shadow-panel group-focus-within:flex group-hover:flex [@media(hover:none)]:static [@media(hover:none)]:flex [@media(hover:none)]:border-0 [@media(hover:none)]:bg-transparent [@media(hover:none)]:shadow-none">
                      {has(perms, P.PIN_MESSAGES) && (
                        <IconButton label={message.pinned ? 'Desafixar' : 'Fixar'} className="size-8" onClick={() => void run(() => groups.pin(message.id, !message.pinned))}>
                          {message.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                        </IconButton>
                      )}
                      {own && canSend && (
                        <IconButton label="Editar" className="size-8" onClick={() => setEditing({ id: message.id, text: message.content })}>
                          <Pencil className="size-4" />
                        </IconButton>
                      )}
                      {(own || has(perms, P.DELETE_MESSAGES)) && (
                        <IconButton
                          label="Apagar"
                          className="size-8 hover:text-live-300"
                          data-testid="chat-delete"
                          onClick={() => window.confirm('Apagar esta mensagem?') && void run(() => groups.remove(message))}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      )}
                    </div>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>

      <footer className="shrink-0 px-4 pb-4">
        {canSend ? (
          <div className="flex items-end gap-2 rounded-2xl border border-ink-600 bg-ink-800/80 p-2 focus-within:border-brand-400">
            <textarea
              aria-label={`Mensagem para #${channel.name}`}
              placeholder={`Conversar em #${channel.name}`}
              value={draft}
              maxLength={4000}
              rows={Math.min(6, draft.split('\n').length)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKey}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-fog-500"
              data-testid="chat-input"
            />
            <Button variant="primary" size="sm" className="h-10" disabled={busy || !draft.trim()} onClick={() => void send()} data-testid="chat-send" aria-label="Enviar mensagem">
              <Send className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <Notice data-testid="chat-readonly">
            {timedOut ? 'Você está de castigo neste grupo: pode ler, mas não escrever por enquanto.' : 'Você pode ler este canal, mas não tem permissão para enviar mensagens nele.'}
          </Notice>
        )}
      </footer>
    </section>
  );
}
