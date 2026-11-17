import { CircleCheck, CircleHelp, CircleX, LoaderCircle, PencilLine, TriangleAlert, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { dialogQueue, errorMessage, settle, typedNameMatches, validatePrompt, type DialogRequest } from '../lib/dialogs.ts';
import { useStore } from '../lib/store.ts';
import { cx, LogoMark } from './ui.tsx';

const EXIT_MS = 150;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Desenha a fila de diálogos (um por vez) sobre o app. Enquanto um diálogo está aberto o resto da página
 * fica inerte: não recebe clique, foco nem leitura de tela. Ao fechar, o foco volta para onde estava.
 */
export function DialogHost() {
  const current = useStore(dialogQueue, (state) => state.queue[0] ?? null);
  const open = current !== null;
  const lastFocus = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const root = document.getElementById('root');
    if (open) {
      // O filho já pôs o foco dentro do diálogo; volta-se para quem estava com o foco quando ele foi pedido.
      if (!lastFocus.current) lastFocus.current = current?.opener ?? null;
      root?.setAttribute('inert', '');
      return;
    }
    root?.removeAttribute('inert');
    const target = lastFocus.current;
    lastFocus.current = null;
    if (target?.isConnected) target.focus();
  }, [open]);

  return current ? createPortal(<DialogView key={current.id} request={current} />, document.body) : null;
}

function KindIcon({ kind }: { kind: DialogRequest['kind'] }) {
  const common = 'size-6';
  const icon =
    kind === 'excluir' || kind === 'erro' ? (
      kind === 'erro' ? <CircleX className={common} /> : <TriangleAlert className={common} />
    ) : kind === 'aviso' ? (
      <TriangleAlert className={common} />
    ) : kind === 'sucesso' ? (
      <CircleCheck className={common} />
    ) : kind === 'entrada' ? (
      <PencilLine className={common} />
    ) : (
      <CircleHelp className={common} />
    );
  return (
    <span className="cn-dialog-icon" data-tone={kind === 'excluir' || kind === 'erro' ? 'perigo' : kind === 'aviso' ? 'aviso' : kind === 'sucesso' ? 'ok' : 'info'} aria-hidden="true">
      {icon}
    </span>
  );
}

/** Céu do cabeçalho: algumas estrelas e um planeta, desenhados aqui (nada de imagem externa). */
function HeaderSky() {
  return (
    <svg className="cn-dialog-sky" viewBox="0 0 320 64" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="cn-planet" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#8f7bff" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#4B348E" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#07090D" stopOpacity="0" />
        </radialGradient>
      </defs>
      {[
        [30, 14, 0.9],
        [62, 40, 0.6],
        [104, 18, 0.8],
        [140, 48, 0.5],
        [176, 12, 0.7],
        [210, 34, 0.9],
        [236, 8, 0.5],
        [118, 30, 0.4],
      ].map(([x, y, o]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={o! > 0.7 ? 1.1 : 0.8} fill="#F4F8FF" opacity={o} />
      ))}
      <circle cx="290" cy="70" r="46" fill="url(#cn-planet)" />
      <path d="M244 70a46 46 0 0 1 92 0" fill="none" stroke="#74D7FF" strokeOpacity="0.35" strokeWidth="1" />
    </svg>
  );
}

function DialogView({ request }: { request: DialogRequest }) {
  const { kind, options } = request;
  const titleId = useId();
  const messageId = useId();
  const fieldId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [value, setValue] = useState(kind === 'entrada' ? (request.options.defaultValue ?? '') : '');
  const [touched, setTouched] = useState(false);
  const done = useRef(false);

  const alertLike = kind === 'aviso' || kind === 'erro' || kind === 'sucesso';
  const remove = kind === 'excluir' ? request.options : null;
  const prompt = kind === 'entrada' ? request.options : null;
  const typed = remove?.irreversible === true;
  const fieldError = prompt ? validatePrompt(prompt, value) : null;
  // Só a exclusão irreversível trava o botão (até o nome bater). No campo de texto o botão fica ativo e o erro
  // aparece ao tentar enviar: com o botão desligado, o Enter não envia e a pessoa não descobre o que falta.
  const blocked = typed && !typedNameMatches(remove!.item, value);

  const finish = (result: unknown) => {
    if (done.current) return;
    done.current = true;
    if (reducedMotion()) {
      settle(request.id, result);
      return;
    }
    setClosing(true);
    setTimeout(() => settle(request.id, result), EXIT_MS);
  };

  const cancel = () => {
    if (busy) return;
    finish(kind === 'entrada' ? null : alertLike ? undefined : false);
  };

  const confirm = async () => {
    if (busy || done.current) return;
    if (alertLike) {
      finish(undefined);
      return;
    }
    if (prompt) {
      setTouched(true);
      if (fieldError) {
        inputRef.current?.focus();
        return;
      }
    }
    if (blocked) return;
    const result = prompt ? value.trim() : true;
    const action = kind === 'entrada' ? request.options.action : kind === 'confirmar' || kind === 'excluir' ? request.options.action : undefined;
    if (!action) {
      finish(result);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await (action as (value?: string) => unknown)(prompt ? (result as string) : undefined);
      setBusy(false);
      finish(result);
    } catch (error) {
      setBusy(false);
      setFailure(errorMessage(error));
    }
  };

  // Foco inicial: o campo de texto, ou o botão mais seguro numa ação destrutiva.
  useLayoutEffect(() => {
    if (prompt || typed) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (kind === 'excluir' || (kind === 'confirmar' && request.options.tone === 'perigo')) {
      cancelRef.current?.focus();
    } else {
      confirmRef.current?.focus();
    }
    // Só na abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Teclado: Esc cancela (quando nada está em andamento) e Tab fica preso dentro do diálogo. O ouvinte é do
  // próprio diálogo e para a propagação, para o Esc não fechar também o que estiver por baixo.
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    element.addEventListener('keydown', onKey);
    return () => element.removeEventListener('keydown', onKey);
  });

  const confirmLabel =
    kind === 'excluir'
      ? (request.options.confirmLabel ?? 'Excluir')
      : kind === 'confirmar'
        ? (request.options.confirmLabel ?? 'Confirmar')
        : kind === 'entrada'
          ? (request.options.confirmLabel ?? 'Confirmar')
          : kind === 'erro'
            ? (request.options.buttonLabel ?? 'Fechar')
            : (request.options.buttonLabel ?? 'Entendi');
  const danger = kind === 'excluir' || ((kind === 'confirmar' || kind === 'entrada') && request.options.tone === 'perigo');
  const cancelLabel = kind === 'confirmar' ? (request.options.cancelLabel ?? 'Cancelar') : 'Cancelar';

  let body: ReactNode = options.message ?? null;
  if (remove) {
    body = (
      <>
        <p>
          Você está prestes a excluir <strong className="cn-dialog-item" data-testid="dialog-item">{remove.item}</strong>.
        </p>
        {options.message && <div className="mt-2 text-fog-300">{options.message}</div>}
      </>
    );
  }

  return (
    <div
      className="cn-dialog-backdrop fixed inset-0 z-[100] flex items-end justify-center p-3 sm:items-center sm:p-6"
      data-closing={closing ? '' : undefined}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div
        ref={dialogRef}
        role={alertLike || danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? messageId : undefined}
        aria-busy={busy}
        className="cn-dialog w-full max-w-[30rem]"
        data-closing={closing ? '' : undefined}
        data-testid="dialog"
        data-kind={kind}
      >
        <header className="cn-dialog-head">
          <HeaderSky />
          <span className="relative flex items-center gap-2.5">
            <LogoMark size={26} />
            <span className="text-[15px] font-extrabold tracking-wide">Cosmic Night</span>
          </span>
          <button type="button" className="cn-dialog-x" onClick={cancel} disabled={busy} aria-label="Fechar" data-testid="dialog-close">
            <X className="size-5" />
          </button>
        </header>

        <form
          className="px-5 pt-5 pb-5 sm:px-6"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <div className="flex items-start gap-3.5">
            <KindIcon kind={kind} />
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg leading-snug font-extrabold" data-testid="dialog-title">
                {options.title}
              </h2>
              {body && (
                <div id={messageId} className="mt-1.5 text-[15px] leading-relaxed break-words text-fog-300" data-testid="dialog-message">
                  {body}
                </div>
              )}
            </div>
          </div>

          {kind === 'erro' && request.options.details && (
            <details className="mt-4 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-fog-300">
              <summary className="cursor-pointer font-bold text-fog-100">Detalhes técnicos</summary>
              <pre className="mt-2 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap" data-testid="dialog-details">
                {request.options.details}
              </pre>
            </details>
          )}

          {(prompt || typed) && (
            <div className="mt-4">
              <label htmlFor={fieldId} className="mb-1.5 block text-sm font-bold text-fog-100">
                {prompt ? prompt.label : (
                  <>
                    Para confirmar, digite <span className="cn-dialog-item">{remove!.item}</span>
                  </>
                )}
              </label>
              <input
                ref={inputRef}
                id={fieldId}
                className="cn-dialog-input"
                value={value}
                placeholder={prompt?.placeholder}
                maxLength={prompt?.maxLength ? prompt.maxLength + 50 : undefined}
                onChange={(event) => setValue(event.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={prompt && touched && fieldError ? true : undefined}
                aria-describedby={prompt && touched && fieldError ? `${fieldId}-erro` : undefined}
                disabled={busy}
                autoComplete="off"
                data-testid="dialog-input"
              />
              {prompt && touched && fieldError && (
                <p id={`${fieldId}-erro`} className="mt-1.5 text-sm font-semibold text-live-300" data-testid="dialog-field-error">
                  {fieldError}
                </p>
              )}
            </div>
          )}

          {failure && (
            <p className="mt-4 rounded-xl border border-live-400/40 bg-live-400/10 px-3 py-2 text-sm font-semibold text-live-300" role="alert" data-testid="dialog-error">
              {failure}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            {!alertLike && (
              <button ref={cancelRef} type="button" className="cn-dialog-btn cn-dialog-secondary" onClick={cancel} disabled={busy} data-testid="dialog-cancel">
                {cancelLabel}
              </button>
            )}
            <button
              ref={confirmRef}
              type="submit"
              className={cx('cn-dialog-btn', danger ? 'cn-dialog-danger' : 'cn-dialog-primary')}
              disabled={busy || blocked}
              data-testid="dialog-confirm"
            >
              {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {busy ? 'Aguarde…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
