// Temas do Cosmic Night. Todas as cores da interface saem destas variáveis: as do Tailwind (--color-*, que as
// classes como bg-ink-900 usam) e as semânticas das classes próprias (.cn-panel, diálogos, fundo). Trocar o tema
// só troca os valores no <html>, na hora, sem recarregar.

export type ThemeId = 'cosmic' | 'escuro' | 'claro';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  scheme: 'dark' | 'light';
  vars: Record<string, string>;
}

const COSMIC: Record<string, string> = {
  '--color-ink-950': '#03040b',
  '--color-ink-900': '#060712',
  '--color-ink-850': '#0a0c1b',
  '--color-ink-800': '#0f1124',
  '--color-ink-750': '#15182f',
  '--color-ink-700': '#1d2142',
  '--color-ink-600': '#2b305e',
  '--color-ink-500': '#414789',
  '--color-brand-100': '#ece5ff',
  '--color-brand-200': '#d6c8ff',
  '--color-brand-300': '#b79dff',
  '--color-brand-400': '#9873ff',
  '--color-brand-500': '#7c4dff',
  '--color-brand-600': '#6536e8',
  '--color-brand-700': '#4f26c0',
  '--color-brand-800': '#3a1b95',
  '--color-neon-200': '#bdf4ff',
  '--color-neon-300': '#82e9ff',
  '--color-neon-400': '#3fdcff',
  '--color-neon-500': '#14c2f0',
  '--color-neon-600': '#0b98c4',
  '--color-live-300': '#ff8aa6',
  '--color-live-400': '#ff5c85',
  '--color-live-500': '#e23a66',
  '--color-live-600': '#b82650',
  '--color-live-700': '#8d1b3d',
  '--color-ok-400': '#45e283',
  '--color-ok-500': '#2bcb6b',
  '--color-warn-400': '#ffc65c',
  '--color-fog-100': '#eff0fb',
  '--color-fog-300': '#c4c8e2',
  '--color-fog-400': '#969bbd',
  '--color-fog-500': '#6b7096',
  '--color-white': '#ffffff',
  '--color-on-accent': '#ffffff',
  '--shadow-glow': '0 0 24px -6px rgb(124 77 255 / 0.85)',
  '--shadow-neon': '0 0 22px -6px rgb(63 220 255 / 0.8)',
  '--shadow-panel': '0 0 0 1px rgb(124 77 255 / 0.06), 0 20px 60px -28px rgb(0 0 0 / 0.95)',
  // Classes próprias
  '--cn-panel-border': 'rgb(124 77 255 / 0.16)',
  '--cn-panel-bg': 'linear-gradient(180deg, rgb(13 15 32 / 0.92), rgb(8 9 21 / 0.94))',
  '--cn-panel-shadow': 'inset 0 1px 0 rgb(255 255 255 / 0.035), 0 0 0 1px rgb(3 4 11 / 0.6), 0 24px 60px -34px rgb(0 0 0 / 0.95)',
  '--cn-selected-border': 'rgb(152 115 255 / 0.75)',
  '--cn-selected-bg': 'linear-gradient(90deg, rgb(124 77 255 / 0.34), rgb(124 77 255 / 0.14))',
  '--cn-selected-shadow': 'inset 0 0 0 1px rgb(152 115 255 / 0.35), 0 0 20px -8px rgb(124 77 255 / 0.9)',
  '--glow-brand': 'rgb(124 77 255 / 0.9)',
  '--selection-bg': 'rgb(124 77 255 / 0.5)',
  '--backdrop-art': '1',
  '--call-card-s': '42%',
  '--call-card-l': '20%',
  '--dlg-bg': '#0d1118',
  '--dlg-text': '#f4f8ff',
  '--dlg-frame': 'linear-gradient(125deg, #74d7ff 0%, #6c4dff 55%, #4b348e 100%)',
  '--dlg-shadow': '0 0 34px -12px rgb(116 215 255 / 0.5), 0 0 52px -18px rgb(108 77 255 / 0.65), 0 30px 80px -30px rgb(0 0 0 / 0.95)',
  '--dlg-head-bg': 'linear-gradient(180deg, #07090d 0%, #0d1118 100%)',
  '--dlg-head-line': 'linear-gradient(90deg, rgb(116 215 255 / 0.6), rgb(108 77 255 / 0.6), rgb(75 52 142 / 0.4))',
  '--dlg-accent': '#74d7ff',
  '--dlg-accent-soft': 'rgb(116 215 255 / 0.12)',
  '--dlg-input-bg': '#07090d',
  '--dlg-input-border': '#2a2f45',
  '--dlg-secondary-border': '#4b348e',
  '--dlg-secondary-bg': 'rgb(75 52 142 / 0.14)',
  '--dlg-backdrop': 'rgb(3 4 8 / 0.74)',
};

const ESCURO: Record<string, string> = {
  ...COSMIC,
  '--color-ink-950': '#0a0b0d',
  '--color-ink-900': '#0e0f12',
  '--color-ink-850': '#141518',
  '--color-ink-800': '#1b1d21',
  '--color-ink-750': '#22252a',
  '--color-ink-700': '#2c2f36',
  '--color-ink-600': '#3d414a',
  '--color-ink-500': '#5a5f6b',
  '--color-brand-100': '#ebe5ff',
  '--color-brand-200': '#d3c8ff',
  '--color-brand-300': '#b4a1ff',
  '--color-brand-400': '#9277f5',
  '--color-brand-500': '#6d4ae8',
  '--color-brand-600': '#5b3bd0',
  '--color-brand-700': '#4a2fae',
  '--color-brand-800': '#382283',
  '--color-neon-200': '#c3efff',
  '--color-neon-300': '#7fd8f2',
  '--color-neon-400': '#45c6ea',
  '--color-neon-500': '#22aed8',
  '--color-neon-600': '#1590b8',
  '--color-live-400': '#f45a82',
  '--color-live-500': '#d8325e',
  '--color-fog-100': '#ececf1',
  '--color-fog-300': '#c3c5ce',
  '--color-fog-400': '#9a9da8',
  '--color-fog-500': '#7b7f8b',
  // Menos brilho: sem halos em volta de botões e itens.
  '--shadow-glow': '0 0 0 0 transparent',
  '--shadow-neon': '0 0 0 0 transparent',
  '--shadow-panel': '0 0 0 1px rgb(255 255 255 / 0.04), 0 16px 40px -28px rgb(0 0 0 / 0.9)',
  '--cn-panel-border': 'rgb(255 255 255 / 0.06)',
  '--cn-panel-bg': 'linear-gradient(180deg, #141518, #131417)',
  '--cn-panel-shadow': '0 16px 40px -30px rgb(0 0 0 / 0.9)',
  '--cn-selected-border': 'rgb(146 119 245 / 0.5)',
  '--cn-selected-bg': 'linear-gradient(90deg, rgb(109 74 232 / 0.2), rgb(109 74 232 / 0.12))',
  '--cn-selected-shadow': 'inset 0 0 0 1px rgb(146 119 245 / 0.2)',
  '--glow-brand': 'rgb(109 74 232 / 0.4)',
  '--selection-bg': 'rgb(109 74 232 / 0.45)',
  '--backdrop-art': '0',
  '--call-card-s': '10%',
  '--call-card-l': '15%',
  '--dlg-bg': '#15161a',
  '--dlg-text': '#ececf1',
  '--dlg-frame': 'linear-gradient(#2c2f36, #2c2f36)',
  '--dlg-shadow': '0 30px 80px -30px rgb(0 0 0 / 0.95)',
  '--dlg-head-bg': '#111215',
  '--dlg-head-line': 'linear-gradient(90deg, #2c2f36, #2c2f36)',
  '--dlg-accent': '#7fd8f2',
  '--dlg-accent-soft': 'rgb(127 216 242 / 0.1)',
  '--dlg-input-bg': '#0e0f12',
  '--dlg-input-border': '#2c2f36',
  '--dlg-secondary-border': '#3d414a',
  '--dlg-secondary-bg': 'rgb(255 255 255 / 0.03)',
  '--dlg-backdrop': 'rgb(0 0 0 / 0.7)',
};

const CLARO: Record<string, string> = {
  ...COSMIC,
  // Fundos claros: a escala "ink" continua indo do fundo da janela (950) às bordas (600).
  '--color-ink-950': '#e7e9f1',
  '--color-ink-900': '#f3f4f9',
  '--color-ink-850': '#ffffff',
  '--color-ink-800': '#eef0f6',
  '--color-ink-750': '#e4e7f0',
  '--color-ink-700': '#d6dae6',
  '--color-ink-600': '#bcc2d4',
  '--color-ink-500': '#8c93ad',
  // Destaques mais escuros, para ler bem no branco.
  '--color-brand-100': '#2a1470',
  '--color-brand-200': '#3b1fa0',
  '--color-brand-300': '#5a36d6',
  '--color-brand-400': '#6a43f0',
  '--color-brand-500': '#6a43f0',
  '--color-brand-600': '#5a34dc',
  '--color-brand-700': '#4a28bd',
  '--color-brand-800': '#3a1b95',
  '--color-neon-200': '#04516d',
  '--color-neon-300': '#06739a',
  '--color-neon-400': '#0787b5',
  '--color-neon-500': '#0b9fd1',
  '--color-neon-600': '#0b98c4',
  '--color-live-300': '#bf1d4b',
  '--color-live-400': '#cf2655',
  '--color-live-500': '#d02a57',
  '--color-live-600': '#b01f49',
  '--color-ok-400': '#127a43',
  '--color-ok-500': '#16924f',
  '--color-warn-400': '#8a5700',
  // Texto escuro; "branco" vira o texto mais forte (títulos, item escolhido) e os véus claros viram escuros.
  '--color-fog-100': '#171a2b',
  '--color-fog-300': '#363b57',
  '--color-fog-400': '#525773',
  '--color-fog-500': '#62677f',
  '--color-white': '#10121c',
  '--shadow-glow': '0 6px 18px -8px rgb(106 67 240 / 0.45)',
  '--shadow-neon': '0 6px 18px -8px rgb(7 135 181 / 0.4)',
  '--shadow-panel': '0 0 0 1px rgb(23 26 43 / 0.06), 0 12px 32px -18px rgb(23 26 43 / 0.25)',
  '--cn-panel-border': 'rgb(23 26 43 / 0.08)',
  '--cn-panel-bg': 'linear-gradient(180deg, #ffffff, #fbfbfe)',
  '--cn-panel-shadow': '0 1px 2px rgb(23 26 43 / 0.06), 0 12px 32px -20px rgb(23 26 43 / 0.25)',
  '--cn-selected-border': 'rgb(106 67 240 / 0.45)',
  '--cn-selected-bg': 'linear-gradient(90deg, rgb(106 67 240 / 0.16), rgb(106 67 240 / 0.06))',
  '--cn-selected-shadow': 'inset 0 0 0 1px rgb(106 67 240 / 0.2)',
  '--glow-brand': 'rgb(106 67 240 / 0.35)',
  '--selection-bg': 'rgb(106 67 240 / 0.25)',
  '--backdrop-art': '0',
  '--call-card-s': '55%',
  '--call-card-l': '92%',
  '--dlg-bg': '#ffffff',
  '--dlg-text': '#171a2b',
  '--dlg-frame': 'linear-gradient(125deg, #7fc8ef 0%, #8b6dff 55%, #6a52b8 100%)',
  '--dlg-shadow': '0 30px 80px -30px rgb(23 26 43 / 0.45)',
  '--dlg-head-bg': 'linear-gradient(180deg, #f5f6fb 0%, #ffffff 100%)',
  '--dlg-head-line': 'linear-gradient(90deg, rgb(6 115 154 / 0.35), rgb(106 67 240 / 0.35), rgb(75 52 142 / 0.2))',
  '--dlg-accent': '#06739a',
  '--dlg-accent-soft': 'rgb(6 115 154 / 0.1)',
  '--dlg-input-bg': '#f3f4f9',
  '--dlg-input-border': '#d6dae6',
  '--dlg-secondary-border': '#b9a8f5',
  '--dlg-secondary-bg': 'rgb(106 67 240 / 0.08)',
  '--dlg-backdrop': 'rgb(23 26 43 / 0.45)',
};

export const THEMES: Record<ThemeId, ThemeDef> = {
  cosmic: { id: 'cosmic', name: 'Cosmic Night', description: 'Preto profundo, azul-claro e roxo, com gradientes discretos e brilho suave.', scheme: 'dark', vars: COSMIC },
  escuro: { id: 'escuro', name: 'Escuro', description: 'Preto e cinza bem escuros, quase sem brilho. Minimalista e confortável para sessões longas.', scheme: 'dark', vars: ESCURO },
  claro: { id: 'claro', name: 'Claro', description: 'Branco suave e cinza-claro, com azul nos destaques e roxo nos detalhes.', scheme: 'light', vars: CLARO },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export const isThemeId = (value: unknown): value is ThemeId => typeof value === 'string' && value in THEMES;

/** Aplica o tema no <html>: todas as variáveis de uma vez, mais o esquema de cores (barras de rolagem, campos). */
export function applyTheme(id: ThemeId, root: HTMLElement = document.documentElement): void {
  const theme = THEMES[id];
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.dataset.theme = id;
  root.style.colorScheme = theme.scheme;
}

// --- Contraste (WCAG) -----------------------------------------------------------------------------

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** Contraste entre duas cores #rrggbb (1 a 21). */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
