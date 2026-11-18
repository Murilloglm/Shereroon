import type { ParticipantView, Phase } from '../session.ts';
import type { MemberView } from './client.ts';

/** Gateway owns other channels; the SFU owns membership in the connected room. */
export function voiceRoster(backend: MemberView[], members: MemberView[], participants: ParticipantView[], phase: Phase): MemberView[] {
  if (phase !== 'connected' && phase !== 'reconnecting') return [...new Map(backend.map((member) => [member.userId, member])).values()];
  const known = new Map(members.map((member) => [member.userId, member]));
  return [...new Map(participants.filter((person) => person.identity).map((person) => [person.identity, known.get(person.identity) ?? {
    userId: person.identity, username: person.identity, displayName: person.name, nickname: null,
    roleIds: [], joinedAt: '', timeoutUntil: null, online: true,
  }])).values()];
}

/** A delayed leave from the previous channel must not erase a newer join. */
export function applyVoiceEvent(current: Record<string, string[]>, event: { channelId: string; userId: string; joined: boolean }): Record<string, string[]> {
  const voice = { ...current };
  for (const channelId of Object.keys(voice)) {
    if (event.joined || channelId === event.channelId) voice[channelId] = voice[channelId]!.filter((id) => id !== event.userId);
  }
  if (event.joined) voice[event.channelId] = [...(voice[event.channelId] ?? []), event.userId];
  return voice;
}
