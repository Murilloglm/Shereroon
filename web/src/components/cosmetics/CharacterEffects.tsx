import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { characterEffect, type Motif } from '../../../../shared/character-effects.ts';
import { observeCharacterEffect } from '../../lib/character-motion.ts';
import './character-effects.css';

// Small highlights only. The original image and all foreground controls live outside these layers.
const shapes: Record<Motif, ReactNode> = {
  crown: <path d="m3 7 4 4 3-7 3 7 4-4-2 8H5z M5 17h10" />,
  spark: <path d="m10 1 .9 6.9L17 6l-5 4 4 4-5.4-1.8L10 19l-1-7-6 2 5-4-4-4 5 2z" fill="currentColor" stroke="none" />,
  lily: <g fill="currentColor" strokeWidth=".5"><path d="M10 13Q2 12 1 6q5 0 8 5Q3 5 5 1q4 2 5 9Q10 4 14 1q1 6-3 10 4-6 8-6-2 6-8 8 5-2 7 1-5 3-8 0-2 4-7 3 2-4 7-4Z"/><path d="m10 13-2-6m2 6 2-7m-2 7 5-5" stroke="var(--fx-secondary)" fill="none"/></g>,
  petal: <path d="M4 16Q3 7 16 3q1 10-12 13Z" fill="currentColor" />,
  crystal: <path d="m10 2 5 8-5 8-5-8z M10 2v16" />,
  sand: <g fill="currentColor" stroke="none"><circle cx="4" cy="13" r="1.6"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="10" r="1.3"/><circle cx="14" cy="4" r="1"/></g>,
  spiral: <path d="M2 9c3-8 16-6 15 2s-13 8-13 1 9-8 9-2-6 5-5 1" />,
  galaxy: <g transform="rotate(-25 10 10)"><path d="M1 12C2 2 19 3 18 10c-1 6-15 8-14 2 1-5 12-7 11-3-1 4-9 5-8 2"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/></g>,
  star: <path d="m10 1 2.3 6.7L19 10l-6.7 2.3L10 19l-2.3-6.7L1 10l6.7-2.3z" fill="currentColor" stroke="none" />,
  bolt: <path d="m14 1-11 11h6l-4 7L18 7h-7z" fill="currentColor" stroke="none"/>,
  paw: <g fill="currentColor" stroke="none"><ellipse cx="4" cy="8" rx="2" ry="2.7"/><ellipse cx="8" cy="5" rx="2" ry="3"/><ellipse cx="13" cy="5" rx="2" ry="3"/><ellipse cx="17" cy="9" rx="2" ry="2.6"/><path d="M4 15q1-4 5-6 3-1 6 4 3 5-2 4-3-2-6 0-4 1-3-2Z"/></g>,
  wing: <path d="M18 15Q13 5 1 3q3 5 6 6l-4-1q3 5 8 5l-3 1q5 3 10 1z" />,
  pearl: <g><circle cx="10" cy="10" r="5"/><path d="M7 9q0-2 3-3"/></g>,
  bubble: <g><circle cx="9" cy="11" r="6"/><path d="M6 10q0-2 3-3"/><circle cx="16" cy="4" r="2"/></g>,
  drop: <path d="M10 2Q1 13 6 16q4 4 8 0 5-4-4-14Z"/>,
  rune: <path d="m6 17 3-14 6 4-8 4 6 4"/>,
  butterfly: <g fill="currentColor" stroke="none"><path d="M10 10Q0-2 1 6q0 5 7 6-8 0-5 5 4 3 7-5 3 8 7 4 2-4-5-4 9-3 7-9-4-1-9 7Z"/></g>,
  mist: <g><path d="M1 11q4-6 9-2t9-2M3 15q5-5 9-2l5-1"/></g>,
  trail: <path d="m1 14 17-9M6 16l11-6M2 10l8-4"/>,
  feather: <path d="M3 17Q4 5 17 2q-1 11-11 13M2 18 14 5m-7 9 6-2"/>,
  burst: <path d="m9 2 2 5 6-4-3 6 5 1-6 2 2 6-5-4-3 5v-6l-6 1 5-5-3-5 6 4z"/>,
  marker: <path d="M2 7V3h5m6 0h5v4m0 6v4h-5m-6 0H2v-4m5-3h6m-3-3v6"/>,
  arrow: <path d="m2 4 7 6-7 6m8-12 7 6-7 6"/>,
};
const anchors = [[50,3],[86,80],[6,43],[18,85],[90,23]] as const;
function anchor(motif: Motif, index: number) {
  if (motif === 'wing') return index === 0 ? [5,38] : index === 2 ? [95,38] : [20,78];
  if (motif === 'lily' && index === 0) return [85,78];
  if (motif === 'petal' && index === 1) return [14,24];
  return anchors[index % anchors.length]!;
}

export function CharacterEffects({ theme, surface = 'avatar', speaking = false }: {
  theme: string; surface?: 'avatar' | 'frame'; speaking?: boolean;
}) {
  const preset = characterEffect(theme);
  const ref = useRef<HTMLSpanElement>(null);
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (ref.current && preset) return observeCharacterEffect(ref.current, setLevel);
  }, [preset]);
  if (!preset) return null;
  const count = Math.min(preset.maxParticles, [0, 2, 4, 5][level]!);
  const style = {
    '--fx-primary': preset.colors[0], '--fx-secondary': preset.colors[1],
    '--fx-period': preset.period + 's', '--fx-base': preset.intensity * (level === 1 ? .64 : .9),
    '--fx-gain': speaking ? preset.voiceGain : 1, '--fx-hover': preset.hoverGain,
  } as CSSProperties;
  return <span ref={ref} aria-hidden="true" className="cn-character-fx" style={style} data-theme-id={theme}
    data-fx-surface={surface} data-fx-track={preset.track} data-fx-level={level} data-fx-speaking={speaking || undefined}>
    {level > 0 && <>
      <span className="cn-fx-aura" />
      <svg className="cn-fx-track" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none">
        {surface === 'frame'
          ? <rect x="2" y="4" width="96" height="92" rx="5" vectorEffect="non-scaling-stroke" />
          : <circle cx="50" cy="50" r="47" vectorEffect="non-scaling-stroke" />}
      </svg>
      {Array.from({ length: count }, (_, i) => {
        const motif = preset.motifs[i % preset.motifs.length]!;
        const [x,y] = anchor(motif, i);
        return <span key={i} className="cn-fx-anchor" style={{ left: x+'%', top: y+'%', '--fx-delay': (-i*preset.period*.23)+'s' } as CSSProperties}>
          <svg viewBox="0 0 20 20" className="cn-fx-motif" data-motif={motif} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" fill="none">
            <g transform={motif === 'wing' && i !== 0 ? 'translate(20 0) scale(-1 1)' : undefined}>{shapes[motif]}</g>
          </svg>
        </span>;
      })}
    </>}
  </span>;
}
