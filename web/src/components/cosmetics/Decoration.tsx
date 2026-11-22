import { useEffect, useId } from 'react';
import { cosmeticAsset, itemById, packById, type CosmeticItem, type Equipped, type PackPalette } from '../../../../shared/cosmetics.ts';
import { appearance, reducedMotion } from '../../lib/appearance.ts';
import { cosmetics, type UserCosmetics } from '../../lib/cosmetics.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar, cx } from '../ui.tsx';
import { PACK_ART, type PackArt } from './packs.tsx';

/** Desenho e paleta do pacote do item (null para itens avulsos). */
function packOf(item: CosmeticItem | undefined): { art: PackArt; palette: PackPalette } | null {
  const pack = item?.pack ? packById(item.pack) : undefined;
  const art = pack ? PACK_ART[pack.id] : undefined;
  return pack && art ? { art, palette: pack.palette } : null;
}

/** Tamanho da arte em relação ao avatar: a decoração ocupa o anel em volta dele. */
const SCALE = 1.36;

/** Caminhos relativos preservam instalações em subpastas e o protocolo local do Electron. */
export const cosmeticAssetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** Desenhos originais do Cosmic Night, num quadro de -50 a 50 com o avatar no centro (raio ~37). */
function drawing(id: string, a: string, b: string, gradient: string) {
  const fill = `url(#${gradient})`;
  switch (id) {
    case 'anel-aurora':
      return (
        <g className="cn-anim-spin" style={{ animationDuration: '6s' }}>
          <circle r="42" fill="none" stroke={fill} strokeWidth="3.2" strokeDasharray="70 18 34 22" strokeLinecap="round" />
          <circle r="46" fill="none" stroke={b} strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="4 9" />
        </g>
      );
    case 'orbita-estelar':
      return (
        <g className="cn-anim-spin" style={{ animationDuration: '14s' }}>
          {[0, 72, 144, 216, 288].map((angle, index) => (
            <path
              key={angle}
              className="cn-anim-twinkle"
              style={{ animationDelay: `${index * 0.35}s` }}
              transform={`rotate(${angle}) translate(0 -44) scale(${index % 2 ? 0.7 : 1})`}
              d="M0 -5 L1.4 -1.4 L5 0 L1.4 1.4 L0 5 L-1.4 1.4 L-5 0 L-1.4 -1.4 Z"
              fill={index % 2 ? b : a}
            />
          ))}
        </g>
      );
    case 'luas-gemeas':
      return (
        <g className="cn-anim-spin" style={{ animationDuration: '10s' }}>
          {[0, 180].map((angle) => (
            <g key={angle} transform={`rotate(${angle}) translate(0 -44)`}>
              <circle r="6" fill={fill} />
              <circle r="5.2" cx="2.6" cy="-1.6" fill="var(--color-ink-950)" />
            </g>
          ))}
        </g>
      );
    case 'poeira-cosmica':
      return (
        <g>
          {Array.from({ length: 12 }, (_, index) => {
            const angle = (index / 12) * Math.PI * 2;
            const radius = 41 + (index % 3) * 3;
            return (
              <circle
                key={index}
                className="cn-anim-float"
                style={{ animationDelay: `${(index * 0.27) % 3}s` }}
                cx={Math.cos(angle) * radius}
                cy={Math.sin(angle) * radius}
                r={index % 4 === 0 ? 1.8 : 1.1}
                fill={index % 2 ? a : b}
              />
            );
          })}
        </g>
      );
    case 'planeta-aneis':
      // Posição no grupo de fora; a animação (CSS transform) no de dentro, para uma não apagar a outra.
      return (
        <g transform="translate(30 -30)">
          <g className="cn-anim-bob">
            <circle r="9" fill={fill} />
            <ellipse rx="15" ry="4.2" fill="none" stroke={a} strokeWidth="1.6" transform="rotate(-18)" />
            <circle r="2" cx="-3" cy="-3" fill="#fff" fillOpacity="0.5" />
          </g>
        </g>
      );
    case 'asas-nebulosa':
      return (
        <g className="cn-wings">
          {[-1, 1].map((side) => (
            <path
              key={side}
              transform={`scale(${side} 1)`}
              d="M36 -6 C48 -26 62 -30 66 -18 C58 -18 54 -10 50 -6 C58 -6 62 2 58 8 C52 4 46 4 40 8 Z"
              fill={fill}
              fillOpacity="0.85"
            />
          ))}
        </g>
      );
    case 'tempestade':
      return (
        <g>
          {[30, 120, 210, 300].map((angle, index) => (
            <polyline
              key={angle}
              className="cn-anim-flash"
              style={{ animationDelay: `${index * 0.45}s` }}
              transform={`rotate(${angle}) translate(0 -40)`}
              points="0,-8 -3,-1 1,-1 -2,7"
              fill="none"
              stroke={index % 2 ? a : b}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          <circle r="42" fill="none" stroke={a} strokeOpacity="0.25" strokeWidth="1" />
        </g>
      );
    case 'chama-solar':
      return (
        <g>
          {Array.from({ length: 14 }, (_, index) => (
            <g key={index} transform={`rotate(${index * (360 / 14)}) translate(0 -38)`}>
              <path className="cn-anim-flicker" style={{ animationDelay: `${(index * 0.13) % 1}s`, transformOrigin: '50% 100%' }} d="M0 0 C-4 -4 -3 -9 0 -13 C3 -9 4 -4 0 0 Z" fill={index % 2 ? a : b} />
            </g>
          ))}
        </g>
      );
    case 'cristal-gelo':
      return (
        <g>
          {[0, 60, 120, 180, 240, 300].map((angle, index) => (
            <path
              key={angle}
              className="cn-anim-twinkle"
              style={{ animationDelay: `${index * 0.4}s` }}
              transform={`rotate(${angle}) translate(0 -43)`}
              d="M0 -7 L3 0 L0 7 L-3 0 Z"
              fill={fill}
              stroke="#fff"
              strokeOpacity="0.6"
              strokeWidth="0.6"
            />
          ))}
        </g>
      );
    case 'guardiao-cosmico':
      return (
        <g className="cn-anim-spin" style={{ animationDuration: '9s' }}>
          <path d="M0 -44 A44 44 0 0 1 38 22" fill="none" stroke={fill} strokeWidth="4.5" strokeLinecap="round" />
          <path d="M38 22 A44 44 0 0 1 30 32" fill="none" stroke={b} strokeWidth="3" strokeLinecap="round" />
          <g transform="translate(0 -44) rotate(-90)">
            <path d="M0 -6 L10 0 L0 6 L3 0 Z" fill={a} />
            <circle cx="5" cy="-1.5" r="1" fill="#fff" />
          </g>
          {[0.2, 0.4, 0.6].map((t) => {
            const angle = -Math.PI / 2 + t * 2.1;
            return <circle key={t} cx={Math.cos(angle) * 44} cy={Math.sin(angle) * 44} r="1.4" fill="#fff" fillOpacity="0.8" />;
          })}
        </g>
      );
    default:
      return null;
  }
}

/** A decoração em volta de um avatar de `size` pixels. Anima só se `animate` (e se as animações não estiverem reduzidas). */
export function Decoration({ equipped, size, speaking = false, animate = false, entrance = false }: { equipped: Equipped; size: number; speaking?: boolean; animate?: boolean; entrance?: boolean }) {
  const gradient = `cn-deco-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const item = itemById(equipped.item);
  if (!item || item.kind !== 'decoracao') return null;
  const variant = item.variants.find((option) => option.id === equipped.variant) ?? item.variants[0]!;
  const [a, b] = variant.colors;
  const pack = packOf(item);
  const box = size * SCALE;
  const live = animate && !reducedMotion();
  if (item.asset) {
    const extent = size * (item.avatarScale ?? SCALE);
    return <img src={cosmeticAssetUrl(item.asset)} alt="" aria-hidden="true" decoding="async"
      className="pointer-events-none absolute max-w-none object-contain"
      style={{ width: extent, height: extent, left: (size - extent) / 2, top: (size - extent) / 2 }}
      data-decoration={item.id} data-variant={variant.id} />;
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="-50 -50 100 100"
      className={cx('cn-deco pointer-events-none absolute overflow-visible', live && 'cn-deco-live', speaking && item.reactsToVoice && 'cn-deco-speaking', entrance && live && 'cn-deco-entrance')}
      style={{ width: box, height: box, left: (size - box) / 2, top: (size - box) / 2 }}
      data-decoration={item.id}
      data-variant={variant.id}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      {pack ? pack.art.decoration(pack.palette, gradient) : drawing(item.id, a, b, gradient)}
      {entrance && live && <circle className="cn-anim-burst" r="40" fill="none" stroke={a} strokeWidth="2" />}
    </svg>
  );
}

/** Contorno da moldura equipada. */
function Frame({ equipped, size }: { equipped: Equipped; size: number }) {
  const item = itemById(equipped.item);
  if (!item || item.kind !== 'moldura') return null;
  if (item.asset) return null;
  const [a, b] = (item.variants.find((option) => option.id === equipped.variant) ?? item.variants[0]!).colors;
  const pack = packOf(item);
  const ring = Math.max(2, Math.round(size / (pack ? 14 : 18)));
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute rounded-full"
      style={{ inset: -ring, padding: ring, background: pack ? pack.art.frame(pack.palette) : `linear-gradient(135deg, ${a}, ${b})`, ...RING_MASK }}
      data-frame={item.id}
    />
  );
}

/** Recorta o fundo em anel (só a borda aparece). */
const RING_MASK: React.CSSProperties = { WebkitMask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)', mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)' };

/** Moldura de um pacote na borda do cartão de perfil (a mesma do avatar, em volta do cartão). */
export function ProfileFrame({ equipped }: { equipped: UserCosmetics }) {
  const item = equipped.moldura ? itemById(equipped.moldura.item) : undefined;
  const pack = packOf(item);
  if (!pack) return null;
  return <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 rounded-[inherit]" style={{ padding: 2, background: pack.art.frame(pack.palette), ...RING_MASK }} data-profile-frame={item!.id} />;
}

/**
 * Enfeite no nome do servidor: um ícone pequeno ao lado do nick, do tamanho da letra. Parado por padrão (listas,
 * chat); anima só com `animate` (chamada, perfil, prévias), se a pessoa não escolheu "parados" e sem animações
 * reduzidas. Some com "ocultos", em Configurações → Acessibilidade.
 */
export function Adornment({ equipped, animate = false, force = false }: { equipped: Equipped; animate?: boolean; force?: boolean }) {
  const choice = useStore(appearance, (state) => state.adornments);
  const item = itemById(equipped.item);
  const pack = packOf(item);
  if (!item || item.kind !== 'enfeite' || !pack || (choice === 'ocultos' && !force)) return null;
  const live = animate && choice === 'animados' && !reducedMotion();
  return (
    <svg viewBox="-10 -10 20 20" className={cx('cn-adorn', live && 'cn-adorn-live')} role="img" aria-label={item.name} data-adornment={item.id} data-live={live}>
      {pack.art.adornment(pack.palette)}
    </svg>
  );
}

/** O enfeite que a pessoa equipou (busca em lote como o resto). */
export function NameAdornment({ userId, animate = false }: { userId: string | null | undefined; animate?: boolean }) {
  const equipped = useUserCosmetics(userId);
  return equipped.enfeite ? <Adornment equipped={equipped.enfeite} animate={animate} /> : null;
}

/** O que a pessoa tem equipado (busca em lote na primeira vez que aparece). */
export function useUserCosmetics(userId: string | null | undefined): UserCosmetics {
  const value = useStore(cosmetics.store, (state) => (userId ? state.byUser[userId] : undefined));
  useEffect(() => {
    if (userId) cosmetics.request(userId);
  }, [userId]);
  return value ?? EMPTY;
}
const EMPTY: UserCosmetics = {};

/** Estilo do nome com a cor equipada (gradiente). */
export function nameStyle(equipped: UserCosmetics): React.CSSProperties | undefined {
  const choice = equipped['cor-nome'];
  const item = choice ? itemById(choice.item) : undefined;
  if (!item) return undefined;
  const [a, b] = (item.variants.find((option) => option.id === choice!.variant) ?? item.variants[0]!).colors;
  const pack = packOf(item);
  return { backgroundImage: pack ? pack.art.name(pack.palette) : `linear-gradient(90deg, ${a}, ${b})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', textShadow: 'none' };
}

/**
 * Nome com a cor equipada pela pessoa (gradiente), por cima da cor do cargo, seguido do enfeite no nome (se houver).
 * O enfeite fica fora do texto em gradiente, como irmão, para o recorte do nome (truncate) continuar funcionando.
 */
export function CosmeticName({ userId, children, className, adornment = true, animate = false }: { userId: string | null | undefined; children: React.ReactNode; className?: string; adornment?: boolean; animate?: boolean }) {
  const equipped = useUserCosmetics(userId);
  const name = (
    <span className={className} style={nameStyle(equipped)} data-name-style={equipped['cor-nome']?.item ?? ''}>
      {children}
    </span>
  );
  if (!adornment || !equipped.enfeite) return name;
  return (
    <>
      {name}
      <Adornment equipped={equipped.enfeite} animate={animate} />
    </>
  );
}

/** Fundo de perfil equipado (para o topo do cartão de perfil). */
export function backgroundStyle(equipped: UserCosmetics): React.CSSProperties | undefined {
  const choice = equipped.fundo;
  const item = choice ? itemById(choice.item) : undefined;
  if (!item) return undefined;
  const asset = cosmeticAsset(item, choice?.variant);
  if (asset) return { backgroundImage: `url("${cosmeticAssetUrl(asset)}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
  const [a, b] = (item.variants.find((option) => option.id === choice!.variant) ?? item.variants[0]!).colors;
  const pack = packOf(item);
  if (pack) return pack.art.background(pack.palette);
  return item.id === 'fundo-aurora'
    ? { background: `linear-gradient(160deg, ${a}66, transparent 45%), linear-gradient(20deg, ${b}88, transparent 55%), var(--color-ink-900)` }
    : { background: `radial-gradient(70% 90% at 25% 30%, ${a}aa, transparent 70%), radial-gradient(60% 80% at 80% 70%, ${b}aa, transparent 70%), var(--color-ink-950)` };
}

/** Desenho por cima do fundo de perfil de um pacote (lua, raios, nuvens...). Parado: é só um SVG. */
export function BackgroundArt({ equipped }: { equipped: UserCosmetics }) {
  const item = equipped.fundo ? itemById(equipped.fundo.item) : undefined;
  const pack = packOf(item);
  if (!pack) return null;
  return (
    <svg aria-hidden="true" viewBox="0 0 320 96" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full" data-background-art={item!.id}>
      {pack.art.backgroundArt(pack.palette)}
    </svg>
  );
}

/**
 * Avatar com o que a pessoa equipou (moldura e decoração). `animate` só em lugares grandes (cartões da chamada,
 * perfil, prévias); nas listas a decoração fica parada, para não pesar.
 */
export function DecoratedAvatar({
  userId,
  name,
  size = 40,
  online,
  speaking,
  image,
  animate = false,
  entrance = false,
  preview,
}: {
  userId: string;
  name: string;
  size?: number;
  online?: boolean;
  speaking?: boolean;
  image?: string | null;
  animate?: boolean;
  entrance?: boolean;
  /** Mostrar estes itens no lugar dos equipados (prévia na loja). */
  preview?: UserCosmetics;
}) {
  const equipped = useUserCosmetics(preview ? null : userId);
  const shown = preview ?? equipped;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} data-decorated={shown.decoracao?.item ?? ''}>
      {shown.moldura && <Frame equipped={shown.moldura} size={size} />}
      <Avatar id={userId} name={name} size={size} online={online} speaking={speaking} image={image} />
      {shown.decoracao && <Decoration equipped={shown.decoracao} size={size} speaking={speaking} animate={animate} entrance={entrance} />}
    </span>
  );
}

export function ProfileNameplate({ userId, preview, children }: { userId?: string; preview?: UserCosmetics; children: React.ReactNode }) {
  const equipped = useUserCosmetics(preview ? null : userId);
  const choice = (preview ?? equipped).moldura;
  const item = choice ? itemById(choice.item) : undefined;
  if (!item?.asset) return <>{children}</>;
  return <div className="cn-profile-nameplate" data-profile-frame={item.id}>
    <img src={cosmeticAssetUrl(item.nameplateAsset ?? item.asset)} alt="" aria-hidden="true" decoding="async" />
    <div className="relative min-w-0 px-6 py-3">{children}</div>
  </div>;
}

/** O painel completo mantém a proporção desenhada na folha, inclusive seus cantos. */
export function ArtworkProfileFrame({ userId, preview, children }: { userId?: string; preview?: UserCosmetics; children: React.ReactNode }) {
  const equipped = useUserCosmetics(preview ? null : userId);
  const choice = (preview ?? equipped).moldura;
  const item = choice ? itemById(choice.item) : undefined;
  if (!item?.asset || !item.frameAspect) return <>{children}</>;
  return <div className="cn-profile-frame" style={{ aspectRatio: item.frameAspect }} data-profile-frame={item.id}>
    <img src={cosmeticAssetUrl(item.asset)} alt="" aria-hidden="true" decoding="async" />
    <div className="cn-profile-frame-content">{children}</div>
  </div>;
}

/** Uma única imagem por membro; a camada não participa do layout nem recebe cliques. */
export function MemberNameEffect({ userId, preview, animate = true }: { userId?: string; preview?: UserCosmetics; animate?: boolean }) {
  const equipped = useUserCosmetics(preview ? null : userId);
  const choice = (preview ?? equipped)['efeito-nome'];
  const item = choice ? itemById(choice.item) : undefined;
  if (!item?.asset || item.kind !== 'efeito-nome') return null;
  return <span className={cx('cn-member-effect', animate && 'cn-member-effect-live')} aria-hidden="true" data-name-effect={item.id}>
    <img src={cosmeticAssetUrl(item.asset)} alt="" decoding="async" loading="lazy" />
    <span className="cn-member-effect-veil" />
  </span>;
}
