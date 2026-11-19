import type { CosmeticItem } from '../../../../shared/cosmetics.ts';
import type { UserCosmetics } from '../../lib/cosmetics.ts';
import type { Account } from '../../lib/groups/client.ts';
import { social } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { backgroundStyle, DecoratedAvatar, MemberNameEffect, nameStyle, ProfileNameplate } from './Decoration.tsx';

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
  if (item.kind === 'fundo') return <div className="h-20 w-full rounded-xl" style={backgroundStyle(preview)} aria-hidden="true" />;
  if (item.kind === 'moldura' && item.asset) return <ProfileNameplate preview={preview}><p className="truncate text-center font-extrabold">{account.displayName}</p></ProfileNameplate>;
  if (item.kind === 'cor-nome') return <p className="flex h-20 items-center justify-center truncate text-lg font-extrabold" style={nameStyle(preview)}>{account.displayName}</p>;
  return <div className="flex h-24 items-center justify-center"><DecoratedAvatar userId={account.id} name={account.displayName} size={size} image={avatar} animate preview={preview} /></div>;
}
