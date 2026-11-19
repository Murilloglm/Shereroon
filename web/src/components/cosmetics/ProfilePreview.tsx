import type { UserCosmetics } from '../../lib/cosmetics.ts';
import { Adornment, BackgroundArt, backgroundStyle, DecoratedAvatar, nameStyle, ProfileFrame } from './Decoration.tsx';

/**
 * Prévia de como o perfil fica com um conjunto de cosméticos (`look`), antes de comprar ou equipar: fundo, moldura
 * (no avatar e na borda do cartão), decoração, cor do nome e enfeite. Mostra o enfeite mesmo para quem escolheu
 * escondê-los, porque é a prévia do próprio item.
 */
export function ProfilePreview({ userId, name, avatar, look, animate = true, testId = 'profile-preview' }: { userId: string; name: string; avatar?: string | null; look: UserCosmetics; animate?: boolean; testId?: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-ink-900" data-testid={testId}>
      <ProfileFrame equipped={look} />
      <div className="relative h-24 overflow-hidden" style={backgroundStyle(look) ?? { background: 'linear-gradient(120deg, #2a2150, #4b348e 60%, #3a5fa8)' }}>
        <BackgroundArt equipped={look} />
      </div>
      <div className="-mt-10 flex items-end gap-5 px-9 pb-4">
        <div className="shrink-0 rounded-full border-4 border-ink-900 bg-ink-900">
          <DecoratedAvatar userId={userId} name={name} size={76} image={avatar} animate={animate} preview={look} />
        </div>
        <p className="mb-1 flex min-w-0 items-center text-base font-extrabold">
          <span className="truncate" style={nameStyle(look)}>
            {name}
          </span>
          {look.enfeite && <Adornment equipped={look.enfeite} animate={animate} force />}
        </p>
      </div>
    </div>
  );
}
