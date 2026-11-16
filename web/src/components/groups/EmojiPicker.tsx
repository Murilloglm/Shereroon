import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '../ui.tsx';

/** Emojis do seletor. São caracteres do próprio sistema: nenhuma imagem é baixada. */
const GROUPS: [string, string[]][] = [
  ['Mais usados', ['👍', '❤️', '😂', '🔥', '🎉', '👀', '😮', '😢', '🙏', '💯', '✅', '❌']],
  ['Carinhas', ['😀', '😁', '😅', '🤣', '😊', '😍', '😘', '😎', '🤔', '😴', '😭', '😡', '🥳', '🤯', '😳', '🙄', '😬', '🤝', '👏', '🙌', '💪', '🫡', '🤡', '💀']],
  ['Jogos e coisas', ['🎮', '🕹️', '🏆', '🎯', '⚔️', '🛡️', '🚀', '⭐', '🌙', '🌌', '💜', '💙', '🎧', '🎤', '🎬', '📌', '📎', '🖼️', '☕', '🍕', '⏰', '💤', '🐉', '👑']],
];

/** Os primeiros da lista, para a barra de reação rápida. */
export const QUICK_EMOJIS = GROUPS[0]![1].slice(0, 4);

/** Painel flutuante de emojis. Fecha ao escolher, ao clicar fora ou com Esc. */
export function EmojiPicker({ onPick, onClose, className, children }: { onPick: (emoji: string) => void; onClose: () => void; className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    // No próximo quadro: o clique que abriu o painel não pode fechá-lo.
    const timer = setTimeout(() => document.addEventListener('pointerdown', onPointer), 0);
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Escolher emoji"
      className={cx('absolute z-40 w-72 animate-rise rounded-2xl border border-brand-500/30 bg-ink-850 p-2 shadow-panel', className)}
      data-testid="emoji-picker"
    >
      {children}
      <div className="max-h-64 overflow-y-auto pr-1">
        {GROUPS.map(([title, emojis]) => (
          <section key={title}>
            <h3 className="px-1 pt-1.5 pb-1 text-[11px] font-extrabold tracking-wide text-fog-500 uppercase">{title}</h3>
            <div className="grid grid-cols-8 gap-0.5">
              {emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Emoji ${emoji}`}
                  data-emoji={emoji}
                  className="flex size-8 items-center justify-center rounded-lg text-xl leading-none transition-transform hover:scale-125 hover:bg-ink-700"
                  onClick={() => {
                    onPick(emoji);
                    onClose();
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
