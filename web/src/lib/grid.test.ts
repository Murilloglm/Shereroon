// Grade da chamada: n cartões 16:9 no maior tamanho que cabe no espaço disponível.
import { describe, expect, it } from 'vitest';
import { bestGrid } from './grid.ts';

describe('bestGrid', () => {
  it('uma pessoa ocupa o espaço inteiro (limitada pela proporção)', () => {
    expect(bestGrid(1, 1600, 900, 8)).toMatchObject({ columns: 1, rows: 1, width: 1600, height: 900 });
    expect(bestGrid(1, 1600, 450, 8)).toMatchObject({ columns: 1, rows: 1, width: 800, height: 450 });
  });

  it('duas pessoas numa tela larga ficam lado a lado; numa estreita, uma em cima da outra', () => {
    expect(bestGrid(2, 1600, 600, 8)).toMatchObject({ columns: 2, rows: 1 });
    expect(bestGrid(2, 500, 900, 8)).toMatchObject({ columns: 1, rows: 2 });
  });

  it('muitas pessoas: escolhe a divisão com os maiores cartões e nunca passa do espaço', () => {
    for (const n of [3, 4, 5, 7, 9, 12, 16, 25]) {
      const grid = bestGrid(n, 1280, 720, 8);
      expect(grid.columns * grid.rows).toBeGreaterThanOrEqual(n);
      expect(grid.columns * grid.width + (grid.columns - 1) * 8).toBeLessThanOrEqual(1280 + 0.5);
      expect(grid.rows * grid.height + (grid.rows - 1) * 8).toBeLessThanOrEqual(720 + 0.5);
      expect(grid.width / grid.height).toBeCloseTo(16 / 9, 3);
    }
    expect(bestGrid(4, 1280, 720, 8)).toMatchObject({ columns: 2, rows: 2 });
  });

  it('sem espaço ou sem ninguém não quebra', () => {
    expect(bestGrid(0, 1280, 720, 8)).toMatchObject({ columns: 0, rows: 0 });
    expect(bestGrid(3, 0, 0, 8).width).toBe(0);
  });
});
