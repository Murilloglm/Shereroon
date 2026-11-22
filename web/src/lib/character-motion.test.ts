import { afterEach, expect, it, vi } from 'vitest';
import { appearance } from './appearance.ts';
import { observeCharacterEffect } from './character-motion.ts';

const initial = appearance.get();
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  appearance.set(initial);
  vi.unstubAllGlobals();
});

it('limits visible effects, prioritizes an open preview and frees slots on exit', () => {
  let intersect: (records: { target: Element; isIntersecting: boolean; intersectionRatio: number }[]) => void;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {}
    unobserve() {}
    disconnect = disconnect;
  });
  const media = Object.assign(new EventTarget(), { matches: false });
  const doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { hardwareConcurrency: 12 });
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('PerformanceObserver', undefined);
  appearance.set({ frameIntensity: 'alto' });
  const nodes = Array.from({ length: 12 }, (_, i) => ({ closest: () => i === 11 ? {} : null }) as unknown as Element);
  const levels = nodes.map(() => 0);
  for (const [i, node] of nodes.entries()) cleanups.push(observeCharacterEffect(node, level => { levels[i] = level; }));
  function show(indices: number[]) {
    intersect(nodes.map((target, i) => ({ target, isIntersecting: indices.includes(i), intersectionRatio: Number(indices.includes(i)) })));
  }
  show(nodes.map((_, i) => i));
  expect(levels.filter(Boolean)).toEqual([1,1,1,1,1]);
  expect(levels[11]).toBe(1);
  show([3,4,8]);
  expect(levels.filter(Boolean)).toEqual([3,3,3]);
  expect(levels[8]).toBe(3);
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(levels.every(level => level === 0)).toBe(true);
  doc.hidden = false;
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(levels[8]).toBe(3);
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  expect(levels.every(level => level === 0)).toBe(true);
  while (cleanups.length) cleanups.pop()!();
  expect(disconnect).toHaveBeenCalledOnce();
});
