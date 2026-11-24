import { useId, type CSSProperties, type Ref } from 'react';
import type { CosmeticItem } from '../../../../shared/cosmetics.ts';
import './artwork-decoration.css';

type Geometry = { width: number; height: number; cx: number; cy: number; scale: number; trimBottom?: number };
const GRID: Geometry = { width: 113, height: 85, cx: 58, cy: 45, scale: 1.85 };
const GEOMETRY: Record<string, Geometry> = {
  'night-fury': { ...GRID, cx: 59 },
  'light-fury': { ...GRID, cx: 58 },
  'madu-kaiden': { width: 420, height: 366, cx: 215, cy: 187, scale: 1.45 },
  omen: { width: 114, height: 87, cx: 60, cy: 45, scale: 1.85, trimBottom: 7 },
  jett: { width: 114, height: 87, cx: 57, cy: 44, scale: 1.85, trimBottom: 7 },
  raze: { width: 114, height: 87, cx: 59, cy: 45, scale: 1.85, trimBottom: 7 },
  tejo: { width: 114, height: 87, cx: 57, cy: 45, scale: 1.85, trimBottom: 7 },
  rush: { width: 114, height: 87, cx: 57, cy: 45, scale: 1.85, trimBottom: 7 },
  hinata: { width: 358, height: 287, cx: 175, cy: 143, scale: 1.45 },
  barou: { width: 386, height: 344, cx: 195, cy: 174, scale: 1.45 },
  garou: { width: 415, height: 356, cx: 208, cy: 179, scale: 1.5 },
};

const BUTTERFLIES = [[-25, -23], [25, -21], [-25, 22], [24, 22]] as const;
const CAT = 'M-8.6 24 -2.6 27.6 3.8 27.4 10 23.8 9.8 34.5 6.9 39 .7 42.6 -6.4 40 -9.5 35Z';
const CROWN = 'M-27 -27 -24 -38 -17 -33 -13 -46 -7 -36 0 -50 4 -36 8 -44 10 -34 16 -47 15 -28 24 -23 15 -27 0 -30 -14 -29Z';

/** As camadas referenciam os PNGs originais. Máscaras só abrem espaço para a foto da pessoa. */
export function ArtworkDecoration({ item, theme, variant, size, src, badgeSrc, live, entrance, motionRef }: {
  item: CosmeticItem; theme: string; variant: string; size: number; src: string; badgeSrc: string;
  live: boolean; entrance: boolean; motionRef: Ref<SVGSVGElement>;
}) {
  const id = `cn-art-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const geometry = GEOMETRY[theme] ?? GRID;
  const unit = 100 / geometry.width;
  const center = item.presentation?.avatar?.center;
  const cx = center ? geometry.width * center[0] / 100 : geometry.cx;
  const cy = center ? geometry.height * center[1] / 100 : geometry.cy;
  const sourceBounds = { x: -cx * unit, y: -cy * unit, width: 100, height: geometry.height * unit };
  const maskAsset = item.presentation?.backdropMask;
  const extent = size * geometry.scale;
  const hole = 50 / geometry.scale;
  const isWings = theme === 'night-fury' || theme === 'light-fury';
  const accent = theme === 'madu-kaiden' ? CAT : theme === 'barou' ? CROWN : undefined;
  const accentOffset = `translate(${(geometry.cx - cx) * unit} ${(geometry.cy - cy) * unit})`;
  const [a, b] = item.variants.find((entry) => entry.id === variant)?.colors ?? item.variants[0]!.colors;
  const art = () => <use href={`#${id}-source`} mask={maskAsset ? `url(#${id}-source-mask)` : undefined} filter={theme === 'hinata' ? undefined : `url(#${id}-cutout)`} />;
  return <svg ref={motionRef} aria-hidden="true" viewBox="-50 -50 100 100"
    className={`cn-avatar-artwork cn-deco cn-artwork pointer-events-none absolute overflow-visible${live ? ' cn-deco-live' : ''}${entrance && live ? ' cn-deco-entrance' : ''}`}
    style={{ width: extent, height: extent, left: (size - extent) / 2, top: (size - extent) / 2,
      '--art-a': a, '--art-b': b } as CSSProperties}
    data-decoration={item.id} data-variant={variant} data-artwork-theme={theme}>
    <defs>
      {maskAsset && <mask id={id + '-source-mask'} maskUnits="userSpaceOnUse" {...sourceBounds} style={{ maskType: 'alpha' }}>
        <image href={import.meta.env.BASE_URL + maskAsset} {...sourceBounds} />
      </mask>}
      <image id={`${id}-source`} href={src} x={-cx * unit} y={-cy * unit}
        width="100" height={geometry.height * unit} preserveAspectRatio="xMidYMid meet" clipPath={`url(#${id}-bounds)`} />
      <clipPath id={`${id}-bounds`}><rect x={-cx * unit} y={-cy * unit} width="100" height={(geometry.height - (geometry.trimBottom ?? 0)) * unit} /></clipPath>
      {/* Preserva o RGB da arte e torna o fundo escuro transparente, inclusive em temas claros. */}
      <filter id={`${id}-cutout`} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  1 1 1 0 -0.12" />
        <feComponentTransfer><feFuncA type="table" tableValues="0 0 .45 .85 1" /></feComponentTransfer>
      </filter>
      <radialGradient id={`${id}-aperture`}>
        <stop offset={(hole - 1) / 50} stopColor="black" />
        <stop offset={(hole + .5) / 50} stopColor="white" />
        <stop offset=".9" stopColor="white" />
        <stop offset="1" stopColor="black" />
      </radialGradient>
      <mask id={`${id}-ring`} maskUnits="userSpaceOnUse" x="-55" y="-55" width="110" height="110" style={{ maskType: 'luminance' }}>
        <circle r="50" fill={`url(#${id}-aperture)`} />
      </mask>
      <mask id={`${id}-parts`} maskUnits="userSpaceOnUse" x="-55" y="-55" width="110" height="110" style={{ maskType: 'luminance' }}>
        <rect x="-55" y="-55" width="110" height="110" fill="white" />
        {theme === 'clove' && BUTTERFLIES.map(([x, y], index) => <ellipse key={index} cx={x} cy={y} rx="8" ry="8" fill="black" />)}
        {accent && <path d={accent} transform={accentOffset} fill="black" />}
      </mask>
      <clipPath id={`${id}-left`}><rect x="-55" y="-55" width="50" height="110" /></clipPath>
      <clipPath id={`${id}-right`}><rect x="5" y="-55" width="50" height="110" /></clipPath>
      <clipPath id={`${id}-spine`}><rect x="-5" y="-55" width="10" height="110" /></clipPath>
      <clipPath id={`${id}-butterfly-left`}><rect x="-10" y="-10" width="10" height="20" /></clipPath>
      <clipPath id={`${id}-butterfly-right`}><rect y="-10" width="10" height="20" /></clipPath>
      {accent && <clipPath id={`${id}-accent`}><path d={accent} transform={accentOffset} /></clipPath>}
    </defs>
    <g mask={`url(#${id}-ring)`}>
      {theme === 'clove' && <circle r="34" fill="none" stroke={b} strokeOpacity=".24" strokeWidth=".65" />}
      {isWings ? <>
        <g clipPath={`url(#${id}-spine)`}>{art()}</g>
        <g className="cn-art-motion cn-art-wing-left"><g clipPath={`url(#${id}-left)`}>{art()}</g></g>
        <g className="cn-art-motion cn-art-wing-right"><g clipPath={`url(#${id}-right)`}>{art()}</g></g>
      </> : <g className="cn-art-motion cn-art-orbit"><g className="cn-art-motion cn-art-flow" mask={`url(#${id}-parts)`}>{art()}</g></g>}
      {theme === 'omen' && <g className="cn-art-motion cn-art-smoke" opacity=".32">{art()}</g>}
      {theme === 'jett' && <g className="cn-art-motion cn-art-wind-echo" opacity=".28">{art()}</g>}
    </g>
    {accent && <g clipPath={`url(#${id}-accent)`} className="cn-art-motion cn-art-accent"><use href={`#${id}-source`} /></g>}
    {(theme === 'madu-kaiden' || theme === 'neon') && <g className="cn-art-motion cn-art-discharge-orbit">
      {[12, 88, 166, 238, 307].map((angle, index) => <g key={angle} transform={`rotate(${angle})`}>
        <path className="cn-art-motion cn-art-bolt" style={{ animationDelay: `${-index * .63}s` }}
          d="M-8 -34 -3 -39 -5 -40 3 -44 0 -39 6 -41 3 -36 8 -38" pathLength="1"
          fill="none" stroke={index % 2 ? a : b} strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round" />
      </g>)}
    </g>}
    {theme === 'rimuru' && <g className="cn-art-motion cn-art-slime-orbit">
      <g transform="translate(0 -35)"><g className="cn-art-motion cn-art-slime-upright"><g className="cn-art-motion cn-art-slime-wobble">
        <image href={badgeSrc} x="-8" y="-8" width="16" height="16" filter={`url(#${id}-cutout)`} />
      </g></g></g>
    </g>}
    {theme === 'clove' && BUTTERFLIES.map(([x, y], index) => <g key={index} transform={`translate(${x} ${y})`}>
      <g className="cn-art-motion cn-art-butterfly-flight" style={{ '--butterfly-delay': `${-index * .41}s`, '--flight-side': index % 2 ? 1 : -1 } as CSSProperties}>
        <g className="cn-art-motion cn-art-butterfly-left" clipPath={`url(#${id}-butterfly-left)`}>
          <image href={badgeSrc} x="-9" y="-9" width="18" height="18" filter={`url(#${id}-cutout)`} />
        </g>
        <g className="cn-art-motion cn-art-butterfly-right" clipPath={`url(#${id}-butterfly-right)`}>
          <image href={badgeSrc} x="-9" y="-9" width="18" height="18" filter={`url(#${id}-cutout)`} />
        </g>
      </g>
    </g>)}
    {theme === 'raze' && [18, 77, 143, 211, 278, 332].map((angle, index) => <g key={angle} transform={`rotate(${angle})`}>
      <path className="cn-art-motion cn-art-ember" style={{ animationDelay: `${-index * .37}s` }} d="M-1 -37 0 -40 1 -37 0 -35Z" fill={index % 2 ? a : b} />
    </g>)}
    {['tejo', 'garou', 'barou', 'light-fury'].includes(theme) && [32, 124, 217, 307].map((angle, index) => <g key={angle} transform={`rotate(${angle}) translate(0 -37)`}>
      <path className="cn-art-motion cn-art-glint" style={{ animationDelay: `${-index * .8}s` }} d="M0 -3 .6 -.6 3 0 .6 .6 0 3 -.6 .6 -3 0 -.6 -.6Z" fill={index % 2 ? a : b} />
    </g>)}
  </svg>;
}
