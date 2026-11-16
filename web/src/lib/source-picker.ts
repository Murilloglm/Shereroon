/**
 * Seletor de tela/janela do aplicativo de Windows. Faz o papel do seletor do navegador: a captura só começa
 * depois que a pessoa escolhe uma fonte aqui e confirma.
 */
import type { Surface } from './capture.ts';
import { desktop, type DesktopSource } from './desktop.ts';
import { Store } from './store.ts';

export interface PickerState {
  open: boolean;
  loading: boolean;
  tab: 'window' | 'screen';
  sources: DesktopSource[];
}

export const pickerStore = new Store<PickerState>({ open: false, loading: false, tab: 'window', sources: [] });

let settle: ((id: string | null) => void) | null = null;

/** Atualiza a lista e as miniaturas (janelas abrem e fecham enquanto o seletor está na tela). */
export async function refreshSources(): Promise<void> {
  if (!desktop || !pickerStore.get().open) return;
  try {
    const sources = await desktop.listSources();
    if (pickerStore.get().open) pickerStore.set({ sources, loading: false });
  } catch {
    pickerStore.set({ loading: false });
  }
}

/** Abre o seletor e espera a escolha. Devolve o id da fonte, ou null se a pessoa cancelou. */
export function pickDesktopSource(preferred?: Surface): Promise<string | null> {
  settle?.(null);
  pickerStore.set({ open: true, loading: true, sources: [], tab: preferred === 'monitor' ? 'screen' : 'window' });
  void refreshSources();
  return new Promise((resolve) => {
    settle = resolve;
  });
}

export function finishPick(id: string | null): void {
  pickerStore.set({ open: false, sources: [] });
  settle?.(id);
  settle = null;
}
