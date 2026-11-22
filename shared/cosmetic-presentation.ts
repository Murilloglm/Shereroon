export interface AvatarArtwork {
  width: number;
  aspect: number;
  center?: [x: number, y: number];
  mask?: string;
}

export interface CosmeticPresentation {
  avatar?: AvatarArtwork;
  /** Position of baked-in sample text within the member artwork, in percentages. */
  sampleText?: [left: number, top: number, right: number, bottom: number];
  frameMask?: string;
  effectMask?: string;
  /** Alpha mask for sheets with a baked backdrop. */
  backdropMask?: string;
  nameColors?: [start: string, end: string];
}

const gridAvatar: AvatarArtwork = { width: 113 / 76, aspect: 113 / 85, center: [50, 52] };
const wideGridAvatar: AvatarArtwork = { width: 114 / 76, aspect: 114 / 87, center: [49, 48] };

// Coordinates describe the supplied assets. Adding a collection does not change the renderer.
const presentation: Record<string, CosmeticPresentation> = {
  hinata: {
    avatar: { width: 358 / 266, aspect: 358 / 287, center: [49.2, 50.2] },
    frameMask: 'assets/cosmetic-masks/hinata-frame.png',
    effectMask: 'assets/cosmetic-masks/hinata-effect.png',
  },
  'night-fury': { avatar: gridAvatar },
  'light-fury': { avatar: gridAvatar },
  rimuru: { avatar: gridAvatar },
  clove: { avatar: gridAvatar },
  neon: { avatar: gridAvatar, nameColors: ['#54eaff', '#54eaff'] },
  omen: { avatar: wideGridAvatar },
  jett: { avatar: wideGridAvatar },
  raze: { avatar: wideGridAvatar },
  tejo: { avatar: wideGridAvatar },
  rush: { avatar: wideGridAvatar },
  'madu-kaiden': {
    avatar: { width: 420 / 320, aspect: 420 / 366, center: [51.2, 47.3], mask: 'assets/kayden-avatar-mask.svg' },
    sampleText: [15, 35, 94, 61],
  },
  barou: {
    avatar: { width: 386 / 278, aspect: 386 / 344, center: [51.7, 51.5], mask: 'assets/barou-avatar-mask.svg' },
    sampleText: [28, 38, 72, 62],
  },
  garou: {
    avatar: { width: 415 / 310, aspect: 415 / 356, center: [49, 50], mask: 'assets/garou-avatar-mask.svg' },
    sampleText: [22, 32, 80, 59],
  },
};

export function cosmeticPresentation(collectionId: string): CosmeticPresentation | undefined {
  const settings = presentation[collectionId];
  return settings && { ...settings, backdropMask: `assets/cosmetic-masks/${collectionId}-avatar.png` };
}
