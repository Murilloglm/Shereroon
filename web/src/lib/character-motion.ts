import { appearance, reducedMotion } from './appearance.ts';

interface Entry { visible: boolean; level: number; change: (level: number) => void }
const entries = new Map<Element, Entry>();
let visibility: IntersectionObserver | undefined;
let longTasks: PerformanceObserver | undefined;
let media: MediaQueryList | undefined;
let unsubscribe: (() => void) | undefined;
let restore: ReturnType<typeof setTimeout> | undefined;
let busy = false;
const levels = { desativado: 0, baixo: 1, medio: 2, alto: 3 };

function update() {
  const prefs = appearance.get();
  const requested = document.hidden || media?.matches || reducedMotion(prefs) ? 0 : levels[prefs.frameIntensity];
  const visible = [...entries].filter(([, entry]) => entry.visible);
  // A preview opened over a busy call should still move.
  visible.sort(([a], [b]) => Number(!!b.closest('[role=dialog]')) - Number(!!a.closest('[role=dialog]')));
  const limited = busy || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4);
  const level = limited || visible.length > 8 ? Math.min(requested, 1) : requested;
  const budget = limited ? 3 : level === 3 ? 8 : 5;
  const active = new Set(visible.slice(0, budget).map(([node]) => node));
  for (const [node, entry] of entries) {
    const next = active.has(node) ? level : 0;
    if (next !== entry.level) { entry.level = next; entry.change(next); }
  }
}

function start() {
  media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  unsubscribe = appearance.subscribe(update);
  visibility = new IntersectionObserver(records => {
    for (const record of records) {
      const entry = entries.get(record.target);
      if (entry) entry.visible = record.isIntersecting && record.intersectionRatio > 0;
    }
    update();
  });
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    let last = -Infinity;
    longTasks = new PerformanceObserver(list => {
      for (const task of list.getEntries()) {
        if (task.startTime - last < 1500) {
          busy = true;
          clearTimeout(restore);
          restore = setTimeout(() => { busy = false; update(); }, 6000);
          update();
        }
        last = task.startTime;
      }
    });
    longTasks.observe({ type: 'longtask' });
  }
}

export function observeCharacterEffect(node: Element, change: Entry['change']) {
  if (!entries.size) start();
  entries.set(node, { visible: false, level: 0, change });
  visibility!.observe(node);
  return () => {
    visibility?.unobserve(node);
    entries.delete(node);
    if (entries.size) { update(); return; }
    visibility?.disconnect();
    longTasks?.disconnect();
    unsubscribe?.();
    media?.removeEventListener('change', update);
    document.removeEventListener('visibilitychange', update);
    clearTimeout(restore);
    busy = false;
  };
}
