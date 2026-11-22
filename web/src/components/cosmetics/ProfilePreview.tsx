import type { ReactNode } from 'react';
import { itemById } from '../../../../shared/cosmetics.ts';
import type { UserCosmetics } from '../../lib/cosmetics.ts';
import { mediaUrl } from '../../lib/social/client.ts';
import { Adornment, BackgroundArt, backgroundStyle, cosmeticAssetUrl, DecoratedAvatar, nameStyle, openingClip } from './Decoration.tsx';

interface ProfileIdentityProps {
  userId: string;
  name: string;
  avatar?: string | null;
  banner?: string | null;
  look: UserCosmetics;
  online?: boolean;
  roleColor?: string;
  badges?: ReactNode;
  animate?: boolean;
  forceAdornment?: boolean;
  draft?: { avatarUrl?: string | null; bannerUrl?: string | null };
}

/** Shared by the live card, the shop and the profile editor. */
export function ProfileIdentity({
  userId,
  name,
  avatar,
  banner,
  look,
  online,
  roleColor,
  badges,
  animate = true,
  forceAdornment,
  draft,
}: ProfileIdentityProps) {
  const frame = look.moldura ? itemById(look.moldura.item) : undefined;
  const tallFrame = Boolean(frame?.frameAspect);
  const equippedBanner = backgroundStyle(look);
  const bannerImage = draft?.bannerUrl ?? mediaUrl(banner);
  const customColor = banner?.startsWith('cor:') ? banner.slice(4) : undefined;

  return (
    <>
      <div className="cn-profile-banner" style={equippedBanner ?? (customColor ? { background: customColor } : undefined)} data-testid="profile-banner">
        {!equippedBanner && bannerImage && <img src={bannerImage} alt="" decoding="async" />}
        <BackgroundArt equipped={look} />
      </div>
      <div className="cn-profile-identity" data-testid="profile-identity">
        <div className="cn-profile-avatar" data-testid="profile-avatar">
          <DecoratedAvatar userId={userId} name={name} image={avatar} size={76} online={online} animate={animate}
            preview={look} previewPhoto={Boolean(draft)} previewPhotoUrl={draft?.avatarUrl} />
        </div>
        <div className="cn-profile-name-area" data-tall-frame={tallFrame || undefined}>
          {frame?.asset && (
            <img
              className={tallFrame ? 'cn-profile-trim cn-profile-trim-tall' : 'cn-profile-trim'}
              src={cosmeticAssetUrl(frame.asset)}
              alt=""
              aria-hidden="true"
              decoding="async"
              style={tallFrame ? { clipPath: openingClip([16, 20, 84, 79]) } : undefined}
              data-profile-frame={frame.id}
            />
          )}
          <p className="cn-profile-name" data-testid="profile-name">
            <span title={name} style={nameStyle(look) ?? { color: roleColor }}>{name}</span>
          </p>
        </div>
        {(badges || look.enfeite) && (
          <div className="cn-profile-badges">
            {look.enfeite && <Adornment equipped={look.enfeite} animate={animate} force={forceAdornment} />}
            {badges}
          </div>
        )}
      </div>
    </>
  );
}

export function ProfilePreview({ testId = 'profile-preview', children, ...identity }: ProfileIdentityProps & {
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="cn-profile-preview" data-testid={testId}>
      <ProfileIdentity {...identity} forceAdornment />
      {children}
    </div>
  );
}
