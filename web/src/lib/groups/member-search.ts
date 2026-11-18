import type { MemberView } from './client.ts';

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Pesquisa de membros de um grupo: pelo nome de exibição, pelo apelido no grupo ou pelo usuário (sem acento e sem
 * diferença de maiúsculas), opcionalmente só quem tem um cargo. Inclui quem está offline. Online primeiro, depois
 * por nome. Usa só a lista que o grupo já mostra para quem é membro (nada além do que a pessoa já pode ver).
 */
export function searchMembers(members: readonly MemberView[], query: string, roleId = ''): MemberView[] {
  const wanted = normalize(query.replace(/^@/, ''));
  const name = (member: MemberView) => member.nickname || member.displayName;
  return members
    .filter((member) => !roleId || member.roleIds.includes(roleId))
    .filter((member) => !wanted || normalize(`${member.displayName} ${member.nickname ?? ''} ${member.username}`).includes(wanted))
    .sort((a, b) => Number(b.online) - Number(a.online) || name(a).localeCompare(name(b)));
}
