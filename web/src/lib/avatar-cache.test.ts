import { describe, expect, it } from 'vitest';
import { AvatarCache } from './avatar-cache.ts';
describe('shared avatar references', () => {
  it('resolves missing props from shared data and prioritizes live changes over stale snapshots', () => {
    const cache = new AvatarCache();
    cache.seed([{ userId: 'a', avatar: 'arquivo:abcdefgh' }]);
    expect(cache.resolve('a')).toBe('arquivo:abcdefgh');
    cache.update('a', 'arquivo:newphoto');
    cache.seed([{ userId: 'a', avatar: 'arquivo:abcdefgh' }]);
    expect(cache.resolve('a', 'arquivo:abcdefgh')).toBe('arquivo:newphoto');
  });
  it('propagates explicit photo removal rather than resurrecting a cached/member image', () => {
    const cache = new AvatarCache();
    cache.update('a', null);
    expect(cache.resolve('a', 'arquivo:abcdefgh')).toBeNull();
    cache.clear(); expect(cache.resolve('a')).toBeUndefined();
  });
  it('does not notify subscribers for unchanged photos or unrelated seeds', () => {
    const cache = new AvatarCache(); let notifications = 0;
    cache.store.subscribe(() => notifications++);
    cache.update('a', 'padrao:1'); cache.update('a', 'padrao:1');
    cache.seed([{ id: 'a', avatar: null }]);
    expect(notifications).toBe(1);
  });
});
