// Tela de Configurações (ocupa a janela inteira, por cima do aplicativo, sem desmontar a chamada que está
// acontecendo por baixo). A chamada em andamento se registra aqui para a seção de voz e vídeo.
import type { NoiseControl } from './noise-control.ts';
import type { RoomSession } from './session.ts';
import { Store } from './store.ts';

export type SettingsSection = 'conta' | 'perfil' | 'privacidade' | 'amigos' | 'aparencia' | 'notificacoes' | 'acessibilidade' | 'voz' | 'inicializacao' | 'atualizacoes' | 'jogos' | 'inventario' | 'efeitos-nome' | 'loja' | 'pontos' | 'presentes' | 'admin';

export interface ActiveCall {
  session: RoomSession;
  noise: NoiseControl;
}

export interface SettingsScreenState {
  open: boolean;
  section: SettingsSection;
  call: ActiveCall | null;
}

export const settingsScreen = new Store<SettingsScreenState>({ open: false, section: 'conta', call: null });

export function openSettings(section: SettingsSection = 'conta'): void {
  settingsScreen.set({ open: true, section });
}

export function closeSettings(): void {
  settingsScreen.set({ open: false });
}

/** A chamada em andamento (ou null quando ela termina). */
export function registerCall(call: ActiveCall | null): void {
  const current = settingsScreen.get().call;
  if (call === null && current === null) return;
  settingsScreen.set({ call });
}
