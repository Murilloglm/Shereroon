// Aparência e acessibilidade, guardadas neste aparelho e aplicadas na hora (sem recarregar): o tema troca as
// variáveis de cor no <html> e o atributo data-motion é o que o CSS lê para reduzir animações. "sistema" segue a
// preferência do Windows/navegador.
import { storage } from './storage.ts';
import { Store } from './store.ts';
import { applyTheme, isThemeId, type ThemeId } from './themes.ts';

export type MotionChoice = 'sistema' | 'reduzir' | 'normal';

export interface AppearancePrefs {
  theme: ThemeId;
  motion: MotionChoice;
}

const KEY = 'cosmic:aparencia';
const DEFAULTS: AppearancePrefs = { theme: 'cosmic', motion: 'sistema' };

function load(): AppearancePrefs {
  const saved = storage.get<Partial<AppearancePrefs>>(KEY, {}) ?? {};
  return {
    theme: isThemeId(saved.theme) ? saved.theme : DEFAULTS.theme,
    motion: ['sistema', 'reduzir', 'normal'].includes(String(saved.motion)) ? (saved.motion as MotionChoice) : DEFAULTS.motion,
  };
}

const systemReduces = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export const appearance = new Store<AppearancePrefs>(load());

/** Animações reduzidas agora? (escolha da pessoa, ou a do sistema quando ela deixou em "sistema"). */
export function reducedMotion(prefs: AppearancePrefs = appearance.get()): boolean {
  return prefs.motion === 'reduzir' || (prefs.motion === 'sistema' && systemReduces());
}

function apply(): void {
  if (typeof document === 'undefined') return;
  const prefs = appearance.get();
  applyTheme(prefs.theme);
  document.documentElement.dataset.motion = reducedMotion(prefs) ? 'reduzida' : 'normal';
}

export function setAppearance(patch: Partial<AppearancePrefs>): void {
  appearance.set(patch);
  storage.set(KEY, appearance.get());
  apply();
}

apply();
if (typeof window !== 'undefined') window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply);
