import { Store } from './store.ts';
import { avatars } from './avatars.ts';

export type AvatarValue = string | null;
export class AvatarCache {
  readonly store: Store<{ byUser: Record<string, AvatarValue> }>;
  constructor(store = new Store<{ byUser: Record<string, AvatarValue> }>({ byUser: {} })) { this.store = store; }
  seed(users: { id?: string; userId?: string; avatar?: string | null }[]): void {
    const byUser = { ...this.store.get().byUser }; let changed = false;
    for (const user of users) {
      const id = user.id ?? user.userId;
      if (id && user.avatar !== undefined && !(id in byUser)) { byUser[id] = user.avatar; changed = true; }
    }
    if (changed) this.store.set({ byUser });
  }
  update(userId: string, avatar: AvatarValue): void {
    if (this.store.get().byUser[userId] === avatar) return;
    this.store.set(({ byUser }) => ({ byUser: { ...byUser, [userId]: avatar } }));
  }
  resolve(userId: string, fallback?: string | null): AvatarValue | undefined {
    const byUser = this.store.get().byUser;
    return userId in byUser ? byUser[userId] : fallback;
  }
  clear(): void { this.store.set({ byUser: {} }); }
}
/** Shared by every avatar surface; live profile events override older member/message snapshots. */
export const avatarCache = new AvatarCache(avatars);
