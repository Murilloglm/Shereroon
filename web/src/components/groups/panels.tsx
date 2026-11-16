import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { storage } from '../../lib/storage.ts';

interface Saved {
  width: number;
  open: boolean;
}

export interface Panel {
  width: number;
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  /** Alça de redimensionar: coloque na borda do painel que encosta no conteúdo. */
  resizer: ReactElement;
}

/**
 * Painel lateral que a pessoa pode alargar, estreitar e recolher. O tamanho e o estado ficam guardados
 * neste aparelho (é preferência de tela, não dado da conta).
 * `side` é o lado da janela em que o painel fica: o da esquerda cresce arrastando para a direita.
 */
export function usePanel(name: string, side: 'left' | 'right', initial: number, min: number, max: number, label: string): Panel {
  const key = `shareroom:painel:${name}`;
  const [state, setState] = useState<Saved>(() => {
    const saved = storage.get<Partial<Saved>>(key, {});
    return { width: Math.min(max, Math.max(min, Number(saved.width) || initial)), open: saved.open !== false };
  });
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);

  const update = useCallback(
    (patch: Partial<Saved>) =>
      setState((current) => {
        const next = { ...current, ...patch };
        storage.set(key, next);
        return next;
      }),
    [key],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width: state.width };
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const delta = (event.clientX - start.current.x) * (side === 'left' ? 1 : -1);
    setState((current) => ({ ...current, width: Math.round(Math.min(max, Math.max(min, start.current!.width + delta))) }));
  };
  const onPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    setState((current) => {
      storage.set(key, current);
      return current;
    });
  };

  const resizer = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Redimensionar ${label}`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={state.width}
      tabIndex={0}
      className="cn-resizer"
      data-dragging={dragging}
      data-testid={`resizer-${name}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => update({ width: initial })}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0;
        if (!step) return;
        event.preventDefault();
        update({ width: Math.min(max, Math.max(min, state.width + step * (side === 'left' ? 1 : -1))) });
      }}
    />
  );

  return { width: state.width, open: state.open, toggle: () => update({ open: !state.open }), setOpen: (open) => update({ open }), resizer };
}
