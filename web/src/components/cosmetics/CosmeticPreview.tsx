import { cosmeticAsset, type CosmeticItem } from '../../../../shared/cosmetics.ts';
import type { UserCosmetics } from '../../lib/cosmetics.ts';
import type { Account } from '../../lib/groups/client.ts';
import { social } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { Adornment, BackgroundArt, backgroundStyle, cosmeticAssetUrl, DecoratedAvatar, MemberNameEffect, nameStyle } from './Decoration.tsx';
import { ProfilePreview } from './ProfilePreview.tsx';

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
    <span className="relative z-10"><DecoratedAvatar userId={account.id} name={account.displayName} size={28} image={avatar} preview={preview} online /></span>
    <span className="relative z-10 min-w-0 truncate text-sm font-extrabold" style={nameStyle(preview)}>{account.displayName}</span>
  </div>;
}

export function ItemPreview({ account, item, variant, size = 48 }: { account: Account; item: CosmeticItem; variant: string; size?: number }) {
  const avatar = useStore(social.store, (state) => state.profiles[account.id]?.avatar ?? null);
  const preview: UserCosmetics = { [item.kind]: { item: item.id, variant } };
  if (item.kind === 'efeito-nome') return <MemberNamePreview account={account} preview={preview} />;
  if (item.kind === 'fundo') return (
    <div className="cn-profile-banner rounded-xl" style={backgroundStyle(preview)} aria-hidden="true">
      <BackgroundArt equipped={preview} />
    </div>
  );
  if (item.kind === 'moldura' && item.asset) return <ProfilePreview userId={account.id} name={account.displayName} avatar={avatar} look={preview} />;
  if (item.kind === 'enfeite') return (
    <p className="flex h-20 items-center justify-center gap-2 text-lg font-extrabold">
      {account.displayName} <Adornment equipped={{ item: item.id, variant }} force />
    </p>
  );
  if (item.kind === 'cor-nome') return <p className="flex h-20 items-center justify-center truncate text-lg font-extrabold" style={nameStyle(preview)}>{account.displayName}</p>;
  return <div className="flex h-24 items-center justify-center"><DecoratedAvatar userId={account.id} name={account.displayName} size={size} image={avatar} animate preview={preview} /></div>;
}
