import { API_BASE } from './api.ts';
import { Store } from './store.ts';

/** Uma fonte para fotos, independente de privacidade do cartão de perfil e dos cosméticos. */
export const avatars = new Store<{ byUser: Record<string, string | null> }>({ byUser: {} });
export function rememberAvatar(id: string, image: string | null | undefined): void {
  rememberAvatars([{ id, image }]);
}
export function rememberAvatars(entries: Iterable<{ id: string; image: string | null | undefined }>, before?: Record<string, string | null>): void {
  const current = avatars.get().byUser;
  let next: typeof current | undefined;
  for (const { id, image } of entries) {
    if (before && current[id] !== before[id]) continue;
    if (image === undefined || (next ?? current)[id] === image) continue;
    next ??= { ...current };
    next[id] = image;
  }
  if (next) avatars.set({ byUser: next });
}
export function mediaUrl(value: string | null | undefined): string | null {
  if (!value?.startsWith('arquivo:')) return null;
  const id = value.slice(8);
  return /^[A-Za-z0-9_-]{8,40}$/.test(id) ? `${API_BASE}/api/media/${id}` : null;
}
