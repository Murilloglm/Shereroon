import { describe, expect, it } from 'vitest';
import type { MemberView } from './client.ts';
import { searchMembers } from './member-search.ts';

const member = (username: string, displayName: string, extra: Partial<MemberView> = {}): MemberView => ({
  userId: username,
  username,
  displayName,
  nickname: null,
  roleIds: [],
  joinedAt: '2026-11-01T00:00:00Z',
  timeoutUntil: null,
  online: false,
  ...extra,
});

const members = [
  member('murillo', 'Murillo', { online: true, roleIds: ['admin'] }),
  member('kronos', 'Kronos', { nickname: 'Kron do Minecraft', roleIds: ['mod'] }),
  member('luiz', 'Luíz', { online: true }),
  member('ana', 'Ana Júlia', { roleIds: ['mod'] }),
];

describe('pesquisa de membros', () => {
  it('encontra pelo nome, pelo apelido e pelo usuário, sem acento e sem maiúsculas', () => {
    expect(searchMembers(members, 'luiz').map((item) => item.username)).toEqual(['luiz']);
    expect(searchMembers(members, 'MINECRAFT').map((item) => item.username)).toEqual(['kronos']);
    expect(searchMembers(members, '@ana').map((item) => item.username)).toEqual(['ana']);
    expect(searchMembers(members, 'julia').map((item) => item.username)).toEqual(['ana']);
  });

  it('inclui quem está offline, com os online primeiro', () => {
    expect(searchMembers(members, '').map((item) => item.username)).toEqual(['luiz', 'murillo', 'ana', 'kronos']);
  });

  it('filtra por cargo, junto ou não com o texto', () => {
    expect(searchMembers(members, '', 'mod').map((item) => item.username)).toEqual(['ana', 'kronos']);
    expect(searchMembers(members, 'kron', 'mod').map((item) => item.username)).toEqual(['kronos']);
    expect(searchMembers(members, 'murillo', 'mod')).toEqual([]);
  });
});
