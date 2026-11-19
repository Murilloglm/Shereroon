// Desenhos dos pacotes cosméticos (shared/cosmetics.ts → PACKS). Um conjunto por pacote: decoração em volta do
// avatar, contorno da moldura, fundo de perfil, cor do nome e o enfeite ao lado do nick.
//
// Todos são originais do Cosmic Night, feitos só com formas simples em SVG e gradientes CSS: temas (dragão da noite,
// gato elétrico, slime...) sem personagens, logotipos ou artes de terceiros. As animações usam só transform e
// opacity (classes cn-anim-* em index.css) e ficam paradas nas listas e com animações reduzidas.
//
// Para lançar um pacote: acrescente-o em PACK_SPECS (shared/cosmetics.ts) e um PackArt com o mesmo id aqui.
import type { CSSProperties, ReactNode } from 'react';
import type { PackPalette } from '../../../../shared/cosmetics.ts';

export interface PackArt {
  /** Decoração no quadro -50..50, com o avatar no centro (raio ~37). `gradient` é o id de um gradiente glow→accent. */
  decoration: (p: PackPalette, gradient: string) => ReactNode;
  /** Fundo do contorno da moldura (CSS), recortado em anel em volta do avatar e na borda do cartão de perfil. */
  frame: (p: PackPalette) => string;
  /** Fundo de perfil: o CSS da faixa e um desenho por cima (quadro 0..320 × 0..96, cortado para caber). */
  background: (p: PackPalette) => CSSProperties;
  backgroundArt: (p: PackPalette) => ReactNode;
  /** Gradiente do nome (legível nos temas escuro e claro). */
  name: (p: PackPalette) => string;
  /** Enfeite ao lado do nick, no quadro -10..10. Pode ter partes animadas (cn-anim-*). */
  adornment: (p: PackPalette) => ReactNode;
}

// --- Formas -------------------------------------------------------------------------------------------

/** Ponto no círculo de raio `r`, com 0° no topo e sentido horário. */
const polar = (deg: number, r: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [Math.round(Math.cos(a) * r * 100) / 100, Math.round(Math.sin(a) * r * 100) / 100];
};
/** Leva um desenho feito "em pé" na origem para o ponto do anel no ângulo `deg`, virado para fora. */
const at = (deg: number, r: number) => `rotate(${deg}) translate(0 ${-r})`;
/** Arco de `from` a `to` graus (sentido horário). */
const arc = (r: number, from: number, to: number) => {
  const [x0, y0] = polar(from, r);
  const [x1, y1] = polar(to, r);
  return `M${x0} ${y0} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};
/** Estrela de quatro pontas. */
const star4 = (r: number) => {
  const k = r * 0.28;
  return `M0 ${-r} L${k} ${-k} L${r} 0 L${k} ${k} L0 ${r} L${-k} ${k} L${-r} 0 L${-k} ${-k}Z`;
};
/** Estouro de quadrinho com `n` pontas. */
const burst = (n: number, inner: number, outer: number) =>
  `${Array.from({ length: n * 2 }, (_, i) => {
    const [x, y] = polar((i * 180) / n, i % 2 ? inner : outer);
    return `${i ? 'L' : 'M'}${x} ${y}`;
  }).join(' ')}Z`;
const BOLT = '0,-8 -3,-1 1,-1 -2,7';

function Butterfly({ p, flap = true }: { p: PackPalette; flap?: boolean }) {
  return (
    <g>
      <path
        className={flap ? 'cn-anim-flap' : undefined}
        d="M0 0 C-3 -6 -9 -7 -9 -2 C-9 2 -4 3 0 0 Z M0 0 C3 -6 9 -7 9 -2 C9 2 4 3 0 0 Z M0 0 C-2 3 -6 6 -5 8 C-3 8 -1 5 0 0 Z M0 0 C2 3 6 6 5 8 C3 8 1 5 0 0 Z"
        fill={p.glow}
        fillOpacity="0.9"
        stroke={p.accent}
        strokeWidth="0.7"
      />
      <path d="M0 -3 L0 4" stroke={p.accent} strokeWidth="1" strokeLinecap="round" />
    </g>
  );
}

const twinkle = (index: number) => ({ animationDelay: `${(index * 0.37) % 2}s` });
const Sky = ({ children }: { children: ReactNode }) => <>{children}</>;

// --- Pacotes ------------------------------------------------------------------------------------------

export const PACK_ART: Record<string, PackArt> = {
  'asa-meia-noite': {
    decoration: (p, g) => (
      <>
        <path d={arc(41, 210, 500)} fill="none" stroke={p.ink} strokeWidth="7" strokeLinecap="round" />
        <path d={arc(41, 210, 500)} fill="none" stroke={`url(#${g})`} strokeWidth="2.2" strokeDasharray="2.5 3.5" strokeLinecap="round" />
        {[-1, 1].map((side) => (
          <g key={side} transform={`scale(${side} 1)`}>
            <path className="cn-anim-flap" d="M30 -26 C40 -46 58 -50 66 -40 C58 -38 56 -32 56 -28 C62 -26 64 -20 62 -14 C56 -18 50 -18 46 -14 C48 -20 40 -24 30 -18 Z" fill={p.ink} stroke={p.glow} strokeWidth="1.2" strokeLinejoin="round" />
          </g>
        ))}
        <g transform="translate(0 -44)">
          <path d="M-6 -7 L-10 -15 L-3 -9 Z M6 -7 L10 -15 L3 -9 Z" fill={p.ink} stroke={p.glow} strokeWidth="0.8" />
          <path d="M-9 4 C-9 -4 -5 -9 0 -10 C5 -9 9 -4 9 4 C5 7 -5 7 -9 4 Z" fill={p.ink} stroke={p.glow} strokeWidth="1" />
          <ellipse className="cn-anim-twinkle" cx="-3.6" cy="-1" rx="2" ry="1.3" fill={p.glow} />
          <ellipse className="cn-anim-twinkle" cx="3.6" cy="-1" rx="2" ry="1.3" fill={p.glow} />
        </g>
        <path transform={at(140, 41)} d="M0 -6 L8 3 L-2 3 Z" fill={p.ink} stroke={p.glow} strokeWidth="0.9" />
        {[[-36, 30], [38, 22], [20, 42], [-20, 44]].map(([x, y], index) => (
          <path key={index} className="cn-anim-twinkle" style={twinkle(index)} transform={`translate(${x} ${y})`} d={star4(index % 2 ? 2.2 : 3)} fill={p.accent} />
        ))}
      </>
    ),
    frame: (p) => `conic-gradient(from 0deg, ${p.glow}, ${p.accent}, ${p.ink}, ${p.glow}, ${p.ink}, ${p.accent}, ${p.glow})`,
    background: (p) => ({ background: `radial-gradient(40% 80% at 75% 35%, ${p.glow}55, transparent 70%), linear-gradient(180deg, ${p.ink}, ${p.base})` }),
    backgroundArt: (p) => (
      <Sky>
        {[[30, 14], [70, 30], [130, 12], [180, 26], [290, 16], [210, 8]].map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r={index % 2 ? 0.9 : 1.4} fill="#fff" fillOpacity="0.8" />
        ))}
        <circle cx="244" cy="36" r="22" fill="#e9e6ff" fillOpacity="0.92" />
        <circle cx="236" cy="30" r="4" fill={p.ink} fillOpacity="0.15" />
        <circle cx="252" cy="44" r="6" fill={p.ink} fillOpacity="0.12" />
        <path d="M70 46 C78 36 88 34 94 40 C98 36 104 36 108 40 C114 34 124 36 132 46 C122 42 114 44 108 48 L101 52 L94 48 C88 44 80 42 70 46 Z" fill={p.base} stroke={p.glow} strokeWidth="0.8" />
        <path d="M0 96 L0 74 C40 64 70 78 110 70 C150 62 190 80 230 70 C270 60 300 72 320 66 L320 96 Z" fill={p.base} fillOpacity="0.9" />
      </Sky>
    ),
    name: (p) => `linear-gradient(90deg, ${p.glow}, ${p.accent})`,
    adornment: (p) => (
      <>
        {[-1, 1].map((side) => (
          <g key={side} transform={`scale(${side} 1)`}>
            <path className="cn-anim-flap" d="M1.5 0 C3 -5 7 -7 9.5 -5 C8 -4 8 -2 8.5 -1 C7 -1.5 6 -1 5.5 0 C5 -1 3.5 -0.5 1.5 1.5 Z" fill={p.ink} stroke={p.glow} strokeWidth="0.8" />
          </g>
        ))}
        <path d="M0 -3 L1.8 0 L0 3.4 L-1.8 0 Z" fill={p.accent} />
      </>
    ),
  },

  'asa-aurora': {
    decoration: (p) => (
      <>
        <g className="cn-anim-spin" style={{ animationDuration: '24s' }}>
          <circle r="45" fill="none" stroke={p.ink} strokeOpacity="0.55" strokeWidth="1" strokeDasharray="1 5" strokeLinecap="round" />
        </g>
        <circle r="41" fill="none" stroke={p.accent} strokeWidth="4.5" />
        <circle r="41" fill="none" stroke={p.glow} strokeWidth="1.4" />
        {[220, 238, 256, 104, 122, 140].map((angle, index) => (
          <g key={angle} transform={at(angle, 46)}>
            <path className="cn-anim-sway" style={twinkle(index)} d="M0 6 C-4 0 -3 -8 0 -12 C3 -8 4 0 0 6 Z" fill={p.accent} stroke={p.ink} strokeWidth="0.7" />
          </g>
        ))}
        <g transform={at(28, 44)}>
          <path d="M-3 -6 L-9 -14 L0 -8 Z" fill={p.accent} stroke={p.ink} strokeWidth="0.7" />
          <path d="M-7 3 C-8 -3 -3 -8 3 -7 C7 -6 9 -2 8 2 C5 5 -3 6 -7 3 Z" fill={p.accent} stroke={p.ink} strokeWidth="0.8" />
          <path d="M1 -2 Q3 -0.5 5 -2" fill="none" stroke={p.ink} strokeWidth="0.8" strokeLinecap="round" />
        </g>
        {[[-10, 43, 6], [0, 46, 7], [10, 43, 6]].map(([x, y, r], index) => (
          <circle key={index} cx={x} cy={y} r={r} fill={p.accent} stroke={p.ink} strokeWidth="0.6" />
        ))}
        {[[-40, -20], [42, 28], [-30, 34], [36, -30]].map(([x, y], index) => (
          <path key={index} className="cn-anim-twinkle" style={twinkle(index)} transform={`translate(${x} ${y})`} d={star4(index % 2 ? 2.4 : 3.2)} fill="#ffe7a8" />
        ))}
      </>
    ),
    frame: (p) => `conic-gradient(from 30deg, #ffffff, ${p.glow}, #f4ecff, ${p.ink}, #ffffff, ${p.glow}, #ffffff)`,
    background: (p) => ({ background: `linear-gradient(180deg, #f7faff, ${p.base} 60%, #d6e3ff)` }),
    backgroundArt: (p) => (
      <Sky>
        <path d="M0 40 C60 10 120 60 180 30 S290 20 320 34 L320 50 C260 40 220 70 160 48 S40 42 0 60 Z" fill={p.glow} fillOpacity="0.35" />
        <path d="M0 28 C70 4 130 44 200 22 S300 14 320 20 L320 30 C250 24 210 50 150 34 S50 30 0 44 Z" fill={p.ink} fillOpacity="0.18" />
        {[[30, 84, 14], [52, 88, 12], [250, 86, 16], [276, 90, 12], [150, 92, 10]].map(([x, y, r], index) => (
          <circle key={index} cx={x} cy={y} r={r} fill="#ffffff" />
        ))}
        {[[90, 18], [210, 12], [300, 40], [40, 20]].map(([x, y], index) => (
          <path key={index} transform={`translate(${x} ${y})`} d={star4(3)} fill="#ffd98a" />
        ))}
      </Sky>
    ),
    name: () => 'linear-gradient(90deg, #6fbfff, #a99cff)',
    adornment: (p) => (
      <>
        <path className="cn-anim-twinkle" d={star4(8.5)} fill={p.accent} stroke={p.ink} strokeWidth="0.9" />
        <path className="cn-anim-twinkle" style={{ animationDelay: '0.8s' }} transform="translate(6.5 -6.5)" d={star4(2.6)} fill={p.glow} />
      </>
    ),
  },

  'gato-trovao': {
    decoration: (p) => (
      <>
        <circle r="41" fill="none" stroke={p.glow} strokeWidth="3" />
        <circle r="41" fill="none" stroke={p.accent} strokeWidth="1" strokeDasharray="10 6" />
        {[-1, 1].map((side) => (
          <g key={side} transform={`scale(${side} 1)`}>
            <path d="M12 -38 L24 -57 L32 -32 Z" fill={p.accent} stroke={p.glow} strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M17 -38 L23 -49 L28 -35 Z" fill={p.glow} fillOpacity="0.75" />
          </g>
        ))}
        <g className="cn-anim-sway" style={{ animationDuration: '2.6s' }}>
          <path d="M-29 30 C-50 38 -55 14 -45 7" fill="none" stroke={p.accent} strokeWidth="6" strokeLinecap="round" />
          <path d="M-29 30 C-50 38 -55 14 -45 7" fill="none" stroke={p.ink} strokeWidth="6" strokeDasharray="3 5" />
        </g>
        <g transform="translate(33 33)">
          <circle r="5" fill={p.glow} />
          {[[-5, -6], [-1.5, -8.5], [2.5, -8], [5.5, -5]].map(([x, y], index) => (
            <circle key={index} cx={x} cy={y} r="1.8" fill={p.glow} />
          ))}
        </g>
        {[70, 160, 250, 320].map((angle, index) => (
          <polyline key={angle} className="cn-anim-flash" style={{ animationDelay: `${index * 0.4}s` }} transform={at(angle, 47)} points={BOLT} fill="none" stroke={index % 2 ? p.glow : p.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </>
    ),
    frame: (p) => `repeating-conic-gradient(${p.glow} 0 18deg, ${p.accent} 18deg 30deg)`,
    background: (p) => ({ background: `radial-gradient(60% 90% at 80% 20%, ${p.accent}44, transparent 70%), linear-gradient(135deg, ${p.base}, #2a1a04)` }),
    backgroundArt: (p) => (
      <Sky>
        {[[40, 6, 1.6], [150, 0, 1.2], [260, 10, 1.8]].map(([x, y, s], index) => (
          <polyline key={index} transform={`translate(${x} ${y}) scale(${s! * 3})`} points={BOLT} fill="none" stroke={index % 2 ? p.accent : p.glow} strokeWidth="0.7" strokeLinejoin="round" />
        ))}
        {[[24, 70], [60, 82], [200, 74], [300, 84]].map(([x, y], index) => (
          <g key={index} transform={`translate(${x} ${y}) rotate(${index * 25 - 20})`} fill={p.glow} fillOpacity="0.35">
            <circle r="5" />
            <circle cx="-5" cy="-6" r="1.8" />
            <circle cx="-1.5" cy="-8.5" r="1.8" />
            <circle cx="2.5" cy="-8" r="1.8" />
            <circle cx="5.5" cy="-5" r="1.8" />
          </g>
        ))}
      </Sky>
    ),
    name: (p) => `linear-gradient(90deg, ${p.glow}, ${p.accent})`,
    adornment: (p) => (
      <>
        <g className="cn-anim-sway" style={{ animationDuration: '3.4s' }}>
          <path d="M-7.5 -1 L-7.5 -8.5 L-3 -4.8 C-1 -5.3 1 -5.3 3 -4.8 L7.5 -8.5 L7.5 -1 C7.5 4 4 7.5 0 7.5 C-4 7.5 -7.5 4 -7.5 -1 Z" fill={p.accent} stroke={p.ink} strokeWidth="0.8" strokeLinejoin="round" />
          <path d="M-5 0 L-1.8 0.4 M1.8 0.4 L5 0" stroke={p.ink} strokeWidth="1.2" strokeLinecap="round" />
          <path d="M-1.4 3.6 Q0 2.7 1.4 3.6" fill="none" stroke={p.ink} strokeWidth="0.8" strokeLinecap="round" />
        </g>
        <path className="cn-anim-flash" d="M8 -10 L5 -3.5 L7.5 -3.5 L5.5 2 L10.5 -5.5 L8 -5.5 Z" fill={p.glow} />
      </>
    ),
  },

  'slime-celeste': {
    decoration: (p) => (
      <>
        <circle className="cn-anim-pulse" r="42" fill="none" stroke={p.glow} strokeOpacity="0.45" strokeWidth="6" />
        <circle r="40" fill="none" stroke={p.accent} strokeWidth="1.2" />
        <g className="cn-anim-spin" style={{ animationDuration: '30s' }}>
          <circle r="46.5" fill="none" stroke={p.glow} strokeOpacity="0.4" strokeWidth="0.8" strokeDasharray="6 3 1 3" />
        </g>
        {[40, 130, 220, 310].map((angle, index) => (
          <g key={angle} transform={at(angle, 45)}>
            <path className="cn-anim-bob" style={twinkle(index)} d="M0 -6 C3 -2 4 1 4 3 A4 4 0 0 1 -4 3 C-4 1 -3 -2 0 -6 Z" fill={p.glow} stroke={p.accent} strokeWidth="0.6" />
          </g>
        ))}
        {Array.from({ length: 8 }, (_, index) => {
          const [x, y] = polar(index * 45 + 20, 47 + (index % 2) * 2);
          return <circle key={index} className="cn-anim-float" style={twinkle(index)} cx={x} cy={y} r={1.2 + (index % 3) * 0.6} fill="none" stroke={p.accent} strokeWidth="0.7" />;
        })}
      </>
    ),
    frame: (p) => `conic-gradient(${p.glow}, ${p.accent}, ${p.glow}, ${p.ink}, ${p.glow})`,
    background: (p) => ({ background: `radial-gradient(70% 90% at 30% 100%, ${p.glow}55, transparent 70%), linear-gradient(180deg, #0a2a52, ${p.base})` }),
    backgroundArt: (p) => (
      <Sky>
        <circle cx="250" cy="44" r="26" fill="none" stroke={p.glow} strokeOpacity="0.45" strokeWidth="1" strokeDasharray="5 3 1 3" />
        <circle cx="250" cy="44" r="18" fill="none" stroke={p.accent} strokeOpacity="0.35" strokeWidth="0.8" />
        {[[40, 50, 4], [70, 30, 2.5], [120, 56, 3], [170, 24, 2], [300, 70, 3.5]].map(([x, y, r], index) => (
          <circle key={index} cx={x} cy={y} r={r} fill="none" stroke={p.accent} strokeOpacity="0.7" strokeWidth="0.8" />
        ))}
        <path d="M0 80 C30 72 50 88 80 80 S130 72 160 80 S210 88 240 80 S290 72 320 80 L320 96 L0 96 Z" fill={p.glow} fillOpacity="0.3" />
      </Sky>
    ),
    name: (p) => `linear-gradient(90deg, ${p.glow}, ${p.accent})`,
    adornment: (p) => (
      <g className="cn-anim-bob">
        <path d="M-8 6.5 C-8 -1 -4 -7 0 -7 C4 -7 8 -1 8 6.5 Z" fill={p.glow} stroke={p.ink} strokeWidth="0.8" />
        <circle cx="-2.6" cy="0.6" r="1.1" fill={p.ink} />
        <circle cx="2.6" cy="0.6" r="1.1" fill={p.ink} />
        <path d="M-1.5 3 Q0 4.2 1.5 3" fill="none" stroke={p.ink} strokeWidth="0.7" strokeLinecap="round" />
        <ellipse cx="-3.6" cy="-3.4" rx="1.6" ry="1" fill="#fff" fillOpacity="0.75" />
      </g>
    ),
  },

  'nevoa-eterea': {
    decoration: (p, g) => (
      <>
        <circle r="41" fill="none" stroke={p.ink} strokeWidth="6" strokeOpacity="0.8" />
        <g className="cn-anim-spin" style={{ animationDuration: '18s' }}>
          {[0, 120, 240].map((angle) => (
            <path key={angle} d={arc(44, angle, angle + 70)} fill="none" stroke={p.glow} strokeOpacity="0.35" strokeWidth="5" strokeLinecap="round" />
          ))}
        </g>
        <circle r="41" fill="none" stroke={`url(#${g})`} strokeWidth="1.6" />
        {[[30, 46, 1], [150, 47, 0.8], [250, 45, 0.9], [330, 48, 0.7]].map(([angle, r, scale], index) => (
          <g key={index} transform={`${at(angle!, r!)} scale(${scale})`} style={twinkle(index)}>
            <Butterfly p={p} />
          </g>
        ))}
      </>
    ),
    frame: (p) => `conic-gradient(from 90deg, ${p.glow}, ${p.accent}, ${p.ink} 40%, ${p.glow} 60%, ${p.accent}, ${p.glow})`,
    background: (p) => ({ background: `radial-gradient(60% 90% at 70% 40%, ${p.glow}55, transparent 70%), radial-gradient(50% 70% at 20% 80%, ${p.accent}33, transparent 70%), ${p.base}` }),
    backgroundArt: (p) => (
      <Sky>
        {[[40, 60, 120, 14], [200, 72, 150, 12], [120, 30, 90, 8]].map(([x, y, rx, ry], index) => (
          <ellipse key={index} cx={x} cy={y} rx={rx} ry={ry} fill={p.glow} fillOpacity="0.12" />
        ))}
        {[[60, 30, 1.6, -15], [150, 54, 1.2, 10], [250, 28, 1.8, 20], [290, 66, 1, -10]].map(([x, y, s, r], index) => (
          <g key={index} transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
            <Butterfly p={p} flap={false} />
          </g>
        ))}
      </Sky>
    ),
    name: (p) => `linear-gradient(90deg, ${p.glow}, ${p.accent})`,
    adornment: (p) => <Butterfly p={p} />,
  },

  'corrente-veloz': {
    decoration: (p, g) => (
      <>
        <g className="cn-anim-spin" style={{ animationDuration: '2.8s' }}>
          <path d={arc(42, 0, 110)} fill="none" stroke={`url(#${g})`} strokeWidth="3.5" strokeLinecap="round" />
          <path d={arc(42, 140, 250)} fill="none" stroke={`url(#${g})`} strokeWidth="3.5" strokeLinecap="round" />
          <path d={arc(42, 280, 340)} fill="none" stroke={p.accent} strokeWidth="3.5" strokeLinecap="round" />
        </g>
        <circle r="46" fill="none" stroke={p.glow} strokeOpacity="0.3" strokeWidth="1" />
        {[20, 110, 200, 290].map((angle, index) => (
          <polyline key={angle} className="cn-anim-flash" style={{ animationDelay: `${index * 0.35}s` }} transform={at(angle, 47)} points="0,-9 -3,-2 1,-2 -2,8" fill="none" stroke={p.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        <path className="cn-anim-twinkle" d="M-60 -10 L-47 -10 M-64 0 L-48 0 M-60 10 L-47 10" stroke={p.glow} strokeOpacity="0.7" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
    frame: (p) => `repeating-conic-gradient(${p.glow} 0 40deg, ${p.accent} 40deg 46deg)`,
    background: (p) => ({ background: `linear-gradient(115deg, ${p.base}, ${p.ink} 55%, ${p.base})` }),
    backgroundArt: (p) => (
      <Sky>
        {Array.from({ length: 9 }, (_, index) => (
          <path key={index} d={`M${index * 40 - 30} ${96} L${index * 40 + 30} 0`} stroke={index % 3 ? p.glow : p.accent} strokeOpacity={index % 3 ? 0.25 : 0.4} strokeWidth={index % 3 ? 1 : 2} />
        ))}
        <polyline transform="translate(230 20) scale(5)" points={BOLT} fill="none" stroke={p.accent} strokeWidth="0.6" strokeLinejoin="round" />
      </Sky>
    ),
    name: () => 'linear-gradient(90deg, #4d8dff, #ffcf33)',
    adornment: (p) => <path className="cn-anim-twinkle" d="M2 -9.5 L-5.5 1 L-0.5 1 L-2.5 9.5 L5.5 -2 L0.5 -2 Z" fill={p.accent} stroke={p.glow} strokeWidth="1" strokeLinejoin="round" />,
  },

  'veu-sombras': {
    decoration: (p) => (
      <>
        <circle r="41" fill="none" stroke={p.ink} strokeWidth="7" />
        <g className="cn-anim-spin" style={{ animationDuration: '14s' }}>
          {Array.from({ length: 9 }, (_, index) => {
            const [x, y] = polar(index * 40, 44 + (index % 3) * 2);
            return <circle key={index} className="cn-anim-twinkle" style={twinkle(index)} cx={x} cy={y} r={4 + (index % 3) * 1.5} fill={index % 2 ? p.glow : p.ink} fillOpacity="0.55" />;
          })}
        </g>
        {[60, 180, 300].map((angle, index) => (
          <g key={angle} transform={at(angle, 44)}>
            <path className="cn-anim-rise" style={twinkle(index)} d="M0 0 C4 -6 -2 -10 2 -16" fill="none" stroke={p.accent} strokeOpacity="0.8" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        ))}
        <circle r="41" fill="none" stroke={p.accent} strokeOpacity="0.5" strokeWidth="1" />
      </>
    ),
    frame: (p) => `conic-gradient(${p.ink}, ${p.glow}, ${p.ink}, ${p.accent}, ${p.ink})`,
    background: (p) => ({ background: `radial-gradient(30% 70% at 50% 55%, #000 0 35%, ${p.glow}55 50%, transparent 72%), linear-gradient(180deg, ${p.ink}, ${p.base})` }),
    backgroundArt: (p) => (
      <Sky>
        {[34, 26, 18].map((r, index) => (
          <ellipse key={r} cx="160" cy="52" rx={r * 1.8} ry={r} fill="none" stroke={index ? p.accent : p.glow} strokeOpacity={0.5 - index * 0.12} strokeWidth="1" />
        ))}
        {[[40, 70, 14], [80, 80, 10], [260, 74, 16], [300, 60, 9]].map(([x, y, r], index) => (
          <circle key={index} cx={x} cy={y} r={r} fill={p.ink} fillOpacity="0.8" />
        ))}
      </Sky>
    ),
    name: () => 'linear-gradient(90deg, #7a7aff, #b3a8ff)',
    adornment: (p) => (
      <>
        <path d="M-7 8.5 C-8 0 -5 -8 0 -9.5 C5 -8 8 0 7 8.5 Z" fill={p.ink} stroke={p.glow} strokeWidth="0.9" />
        <path d="M-4 8.5 C-4.5 2 -2.5 -3 0 -3.5 C2.5 -3 4.5 2 4 8.5 Z" fill="#05060f" />
        <circle className="cn-anim-twinkle" cx="-1.6" cy="1.6" r="0.9" fill={p.accent} />
        <circle className="cn-anim-twinkle" cx="1.6" cy="1.6" r="0.9" fill={p.accent} />
      </>
    ),
  },

  'lamina-vento': {
    decoration: (p) => (
      <>
        <g className="cn-anim-spin" style={{ animationDuration: '7s' }}>
          {[0, 90, 180, 270].map((angle) => (
            <path key={angle} d={arc(43, angle, angle + 55)} fill="none" stroke={p.accent} strokeWidth="2.4" strokeLinecap="round" />
          ))}
          {[40, 130, 220, 310].map((angle) => (
            <path key={angle} d={arc(47, angle, angle + 30)} fill="none" stroke={p.glow} strokeOpacity="0.85" strokeWidth="1.4" strokeLinecap="round" />
          ))}
        </g>
        {[135, 315].map((angle) => (
          <path key={angle} transform={at(angle, 47)} d="M0 -9 C3.5 -3 3.5 3 0 9 C1.2 3 1.2 -3 0 -9 Z" fill={p.accent} stroke={p.glow} strokeWidth="0.8" />
        ))}
        <circle r="40.5" fill="none" stroke={p.glow} strokeOpacity="0.5" strokeWidth="1" />
      </>
    ),
    frame: (p) => `repeating-conic-gradient(#ffffff 0 30deg, ${p.glow} 30deg 36deg, ${p.ink} 36deg 40deg)`,
    background: () => ({ background: 'linear-gradient(180deg, #3a8fd0, #a6e1ff)' }),
    backgroundArt: () => (
      <Sky>
        {[[60, 70, 18], [84, 74, 14], [230, 64, 20], [258, 70, 14], [160, 86, 12]].map(([x, y, r], index) => (
          <circle key={index} cx={x} cy={y} r={r} fill="#ffffff" fillOpacity="0.9" />
        ))}
        {[18, 34, 50].map((y, index) => (
          <path key={y} d={`M${20 + index * 30} ${y} C${90 + index * 20} ${y - 12} ${150 + index * 20} ${y + 10} ${220 + index * 20} ${y - 4}`} fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.4" strokeLinecap="round" />
        ))}
      </Sky>
    ),
    name: (p) => `linear-gradient(90deg, #6fd6ff, ${p.ink})`,
    adornment: (p) => (
      <>
        <path className="cn-anim-spin" style={{ animationDuration: '4s' }} d="M0 0 m-1 0 a1 1 0 0 1 2 0 a2.5 2.5 0 0 1 -5 0 a4 4 0 0 1 8 0 a5.5 5.5 0 0 1 -11 0" fill="none" stroke={p.accent} strokeWidth="1.3" strokeLinecap="round" />
        <path d="M4 -7 L9.5 -7 M6 7 L9.5 7" stroke={p.glow} strokeWidth="1.2" strokeLinecap="round" />
      </>
    ),
  },

  'explosao-urbana': {
    decoration: (p) => (
      <>
        <circle r="41" fill="none" stroke={p.glow} strokeWidth="3" strokeDasharray="14 4 3 4" />
        {[[35, 46, 1], [160, 47, 0.8], [260, 46, 1.1]].map(([angle, r, scale], index) => (
          <g key={index} transform={`${at(angle!, r!)} scale(${scale})`}>
            <path className="cn-anim-pulse" style={twinkle(index)} d={burst(8, 3.5, 8)} fill={p.accent} stroke={p.glow} strokeWidth="1" />
          </g>
        ))}
        {[[80, 46, 2.2], [110, 48, 1.4], [200, 47, 1.8], [300, 45, 2.5], [320, 49, 1.2]].map(([angle, r, size], index) => {
          const [x, y] = polar(angle!, r!);
          return <circle key={index} cx={x} cy={y} r={size} fill={p.glow} />;
        })}
      </>
    ),
    frame: (p) => `repeating-conic-gradient(${p.glow} 0 25deg, ${p.accent} 25deg 31deg, ${p.ink} 31deg 35deg)`,
    background: (p) => ({
      background: `repeating-linear-gradient(0deg, transparent 0 15px, #00000055 15px 16px), repeating-linear-gradient(90deg, transparent 0 31px, #00000044 31px 32px), linear-gradient(135deg, #5a2410, ${p.base})`,
    }),
    backgroundArt: (p) => (
      <Sky>
        <path transform="translate(230 48)" d={burst(12, 22, 40)} fill={p.accent} stroke={p.ink} strokeWidth="2" />
        <text x="230" y="56" textAnchor="middle" fontSize="22" fontWeight="900" fontStyle="italic" fill={p.glow} stroke={p.ink} strokeWidth="1.2" fontFamily="system-ui, sans-serif">
          BUM!
        </text>
        {[[40, 30, 6], [62, 44, 3], [100, 70, 5], [130, 24, 2.5]].map(([x, y, r], index) => (
          <circle key={index} cx={x} cy={y} r={r} fill={index % 2 ? p.accent : p.glow} fillOpacity="0.8" />
        ))}
      </Sky>
    ),
    name: (p) => `linear-gradient(90deg, ${p.glow}, ${p.accent})`,
    adornment: (p) => (
      <>
        <path className="cn-anim-pulse" d={burst(8, 4, 9.5)} fill={p.accent} stroke={p.glow} strokeWidth="0.9" />
        <circle r="2" fill="#fff" fillOpacity="0.85" />
      </>
    ),
  },

  'mira-tatica': {
    decoration: (p) => (
      <>
        <g className="cn-anim-spin" style={{ animationDuration: '20s' }}>
          <circle r="42" fill="none" stroke={p.accent} strokeOpacity="0.6" strokeWidth="1" />
          {Array.from({ length: 24 }, (_, index) => (
            <line key={index} transform={`rotate(${index * 15})`} x1="0" y1="-44" x2="0" y2={index % 6 === 0 ? -49 : -46} stroke={index % 6 === 0 ? p.glow : p.accent} strokeWidth={index % 6 === 0 ? 2 : 0.8} />
          ))}
        </g>
        {[45, 135, 225, 315].map((angle) => (
          <path key={angle} transform={at(angle, 46)} d="M-6 2.5 L-6 -2 L6 -2 L6 2.5" fill="none" stroke={p.glow} strokeWidth="2" />
        ))}
        {[0, 90, 180, 270].map((angle) => (
          <path key={angle} transform={at(angle, 39.5)} d="M0 -2.5 L2 0 L0 2.5 L-2 0 Z" fill={p.glow} />
        ))}
      </>
    ),
    frame: (p) => `repeating-conic-gradient(${p.accent} 0 80deg, ${p.glow} 80deg 90deg)`,
    background: (p) => ({
      background: `repeating-linear-gradient(0deg, ${p.glow}14 0 1px, transparent 1px 16px), repeating-linear-gradient(90deg, ${p.glow}14 0 1px, transparent 1px 16px), radial-gradient(40% 80% at 50% 50%, ${p.ink}, ${p.base})`,
    }),
    backgroundArt: (p) => (
      <Sky>
        {[40, 28, 16].map((r) => (
          <circle key={r} cx="160" cy="48" r={r} fill="none" stroke={p.glow} strokeOpacity="0.4" strokeWidth="1" />
        ))}
        <path d="M160 48 L160 8 A40 40 0 0 1 194 28 Z" fill={p.glow} fillOpacity="0.2" />
        <path d="M110 48 L210 48 M160 0 L160 96" stroke={p.accent} strokeOpacity="0.35" strokeWidth="0.8" />
        <circle cx="176" cy="34" r="2" fill={p.glow} />
      </Sky>
    ),
    name: () => 'linear-gradient(90deg, #f2c230, #9aa6b2)',
    adornment: (p) => (
      <>
        <path d="M-4 -8.5 L4 -8.5" stroke={p.accent} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M-7 -4 L0 1 L7 -4 M-7 2.5 L0 7.5 L7 2.5" fill="none" stroke={p.glow} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      </>
    ),
  },

  'impacto-rubro': {
    decoration: (p, g) => (
      <>
        <circle className="cn-anim-pulse" r="44" fill="none" stroke={p.glow} strokeWidth="2" />
        <circle r="41" fill="none" stroke={p.ink} strokeWidth="5" />
        <circle r="41" fill="none" stroke={`url(#${g})`} strokeWidth="1.8" />
        {[50, 130, 230, 310].map((angle, index) => (
          <path key={angle} className="cn-anim-twinkle" style={twinkle(index)} transform={at(angle, 47)} d="M-5 2 L0 -3 L5 2 M-5 6 L0 1 L5 6" fill="none" stroke={p.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        <path d="M-60 -6 L-47 -6 M-64 2 L-48 2 M-60 10 L-47 10" stroke={p.glow} strokeOpacity="0.7" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
    frame: (p) => `repeating-conic-gradient(${p.glow} 0 20deg, ${p.ink} 20deg 26deg, ${p.accent} 26deg 30deg)`,
    background: (p) => ({ background: `linear-gradient(180deg, #2a0812, ${p.base})` }),
    backgroundArt: (p) => (
      <Sky>
        {[[10, 40, 22], [36, 28, 18], [58, 50, 26], [90, 34, 20], [116, 46, 24], [200, 30, 22], [226, 44, 18], [250, 26, 24], [280, 40, 20], [302, 32, 18]].map(([x, top, w], index) => (
          <rect key={index} x={x} y={top} width={w} height={96 - top!} fill={p.ink} fillOpacity="0.9" />
        ))}
        {[22, 44, 66].map((y, index) => (
          <path key={y} d={`M${index * 20} ${y} L${200 + index * 30} ${y}`} stroke={index === 1 ? p.accent : p.glow} strokeOpacity="0.6" strokeWidth={index === 1 ? 1 : 2} strokeLinecap="round" />
        ))}
      </Sky>
    ),
    name: (p) => `linear-gradient(90deg, ${p.glow}, ${p.accent})`,
    adornment: (p) => (
      <>
        {[-6, 0, 6].map((x, index) => (
          <path key={x} className="cn-anim-twinkle" style={{ animationDelay: `${index * 0.25}s` }} d={`M${x - 3} -6 L${x + 2} 0 L${x - 3} 6`} fill="none" stroke={index === 2 ? p.accent : p.glow} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </>
    ),
  },
};
