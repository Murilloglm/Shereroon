// Os três temas: mesmas variáveis em todos, contraste suficiente para ler, e o padrão igual ao CSS (que é o que
// aparece antes do JavaScript carregar).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, THEME_IDS, THEMES } from './themes.ts';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

describe('temas', () => {
  it('existem Cosmic Night (padrão), Escuro e Claro, com as mesmas variáveis', () => {
    expect(THEME_IDS).toEqual(['cosmic', 'escuro', 'claro']);
    const keys = Object.keys(THEMES.cosmic.vars).sort();
    for (const id of THEME_IDS) expect(Object.keys(THEMES[id].vars).sort()).toEqual(keys);
    expect(THEMES.claro.scheme).toBe('light');
  });

  it('o padrão (Cosmic Night) é o mesmo que o CSS define', () => {
    for (const [name, value] of Object.entries(THEMES.cosmic.vars)) {
      const escaped = name.replace(/[-]/g, '\\-');
      const match = new RegExp(`${escaped}:\\s*([^;]+);`).exec(css);
      expect(match, `${name} no index.css`).not.toBeNull();
      expect(match![1]!.replace(/\s+/g, ' ').trim(), name).toBe(value);
    }
  });

  for (const id of THEME_IDS) {
    it(`contraste do tema ${THEMES[id].name}`, () => {
      const v = THEMES[id].vars;
      const pairs: [string, string, string, number][] = [
        ['texto principal no fundo', '--color-fog-100', '--color-ink-900', 7],
        ['texto principal nos painéis', '--color-fog-100', '--color-ink-850', 7],
        ['texto secundário', '--color-fog-300', '--color-ink-850', 4.5],
        ['texto de apoio', '--color-fog-400', '--color-ink-850', 4.5],
        ['texto discreto', '--color-fog-500', '--color-ink-900', 4],
        ['destaque roxo em texto', '--color-brand-300', '--color-ink-850', 4.5],
        ['destaque azul em texto', '--color-neon-300', '--color-ink-850', 4.5],
        ['alerta em texto', '--color-live-300', '--color-ink-850', 4.5],
        ['sucesso', '--color-ok-400', '--color-ink-850', 3],
        ['aviso', '--color-warn-400', '--color-ink-850', 3],
        ['texto sobre botão roxo', '--color-on-accent', '--color-brand-500', 4.5],
        ['texto sobre botão vermelho', '--color-on-accent', '--color-live-500', 4],
        ['texto dos diálogos', '--dlg-text', '--dlg-bg', 7],
        ['destaque dos diálogos', '--dlg-accent', '--dlg-bg', 4.5],
      ];
      for (const [what, fg, bg, min] of pairs) {
        expect(contrast(v[fg]!, v[bg]!), `${what}: ${v[fg]} sobre ${v[bg]}`).toBeGreaterThanOrEqual(min);
      }
    });
  }
});
