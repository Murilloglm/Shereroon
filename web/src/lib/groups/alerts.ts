/**
 * Avisos de mensagem nova: notificação do sistema e som. O NÍVEL (tudo, só menções, nada) é escolhido por
 * grupo e por canal e fica no servidor; aqui ficam só as preferências deste aparelho (mostrar notificação,
 * tocar som), que não fazem sentido em outro computador.
 */
import { audioContext } from '../audio.ts';
import { storage } from '../storage.ts';
import type { Incoming } from './client.ts';

export interface AlertPrefs {
  desktop: boolean;
  sound: boolean;
}

const KEY = 'shareroom:avisos';

export const alertPrefs = {
  get: (): AlertPrefs => ({ desktop: false, sound: true, ...storage.get<Partial<AlertPrefs>>(KEY, {}) }),
  set: (prefs: AlertPrefs): void => storage.set(KEY, prefs),
};

export const desktopAlertsSupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window;

/** Pede a permissão do sistema (precisa vir de um clique). Devolve se as notificações podem aparecer. */
export async function allowDesktopAlerts(): Promise<boolean> {
  if (!desktopAlertsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** A mensagem merece aviso, segundo o nível escolhido para aquele canal? */
export function shouldAlert(incoming: Pick<Incoming, 'level' | 'mentioned'>): boolean {
  return incoming.level === 'tudo' || (incoming.level === 'mencoes' && incoming.mentioned);
}

/** Dois toques curtos e baixos. */
function chime(): void {
  try {
    const context = audioContext();
    if (context.state !== 'running') return;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
    gain.connect(context.destination);
    for (const [index, frequency] of [880, 1320].entries()) {
      const tone = context.createOscillator();
      tone.type = 'sine';
      tone.frequency.value = frequency;
      tone.connect(gain);
      tone.start(context.currentTime + index * 0.11);
      tone.stop(context.currentTime + 0.34);
    }
  } catch {
    // sem áudio disponível: fica só o aviso visual
  }
}

/**
 * Mostra o aviso de uma mensagem que chegou. `watching` diz que a pessoa já está com aquele canal aberto e a
 * janela em foco: nesse caso não há o que avisar.
 */
export function alertIncoming(incoming: Incoming, info: { title: string; watching: boolean; open: () => void }): void {
  if (info.watching || !shouldAlert(incoming)) return;
  const prefs = alertPrefs.get();
  if (prefs.sound) chime();
  if (!prefs.desktop || !desktopAlertsSupported() || Notification.permission !== 'granted') return;
  const text = incoming.message.content || (incoming.message.attachments.length > 0 ? 'enviou um arquivo' : '');
  try {
    const notification = new Notification(info.title, { body: text.slice(0, 180), tag: `canal:${incoming.message.channelId}`, silent: true });
    notification.onclick = () => {
      window.focus();
      info.open();
      notification.close();
    };
  } catch {
    // alguns navegadores só aceitam notificação vinda de um service worker
  }
}
