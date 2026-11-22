import { cosmeticAsset, type CosmeticItem } from '../../../../shared/cosmetics.ts';
import type { UserCosmetics } from '../../lib/cosmetics.ts';
import type { Account } from '../../lib/groups/client.ts';
import { social } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { backgroundStyle, cosmeticAssetUrl, DecoratedAvatar, MemberNameEffect, nameStyle, ArtworkProfileFrame, ProfileNameplate } from './Decoration.tsx';

export function ArtworkVariants({ item, value, onChange }: { item: CosmeticItem; value: string; onChange: (variant: string) => void }) {
  if (item.variants.length < 2) return null;
  return <div className="cn-artwork-variants" role="radiogroup" aria-label={`Estilos de ${item.name}`}>
    {item.variants.map((variant) => <button key={variant.id} type="button" role="radio" aria-checked={value === variant.id}
      aria-label={variant.name} title={variant.name} onClick={() => onChange(variant.id)} data-testid={`variant-${item.id}-${variant.id}`}>
      <img src={cosmeticAssetUrl(cosmeticAsset(item, variant.id)!)} alt="" loading="lazy" decoding="async" />
      <span>{variant.name}</span>
    </button>)}
  </div>;
}

export function MemberNamePreview({ account, preview }: { account: Account; preview: UserCosmetics }) {
  const avatar = useStore(social.store, (state) => state.profiles[account.id]?.avatar ?? null);
  return <div className="cn-member-row mx-auto flex h-12 w-full max-w-72 items-center gap-3 rounded-lg px-3" data-testid="member-effect-preview">
    <MemberNameEffect preview={preview} />
    <span className="relative z-10"><DecoratedAvatar userId={account.id} name={account.displayName} size={28} image={avatar} preview={{}} online /></span>
    <span className="relative z-10 min-w-0 truncate text-sm font-extrabold" style={nameStyle(preview)}>{account.displayName}</span>
  </div>;
}

export function ItemPreview({ account, item, variant, size = 48 }: { account: Account; item: CosmeticItem; variant: string; size?: number }) {
  const avatar = useStore(social.store, (state) => state.profiles[account.id]?.avatar ?? null);
  const preview: UserCosmetics = { [item.kind]: { item: item.id, variant } };
  if (item.kind === 'efeito-nome') return <MemberNamePreview account={account} preview={preview} />;
  if (item.kind === 'fundo') {
    const asset = cosmeticAsset(item, variant);
    return asset ? <img className="cn-artwork-banner" src={cosmeticAssetUrl(asset)} alt={`Fundo ${item.variants.find((entry) => entry.id === variant)?.name ?? item.name}`} decoding="async" />
      : <div className="h-20 w-full rounded-xl" style={backgroundStyle(preview)} aria-hidden="true" />;
  }
  if (item.kind === 'moldura' && item.asset) return item.frameAspect
    ? <div className="mx-auto w-full max-w-64"><ArtworkProfileFrame preview={preview}><p className="truncate text-center font-extrabold">{account.displayName}</p></ArtworkProfileFrame></div>
    : <ProfileNameplate preview={preview}><p className="truncate text-center font-extrabold">{account.displayName}</p></ProfileNameplate>;
  if (item.kind === 'cor-nome' && item.asset) return <img className="cn-artwork-banner" src={cosmeticAssetUrl(item.asset)} alt={`Arte original de nome ${item.name}`} decoding="async" />;
  if (item.kind === 'enfeite' && item.asset) return <img className="mx-auto h-16 max-w-full object-contain" src={cosmeticAssetUrl(item.asset)} alt={item.name} />;
  if (item.kind === 'cor-nome') return <p className="flex h-20 items-center justify-center truncate text-lg font-extrabold" style={nameStyle(preview)}>{account.displayName}</p>;
  return <div className="flex h-24 items-center justify-center"><DecoratedAvatar userId={account.id} name={account.displayName} size={size} image={avatar} animate preview={preview} /></div>;
}
