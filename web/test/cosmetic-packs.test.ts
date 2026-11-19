// Desenhos dos pacotes cosméticos: todo pacote do catálogo tem as 5 peças desenhadas, e cada desenho vira SVG válido,
// leve (sem imagens embutidas nem filtros pesados) e animado só com as classes cn-anim-* (transform e opacity).
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PACKS } from '../../shared/cosmetics.ts';
import { PACK_ART } from '../src/components/cosmetics/packs.tsx';

const svg = (box: string, child: unknown) => renderToStaticMarkup(createElement('svg', { viewBox: box }, createElement(Fragment, null, child as never)));

describe('desenhos dos pacotes', () => {
  it('cada pacote do catálogo tem desenho, e não sobra desenho sem pacote', () => {
    expect(Object.keys(PACK_ART).sort()).toEqual(PACKS.map((pack) => pack.id).sort());
  });

  for (const pack of PACKS) {
    it(`${pack.name}: decoração, moldura, fundo, cor do nome e enfeite`, () => {
      const art = PACK_ART[pack.id]!;
      const p = pack.palette;
      const pieces = [svg('-50 -50 100 100', art.decoration(p, 'g')), svg('0 0 320 96', art.backgroundArt(p)), svg('-10 -10 20 20', art.adornment(p))];
      for (const markup of pieces) {
        expect(markup.length).toBeGreaterThan(40);
        // Leve: nada de imagens embutidas, filtros (blur/sombra) ou scripts; animação só por classe.
        expect(markup).not.toMatch(/<image|<filter|<script|data:|<animate/);
      }
      expect(pieces[2]).toMatch(/<path|<circle/);
      expect(art.frame(p)).toMatch(/gradient\(/);
      expect(art.name(p)).toMatch(/^linear-gradient\(/);
      expect(Object.keys(art.background(p))).toContain('background');
    });
  }

  it('as animações usam só as classes leves conhecidas', () => {
    const known = new Set(['cn-anim-spin', 'cn-anim-twinkle', 'cn-anim-float', 'cn-anim-bob', 'cn-anim-flicker', 'cn-anim-flash', 'cn-anim-flap', 'cn-anim-sway', 'cn-anim-pulse', 'cn-anim-rise']);
    for (const pack of PACKS) {
      const art = PACK_ART[pack.id]!;
      const markup = svg('-50 -50 100 100', art.decoration(pack.palette, 'g')) + svg('-10 -10 20 20', art.adornment(pack.palette));
      for (const [, name] of markup.matchAll(/class="([^"]+)"/g)) expect(known.has(name!), `${pack.id}: ${name}`).toBe(true);
    }
  });
});
