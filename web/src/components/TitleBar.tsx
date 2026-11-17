import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { desktop, type WindowState } from '../lib/desktop.ts';
import { cx } from './ui.tsx';

/** Altura do cabeçalho da janela no aplicativo de Windows (a mesma de --titlebar-h no CSS). */
export const TITLEBAR_HEIGHT = 32;

/**
 * Cabeçalho da janela do aplicativo de Windows, no lugar da barra de título do sistema. A faixa inteira arrasta a
 * janela (duplo clique maximiza, como no Windows); os botões não. Some em tela cheia. No site não existe.
 */
export function TitleBar() {
  const controls = desktop?.window;
  const [state, setState] = useState<WindowState>({ maximized: false, fullscreen: false, focused: true });

  useEffect(() => {
    if (!controls) return;
    document.documentElement.dataset.titlebar = 'on';
    void controls.state().then((next) => next && setState(next));
    const stop = controls.onState(setState);
    return () => {
      stop();
      delete document.documentElement.dataset.titlebar;
    };
  }, [controls]);

  useEffect(() => {
    if (!controls) return;
    if (state.fullscreen) document.documentElement.dataset.titlebar = 'cheia';
    else document.documentElement.dataset.titlebar = 'on';
  }, [controls, state.fullscreen]);

  if (!controls || state.fullscreen) return null;
  const button = 'flex h-full w-[46px] items-center justify-center text-fog-400 transition-colors duration-150 [-webkit-app-region:no-drag] hover:bg-white/8 hover:text-fog-100 focus-visible:bg-white/10 focus-visible:outline-none';
  return (
    <header
      className={cx('fixed inset-x-0 top-0 z-[2000] flex items-stretch justify-end bg-ink-950/95 select-none [-webkit-app-region:drag]', !state.focused && 'opacity-80')}
      style={{ height: TITLEBAR_HEIGHT }}
      data-testid="titlebar"
      data-maximized={state.maximized ? 'true' : 'false'}
    >
      <div className="flex h-full items-stretch">
        <button type="button" className={button} aria-label="Minimizar" title="Minimizar" onClick={() => void controls.minimize()} data-testid="window-minimize">
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={button}
          aria-label={state.maximized ? 'Restaurar' : 'Maximizar'}
          title={state.maximized ? 'Restaurar' : 'Maximizar'}
          onClick={() => void controls.toggleMaximize().then((next) => next && setState(next))}
          data-testid="window-maximize"
        >
          {state.maximized ? <Copy className="size-3.5 -scale-x-100" aria-hidden="true" /> : <Square className="size-3.5" aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={cx(button, 'hover:bg-live-500 hover:text-on-accent focus-visible:bg-live-500 focus-visible:text-on-accent')}
          aria-label="Fechar"
          title="Fechar"
          onClick={() => void controls.close()}
          data-testid="window-close"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
