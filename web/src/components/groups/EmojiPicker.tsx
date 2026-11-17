import { useEffect, useRef, useState, type ReactNode } from 'react';
import { storage } from '../../lib/storage.ts';
import { cx, emojiUrl, MotionSafeImage } from '../ui.tsx';

export interface CustomEmoji {
  id: string;
  name: string;
  animated: boolean;
}

const FAVORITES_KEY = 'shareroom:emojis-favoritos';
export const loadFavorites = (): string[] => {
  const value = storage.get<unknown>(FAVORITES_KEY, []);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 32) : [];
};

/** Um emoji do seletor ou de uma reação: caractere do sistema ou `:nome:` do grupo. */
export function EmojiGlyph({ emoji, custom, size = 20 }: { emoji: string; custom?: readonly CustomEmoji[]; size?: number }) {
  const match = /^:([a-z0-9_]{2,32}):$/.exec(emoji);
  const found = match ? custom?.find((item) => item.name === match[1]) : undefined;
  if (found) return <MotionSafeImage src={emojiUrl(found.id)} alt={emoji} className="inline-block object-contain align-[-0.2em]" key={found.id} />;
  return <span style={{ fontSize: size }}>{emoji}</span>;
}

/** Emojis do seletor. São caracteres do próprio sistema: nenhuma imagem é baixada. */
const GROUPS: [string, string[]][] = [
  ['Mais usados', ['👍', '❤️', '😂', '🔥', '🎉', '👀', '😮', '😢', '🙏', '💯', '✅', '❌']],
  ['Carinhas', ['😀', '😁', '😅', '🤣', '😊', '😍', '😘', '😎', '🤔', '😴', '😭', '😡', '🥳', '🤯', '😳', '🙄', '😬', '🤝', '👏', '🙌', '💪', '🫡', '🤡', '💀']],
  ['Jogos e coisas', ['🎮', '🕹️', '🏆', '🎯', '⚔️', '🛡️', '🚀', '⭐', '🌙', '🌌', '💜', '💙', '🎧', '🎤', '🎬', '📌', '📎', '🖼️', '☕', '🍕', '⏰', '💤', '🐉', '👑']],
];

/** Os primeiros da lista, para a barra de reação rápida. */
export const QUICK_EMOJIS = GROUPS[0]![1].slice(0, 4);

/** Painel flutuante de emojis. Fecha ao escolher, ao clicar fora ou com Esc. */
export function EmojiPicker({ onPick, onClose, className, children, custom = [] }: { onPick: (emoji: string) => void; onClose: () => void; className?: string; children?: ReactNode; custom?: readonly CustomEmoji[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [favorites, setFavorites] = useState(loadFavorites);
  // Botão direito favorita (ou tira dos favoritos); a escolha fica guardada neste aparelho.
  const toggleFavorite = (emoji: string) => {
    const next = favorites.includes(emoji) ? favorites.filter((item) => item !== emoji) : [emoji, ...favorites].slice(0, 32);
    storage.set(FAVORITES_KEY, next);
    setFavorites(next);
  };
  const sections: [string, string[]][] = [
    ...(favorites.length > 0 ? [['Favoritos', favorites] as [string, string[]]] : []),
    ...(custom.length > 0 ? [['Do grupo', custom.map((item) => `:${item.name}:`)] as [string, string[]]] : []),
    ...GROUPS,
  ];
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
        {sections.map(([title, emojis]) => (
          <section key={title}>
            <h3 className="px-1 pt-1.5 pb-1 text-[11px] font-extrabold tracking-wide text-fog-500 uppercase">{title}</h3>
            <div className="grid grid-cols-8 gap-0.5">
              {emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Emoji ${emoji}`}
                  data-emoji={emoji}
                  className={cx('flex size-8 items-center justify-center rounded-lg text-xl leading-none transition-transform hover:scale-125 hover:bg-ink-700 motion-reduce:hover:scale-100', favorites.includes(emoji) && 'bg-brand-500/15')}
                  title={favorites.includes(emoji) ? 'Botão direito: tirar dos favoritos' : 'Botão direito: favoritar'}
                  onClick={() => {
                    onPick(emoji);
                    onClose();
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    toggleFavorite(emoji);
                  }}
                >
                  <span className="flex size-6 items-center justify-center">
                    <EmojiGlyph emoji={emoji} custom={custom} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
