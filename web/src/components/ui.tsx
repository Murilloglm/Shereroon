import { Check, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { meterPosition } from '../lib/audio.ts';
import { API_BASE } from '../lib/api.ts';
import { reducedMotion as appearanceReducesMotion } from '../lib/appearance.ts';
import { hueFor, initials } from '../lib/format.ts';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// --- Estrutura ---------------------------------------------------------------

export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cx('rounded-2xl border border-brand-500/15 bg-ink-850/85 shadow-panel backdrop-blur-md', className)}
      {...rest}
    />
  );
}

/** Emblema do aplicativo. O fundo preto da arte some sobre o fundo escuro (mistura "screen"). */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.png`}
      width={size}
      height={size}
      alt=""
      draggable={false}
      className={cx('shrink-0 mix-blend-screen select-none', className)}
      style={{ width: size, height: size }}
    />
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 select-none" aria-label="Cosmic Night">
      <LogoMark size={compact ? 36 : 46} />
      <span className={cx('font-extrabold tracking-tight', compact ? 'text-xl' : 'text-2xl')}>
        Cosmic <span className="bg-linear-to-r from-brand-300 to-neon-300 bg-clip-text text-transparent">Night</span>
      </span>
    </span>
  );
}

/** Fundo do app: céu noturno com nebulosas roxa e azul e riscos de luz nos cantos. Puramente decorativo. */
export function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_-12%,rgb(101_54_232/0.22),transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(42%_52%_at_-4%_104%,rgb(124_77_255/0.46),transparent_70%),radial-gradient(40%_50%_at_104%_100%,rgb(79_38_192/0.46),transparent_70%),radial-gradient(30%_36%_at_100%_-6%,rgb(20_194_240/0.12),transparent_70%)]" />
      {/* Estrelas: pontos espalhados, repetidos em blocos grandes para não formar padrão visível. */}
      <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(1px_1px_at_12%_18%,#cfd6ff_50%,transparent_51%),radial-gradient(1px_1px_at_71%_9%,#b79dff_50%,transparent_51%),radial-gradient(1.5px_1.5px_at_38%_64%,#bdf4ff_50%,transparent_51%),radial-gradient(1px_1px_at_88%_47%,#fff_50%,transparent_51%),radial-gradient(1px_1px_at_54%_86%,#b79dff_50%,transparent_51%),radial-gradient(1px_1px_at_23%_92%,#fff_50%,transparent_51%)] [background-size:560px_420px]" />
      <svg className="absolute bottom-0 left-0 h-[46%] w-[34%] opacity-80" viewBox="0 0 500 400" preserveAspectRatio="none">
        <defs>
          <linearGradient id="cn-streak-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3fdcff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#7c4dff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#3fdcff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M-20 170 C120 250 220 330 330 420" fill="none" stroke="url(#cn-streak-a)" strokeWidth="2.5" />
        <path d="M-20 240 C90 300 170 350 240 420" fill="none" stroke="url(#cn-streak-a)" strokeWidth="1.5" opacity="0.7" />
      </svg>
      <svg className="absolute right-0 bottom-0 h-[46%] w-[34%] opacity-80" viewBox="0 0 500 400" preserveAspectRatio="none">
        <path d="M520 150 C380 240 270 320 170 420" fill="none" stroke="url(#cn-streak-a)" strokeWidth="2.5" />
        <path d="M520 230 C410 290 330 350 270 420" fill="none" stroke="url(#cn-streak-a)" strokeWidth="1.5" opacity="0.7" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-ink-950/80 to-transparent" />
    </div>
  );
}

// --- Botões ------------------------------------------------------------------

type Variant = 'primary' | 'neon' | 'danger' | 'quiet' | 'outline' | 'bare';

const VARIANTS: Record<Variant, string> = {
  primary:
    'border border-brand-400/70 bg-linear-to-b from-brand-500 to-brand-700 text-white shadow-glow hover:from-brand-400 hover:to-brand-600',
  neon: 'border border-neon-300/70 bg-linear-to-b from-neon-400 to-neon-600 text-ink-950 shadow-neon hover:from-neon-300 hover:to-neon-500',
  danger:
    'border border-live-500/70 bg-linear-to-b from-live-600 to-live-700 text-white hover:from-live-500 hover:to-live-600',
  quiet: 'border border-ink-600 bg-ink-800/90 text-fog-100 hover:border-ink-500 hover:bg-ink-750',
  outline: 'border border-brand-400/70 bg-brand-500/10 text-brand-200 hover:bg-brand-500/20',
  bare: 'border border-transparent text-fog-300 hover:bg-ink-750 hover:text-fog-100',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
}

export function Button({ variant = 'quiet', size = 'md', active, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 font-semibold whitespace-nowrap transition-[background,border-color,box-shadow,opacity] duration-150',
        'disabled:opacity-45 disabled:shadow-none',
        size === 'sm' && 'h-9 rounded-lg px-3 text-sm',
        size === 'md' && 'h-11 rounded-xl px-4 text-[15px]',
        size === 'lg' && 'h-12 rounded-xl px-5 text-base',
        VARIANTS[variant],
        active && variant === 'quiet' && 'border-brand-400 bg-brand-500/20 shadow-glow',
        className,
      )}
      {...rest}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-fog-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Opção selecionável (resolução, FPS...). `hinted` marca o valor que o modo automático está usando. */
export function Chip({
  selected,
  hinted,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; hinted?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-1 rounded-lg border text-sm font-bold transition-[background,border-color,box-shadow] duration-150 disabled:opacity-50',
        selected
          ? 'border-brand-300 bg-linear-to-b from-brand-500 to-brand-700 text-white shadow-glow'
          : 'border-ink-600 bg-ink-800 text-fog-300 hover:border-ink-500 hover:text-fog-100',
        hinted && !selected && 'border-dashed border-brand-400 text-brand-200',
        className,
      )}
      {...rest}
    >
      {children}
      {selected && <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx(
        'relative h-6 w-11 shrink-0 rounded-full border transition-[background,border-color,box-shadow] duration-150 disabled:opacity-45',
        on ? 'border-brand-300 bg-brand-500 shadow-glow' : 'border-ink-500 bg-ink-700',
      )}
    >
      <span
        className={cx(
          'absolute top-[3px] left-[3px] size-4 rounded-full bg-white transition-transform duration-150',
          on && 'translate-x-5',
        )}
      />
    </button>
  );
}

export function Slider({
  value,
  onChange,
  label,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}) {
  const fill = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      className={cx('sr-range', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      style={{ '--fill': `${fill}%` } as CSSProperties}
    />
  );
}

// --- Medidor de nível --------------------------------------------------------

const SEGMENTS = 10;

/**
 * Medidor em barrinhas, atualizado direto no DOM a cada quadro (sem re-renderizar o React).
 * `read` devolve a amplitude de pico atual, de 0 a 1.
 */
export function LevelMeter({ read, className }: { read: () => number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    let frame = 0;
    let shown = 0;
    let lit = -1;
    const loop = () => {
      const target = meterPosition(readRef.current());
      // Sobe na hora, desce devagar: fica legível sem piscar.
      shown = target > shown ? target : Math.max(target, shown - 0.035);
      const next = Math.round(shown * SEGMENTS);
      if (next !== lit && ref.current) {
        lit = next;
        const bars = ref.current.children;
        for (let index = 0; index < bars.length; index++) {
          (bars[index] as HTMLElement).dataset.on = index < lit ? '1' : '0';
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={ref} className={cx('flex items-end gap-[2px]', className)} role="presentation">
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <span
          key={index}
          data-on="0"
          className={cx(
            'h-3.5 w-[3px] rounded-[1px] bg-ink-600 transition-colors duration-75',
            index < 7 ? 'data-[on=1]:bg-ok-400' : index < 9 ? 'data-[on=1]:bg-warn-400' : 'data-[on=1]:bg-live-400',
          )}
        />
      ))}
    </div>
  );
}

/** Barrinhas de sinal (como as de celular), de 0 a 4. */
export function SignalBars({ level, className }: { level: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-end gap-[2px]', className)} aria-hidden="true">
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={cx('w-[3px] rounded-[1px]', bar <= level ? 'bg-ok-400' : 'bg-ink-500')}
          style={{ height: `${4 + bar * 3}px` }}
        />
      ))}
    </span>
  );
}

// --- Pessoas -----------------------------------------------------------------

/** Avatares padrão: pares de cores do céu do Cosmic Night (o índice vem de 'padrao:<n>'). */
export const DEFAULT_AVATARS: [string, string][] = [
  ['#74d7ff', '#4b348e'],
  ['#6c4dff', '#1b1446'],
  ['#3fdcff', '#0b4f6c'],
  ['#b79dff', '#4f26c0'],
  ['#ff8aa6', '#4b348e'],
  ['#45e283', '#0f3d3a'],
  ['#ffc65c', '#7a2e4f'],
  ['#82e9ff', '#6c4dff'],
  ['#9873ff', '#07090d'],
  ['#14c2f0', '#3a1b95'],
  ['#ff5c85', '#1d2142'],
  ['#d6c8ff', '#2b305e'],
];

// Segue a escolha em Configurações → Acessibilidade (ou a do sistema, por padrão).
const prefersReducedMotion = () => appearanceReducesMotion();

/** Endereço público de um emoji do grupo. */
export const emojiUrl = (id: string): string => `${API_BASE}/api/emojis/${id}`;

export function reducedMotion(): boolean {
  return prefersReducedMotion();
}

/**
 * Imagem que pode ser animada (GIF, WebP animado). Com "reduzir movimento" ligado no sistema, aparece parada
 * no primeiro quadro (desenhada numa tela), a não ser que `play` peça para tocar.
 */
export function MotionSafeImage({ src, alt, className, play = false }: { src: string; alt: string; className?: string; play?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [still, setStill] = useState(false);
  const reduce = prefersReducedMotion() && !play;
  return (
    <>
      <img
        src={src}
        alt={alt}
        className={cx(className, still && reduce && 'hidden')}
        draggable={false}
        crossOrigin={reduce ? 'anonymous' : undefined}
        onLoad={(event) => {
          if (!reduce || !canvasRef.current) return;
          const image = event.currentTarget;
          canvasRef.current.width = image.naturalWidth;
          canvasRef.current.height = image.naturalHeight;
          try {
            canvasRef.current.getContext('2d')?.drawImage(image, 0, 0);
            setStill(true);
          } catch {
            // sem permissão para desenhar: fica a imagem normal
          }
        }}
      />
      {reduce && <canvas ref={canvasRef} className={cx(className, !still && 'hidden')} role="img" aria-label={alt} />}
    </>
  );
}

/** Foto enviada. Com "reduzir movimento" ligado, um GIF animado aparece parado no primeiro quadro. */
function AvatarImage({ src, alt }: { src: string; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [still, setStill] = useState(false);
  const reduce = prefersReducedMotion();
  return (
    <>
      <img
        src={src}
        alt={alt}
        className={cx('size-full rounded-full object-cover', still && 'hidden')}
        draggable={false}
        crossOrigin={reduce ? "anonymous" : undefined}
        onLoad={(event) => {
          if (!reduce || !canvasRef.current) return;
          const image = event.currentTarget;
          const canvas = canvasRef.current;
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          try {
            canvas.getContext('2d')?.drawImage(image, 0, 0);
            setStill(true);
          } catch {
            // sem permissão para desenhar: mostra a imagem normal
          }
        }}
      />
      {reduce && <canvas ref={canvasRef} className={cx('size-full rounded-full object-cover', !still && 'hidden')} aria-hidden="true" />}
    </>
  );
}

export function Avatar({
  id,
  name,
  size = 40,
  online,
  speaking,
  image,
}: {
  id: string;
  name: string;
  size?: number;
  online?: boolean;
  speaking?: boolean;
  /** 'padrao:<n>' (avatar padrão) ou 'arquivo:<id>' (foto enviada); sem isso, as iniciais. */
  image?: string | null;
}) {
  const hue = hueFor(id);
  const preset = image?.startsWith('padrao:') ? DEFAULT_AVATARS[Number(image.slice(7))] : undefined;
  const photo = image?.startsWith('arquivo:') && /^[A-Za-z0-9_-]{8,40}$/.test(image.slice(8)) ? `${API_BASE}/api/media/${image.slice(8)}` : null;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className={cx(
          'flex size-full items-center justify-center overflow-hidden rounded-full font-extrabold text-white transition-shadow',
          // Acende quase na hora (o atraso já foi medido no detector) e apaga devagar, sem piscar.
          speaking ? 'shadow-[0_0_0_2px_var(--color-ok-400)] duration-[40ms]' : 'shadow-[0_0_0_1px_rgb(255_255_255/0.12)] duration-300',
        )}
        data-speaking={speaking ? 'true' : undefined}
        data-avatar={photo ? 'foto' : preset ? 'padrao' : 'iniciais'}
        style={{
          fontSize: size * 0.36,
          background: preset
            ? `radial-gradient(circle at 30% 25%, ${preset[0]}, ${preset[1]} 72%)`
            : `linear-gradient(140deg, hsl(${hue} 72% 58%), hsl(${hue + 35} 68% 30%))`,
        }}
        aria-hidden="true"
      >
        {photo ? <AvatarImage src={photo} alt="" /> : initials(name)}
      </span>
      {online && (
        <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-ink-850 bg-ok-400" />
      )}
    </span>
  );
}

// --- Sobreposições -----------------------------------------------------------

/** Menu suspenso. Fecha ao clicar fora, ao apertar Esc ou ao escolher um item. */
export function Menu({
  trigger,
  children,
  side = 'top',
  align = 'start',
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div
          role="menu"
          className={cx(
            'absolute z-40 min-w-60 animate-rise rounded-xl border border-ink-600 bg-ink-800 p-1.5 shadow-panel',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
            align === 'start' ? 'left-0' : 'right-0',
            className,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  selected,
  hint,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; hint?: string; icon?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cx(
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-ink-700 disabled:opacity-45',
        selected && 'bg-brand-500/15',
        className,
      )}
      {...rest}
    >
      {icon && <span className="mt-0.5 text-brand-300">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-fog-100">{children}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-fog-400">{hint}</span>}
      </span>
      {selected && <Check className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden="true" />}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-2 pb-1 text-xs font-bold text-fog-500">{children}</div>;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade items-end justify-center bg-ink-950/75 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          'flex max-h-[92dvh] w-full animate-rise flex-col rounded-t-2xl border border-ink-600 bg-ink-850 shadow-panel sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-xl',
        )}
      >
        <header className="flex items-center justify-between gap-4 border-b border-ink-700 px-5 py-4">
          <h2 id={titleId} className="text-lg font-extrabold">
            {title}
          </h2>
          <IconButton label="Fechar" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Aviso passageiro no rodapé. Some sozinho. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDone, Math.min(9000, 3500 + message.length * 35));
    return () => clearTimeout(timer);
  }, [message, onDone]);

  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed bottom-28 left-1/2 z-[60] w-[min(92vw,34rem)] -translate-x-1/2 animate-rise rounded-xl border border-brand-400/60 bg-ink-800 px-4 py-3 text-sm font-semibold text-fog-100 shadow-panel"
    >
      {message}
    </div>
  );
}

export function Notice({
  tone = 'info',
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement> & { tone?: 'info' | 'aviso' | 'ok' }) {
  return (
    <p
      {...rest}
      className={cx(
        'rounded-lg border px-3 py-2 text-[13px] leading-snug',
        tone === 'info' && 'border-ink-600 bg-ink-800/80 text-fog-300',
        tone === 'aviso' && 'border-warn-400/40 bg-warn-400/10 text-warn-400',
        tone === 'ok' && 'border-ok-400/40 bg-ok-400/10 text-ok-400',
        className,
      )}
    />
  );
}

export function TextInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-11 w-full rounded-xl border border-ink-600 bg-ink-900/70 px-3.5 text-[15px] text-fog-100 placeholder:text-fog-500 transition-colors focus:border-brand-400 focus:outline-none',
        className,
      )}
      {...rest}
    />
  );
}
