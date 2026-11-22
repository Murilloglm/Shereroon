/** Presentation only. Each theme decorates the equipped artwork with a few independent accents. */
export type Motif = 'crown' | 'spark' | 'lily' | 'petal' | 'crystal' | 'sand' | 'spiral' | 'galaxy' | 'star' | 'bolt' | 'paw' | 'wing' | 'pearl' | 'bubble' | 'drop' | 'rune' | 'butterfly' | 'mist' | 'trail' | 'feather' | 'burst' | 'marker' | 'arrow';
type Track = 'current' | 'waves' | 'vortex' | 'lightning' | 'radar' | 'speed';
export interface CharacterEffect {
  colors: [string, string];
  track: Track;
  motifs: readonly Motif[];
  period: number;
  intensity: number;
  maxParticles: number;
  voiceGain: number;
  hoverGain: number;
  staticMode: 'artwork';
}
type Theme = Pick<CharacterEffect, 'colors' | 'track' | 'motifs' | 'period'> & Partial<CharacterEffect>;
const themes: Record<string, Theme> = {
  barou: { colors: ['#fe3559', '#ff9a78'], track: 'current', motifs: ['crown','spark','spark'], period: 3.8, voiceGain: 1.7 },
  hinata: { colors: ['#ffb6d8','#c7afff'], track: 'waves', motifs: ['lily','petal','crystal','petal'], period: 6.5, intensity: .65 },
  gaara: { colors: ['#e7b16d','#e04c4c'], track: 'vortex', motifs: ['spiral','sand','sand'], period: 5.4 },
  garou: { colors: ['#a480ff','#72caff'], track: 'vortex', motifs: ['galaxy','star','galaxy'], period: 5.8, voiceGain: 1.6 },
  'madu-kaiden': { colors: ['#70cfff','#ffda77'], track: 'lightning', motifs: ['bolt','paw','bolt'], period: 3.6, voiceGain: 1.65 },
  'night-fury': { colors: ['#ba87ff','#e0d3ff'], track: 'current', motifs: ['wing','star','wing'], period: 6.3 },
  'light-fury': { colors: ['#d1edff','#ffd6f0'], track: 'waves', motifs: ['wing','pearl','wing'], period: 7 },
  rimuru: { colors: ['#62ddff','#b1f9ff'], track: 'waves', motifs: ['bubble','drop','rune'], period: 4.7 },
  clove: { colors: ['#d18bff','#f788dd'], track: 'vortex', motifs: ['butterfly','mist','spark'], period: 6 },
  neon: { colors: ['#54dcff','#ffe875'], track: 'lightning', motifs: ['bolt','trail','spark'], period: 3.2 },
  omen: { colors: ['#9382eb','#819dff'], track: 'vortex', motifs: ['mist','spiral','mist'], period: 7, intensity: .7 },
  jett: { colors: ['#a6e5ff','#dbfbff'], track: 'current', motifs: ['feather','trail','feather'], period: 4.6 },
  raze: { colors: ['#ff944e','#ffe25d'], track: 'speed', motifs: ['burst','spark','burst'], period: 4.1 },
  tejo: { colors: ['#ffda79','#faf2af'], track: 'radar', motifs: ['marker','spark','marker'], period: 5.2 },
  rush: { colors: ['#ff77b7','#ffabab'], track: 'speed', motifs: ['arrow','trail','arrow'], period: 3.3 },
};
const presets = new Map(Object.entries(themes).map(([id, theme]) => [id, {
  intensity: .82, maxParticles: 5, voiceGain: 1.3, hoverGain: 1.15, staticMode: 'artwork' as const, ...theme,
}]));
export const characterEffect = (id?: string) => id ? presets.get(id) : undefined;
