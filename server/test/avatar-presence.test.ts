import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type World } from './world.ts';
let world: World;
beforeAll(async () => { world = await createWorld(); });
afterAll(async () => { await world.db.close(); });
describe('avatar presence and authenticated private calls', () => {
  it('sends the current photo reference to server members even when they are not friends', async () => {
    const owner = await world.signup('photoowner'), viewer = await world.signup('photoviewer');
    const groupId = await world.group(owner); await world.join(owner, groupId, viewer);
    const client = await world.connect(viewer);
    await world.ok('PATCH', '/api/me/profile', owner.token, { avatar: 'padrao:5', bio: 'private text' });
    await expect.poll(() => client.of('profile.changed').at(-1)).toMatchObject({ userId: owner.id, avatar: 'padrao:5' });
    expect(client.of('profile.changed').at(-1)).not.toHaveProperty('bio');
    await client.close();
  });
  it('signs only the authenticated account avatar into private room participant metadata', async () => {
    const owner = await world.signup('privatephoto');
    await world.ok('PATCH', '/api/me/profile', owner.token, { avatar: 'padrao:4' });
    const room = await world.ok('POST', '/api/rooms', null, { name: 'Photo room' });
    const input = { invite: room.invite, name: 'Photo', hostKey: room.hostKey, accountId: 'spoofed', avatar: 'arquivo:spoofed1' };
    await world.ok('POST', '/api/rooms/join', owner.token, input);
    expect(world.sfu.tokens.at(-1)).toMatchObject({ accountId: owner.id, avatar: 'padrao:4', host: true });
    await world.ok('POST', '/api/rooms/join', null, { ...input, name: 'Guest' });
    expect(world.sfu.tokens.at(-1)).not.toHaveProperty('accountId');
    expect(world.sfu.tokens.at(-1)).not.toHaveProperty('avatar');
  });
});
