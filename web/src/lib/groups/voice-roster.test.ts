import { describe, expect, it } from 'vitest';
import type { ParticipantView } from '../session.ts';
import type { MemberView } from './client.ts';
import { applyVoiceEvent, voiceRoster } from './voice-roster.ts';
const member = (id: string): MemberView => ({ userId: id, username: id, displayName: id, nickname: 'Apelido '+id, roleIds: [], joinedAt: '', timeoutUntil: null, online: true });
const person = (id: string): ParticipantView => ({ identity: id, name: id, isLocal: id === 'a', isHost: false, micOn: false, speaking: false, sharing: false, quality: 'boa' });
describe('voice roster', () => {
  it('shows one, two and four real SFU members regardless of stale backend state', () => {
    for (const ids of [['a'], ['a','b'], ['a','b','c','d']]) {
      const roster = voiceRoster([member('ghost')], ids.map(member), ids.map(person), 'connected');
      expect(roster.map(m => m.userId)).toEqual(ids);
      expect(roster[0]?.nickname).toBe('Apelido a');
    }
  });
  it('deduplicates, removes departed users and preserves the reconnect snapshot', () => {
    expect(voiceRoster([member('b')], [], [person('a'),person('a')], 'reconnecting').map(m => m.userId)).toEqual(['a']);
    expect(voiceRoster([member('b')], [], [], 'connected')).toEqual([]);
  });
  it('keeps unknown remote identities visible while server member data loads', () => {
    expect(voiceRoster([], [], [person('remote')], 'connected')[0]).toMatchObject({userId:'remote',displayName:'remote'});
  });
  it('uses the gateway while the SFU has not connected', () => {
    expect(voiceRoster([member('b'),member('b')], [], [], 'connecting').map(m=>m.userId)).toEqual(['b']);
  });
});

it('ignores a delayed leave from an old channel and deduplicates repeated joins', () => {
  const joined = applyVoiceEvent({ old: ['a','b'], next: [] }, { channelId: 'next', userId: 'a', joined: true });
  const left = applyVoiceEvent(joined, { channelId: 'old', userId: 'a', joined: false });
  expect(left).toEqual({ old: ['b'], next: ['a'] });
  expect(applyVoiceEvent(left, { channelId: 'next', userId: 'a', joined: true })).toEqual(left);
  expect(applyVoiceEvent(left, { channelId: 'next', userId: 'a', joined: false })).toEqual({ old: ['b'], next: [] });
});
