import { Check, Clock, Crown, Eye, Gavel, UserX, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AREA_NAMES, has, P, PERMISSIONS, type PermissionArea } from '../../../../../shared/permissions.ts';
import { groups, type GroupView, type MemberView } from '../../../lib/groups/client.ts';
import { dialogs } from '../../../lib/dialogs.ts';
import { Avatar, Button, cx, IconButton, Menu, MenuItem, MenuLabel, Modal, Notice, TextInput } from '../../ui.tsx';
import { can, memberName, nameColor, selectClass, useAction } from '../common.tsx';

interface Effective {
  isOwner: boolean;
  isCosmicAdmin: boolean;
  timedOut: boolean;
  base: bigint;
  channels: Record<string, bigint>;
}

/** O que um membro pode fazer de verdade: no grupo e em cada canal, já com todos os cargos e regras de canal. */
function EffectivePermissions({ view, member, onClose }: { view: GroupView; member: MemberView; onClose: () => void }) {
  const [data, setData] = useState<Effective | null>(null);
  const [channelId, setChannelId] = useState('');
  const { run } = useAction();

  useEffect(() => {
    void run(async () => {
      const raw = await groups.call('GET', `/api/groups/${view.group.id}/members/${member.userId}/permissions`);
      setData({ isOwner: raw.isOwner, isCosmicAdmin: raw.isCosmicAdmin === true, timedOut: raw.timedOut, base: BigInt(raw.base), channels: Object.fromEntries(Object.entries(raw.channels as Record<string, string>).map(([id, value]) => [id, BigInt(value)])) });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.userId, view]);

  const set = data ? (channelId ? (data.channels[channelId] ?? 0n) : data.base) : 0n;
  const roles = view.roles.filter((role) => role.isEveryone || member.roleIds.includes(role.id));
  const channels = view.channels.filter((channel) => channel.kind !== 'categoria');

  return (
    <Modal title={`Permissões efetivas de ${memberName(member)}`} onClose={onClose} wide>
      <div className="grid gap-4" data-testid="effective-permissions">
        <p className="text-sm text-fog-400">
          Resultado calculado pelo servidor, somando todos os cargos da pessoa ({roles.map((role) => role.name).join(', ')}) e as regras do canal escolhido.
        </p>
        {data?.isCosmicAdmin ? <Notice tone="ok">Cosmic Admin: administração oficial da plataforma, acima dos cargos locais.</Notice> : data?.isOwner && <Notice tone="ok">Esta pessoa é a dona do grupo: tem todas as permissões, em todos os canais.</Notice>}
        {data?.timedOut && <Notice tone="aviso">Está de castigo agora: lê, mas não escreve, não fala e não transmite.</Notice>}
        <label className="grid gap-1.5 text-sm font-semibold">
          Onde
          <select className={selectClass} value={channelId} onChange={(event) => setChannelId(event.target.value)} data-testid="effective-where">
            <option value="">No grupo inteiro (sem regras de canal)</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.kind === 'voz' ? '🔊 ' : '# '}
                {channel.name}
              </option>
            ))}
          </select>
        </label>
        {channelId && data && !has(set, P.VIEW_CHANNEL) && <Notice tone="aviso">Esta pessoa não vê este canal, então não pode fazer nada nele.</Notice>}
        {!data ? (
          <p className="text-fog-400">Calculando…</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(AREA_NAMES) as PermissionArea[]).map((area) => (
              <section key={area}>
                <h4 className="mb-1.5 text-xs font-extrabold tracking-wide text-brand-300 uppercase">{AREA_NAMES[area]}</h4>
                <ul className="grid gap-0.5">
                  {PERMISSIONS.filter((permission) => permission.area === area).map((permission) => {
                    const bit = 1n << BigInt(permission.bit);
                    const yes = has(set, bit);
                    const from = roles.filter((role) => has(role.permissions, bit) || has(role.permissions, P.ADMINISTRATOR)).map((role) => role.name);
                    return (
                      <li key={permission.key} className="flex items-start gap-2 py-0.5 text-sm" data-testid={`effective-${permission.key}`} data-granted={yes}>
                        {yes ? <Check className="mt-0.5 size-4 shrink-0 text-ok-400" aria-label="Sim" /> : <X className="mt-0.5 size-4 shrink-0 text-fog-500" aria-label="Não" />}
                        <span className={cx('min-w-0', !yes && 'text-fog-500')}>
                          {permission.name}
                          {!channelId && yes && !data.isOwner && from.length > 0 && <span className="ml-1.5 text-xs text-fog-500">({from.join(', ')})</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

const TIMEOUTS: [string, number][] = [
  ['10 minutos', 10],
  ['1 hora', 60],
  ['1 dia', 60 * 24],
  ['1 semana', 60 * 24 * 7],
];

export function MembersTab({ view }: { view: GroupView }) {
  const [search, setSearch] = useState('');
  const [inspecting, setInspecting] = useState<string | null>(null);
  const { busy, run } = useAction();
  const term = search.trim().toLowerCase();
  const members = view.members.filter((member) => !term || `${member.displayName} ${member.username} ${member.nickname ?? ''}`.toLowerCase().includes(term));
  const assignable = view.roles.filter((role) => !role.isEveryone && (view.me.isOwner || view.me.isCosmicAdmin || role.position < (view.me.top ?? 0)));
  const inspected = view.members.find((member) => member.userId === inspecting);
  const path = (member: MemberView, action = '') => `/api/groups/${view.group.id}/members/${member.userId}${action}`;

  const toggleRole = (member: MemberView, roleId: string) =>
    run(() => groups.change('PATCH', path(member), { roleIds: member.roleIds.includes(roleId) ? member.roleIds.filter((id) => id !== roleId) : [...member.roleIds, roleId] }));

  return (
    <div className="grid gap-4" data-testid="members-tab">
      <TextInput aria-label="Procurar membro" placeholder="Procurar por nome" value={search} onChange={(event) => setSearch(event.target.value)} />
      <ul className="grid gap-1.5">
        {members.map((member) => {
          const owner = member.userId === view.group.ownerId;
          const self = member.userId === view.me.userId;
          const timedOut = member.timeoutUntil !== null && Date.parse(member.timeoutUntil) > Date.now();
          return (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-2" data-testid="member-row" data-user={member.username}>
              <Avatar id={member.userId} name={memberName(member)} size={36} online={member.online} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate font-bold" style={{ color: nameColor(view, member) }}>
                  <span className="truncate">{memberName(member)}</span>
                  {member.cosmicAdmin && <Crown className="size-4 shrink-0 text-neon-300" aria-label="Cosmic Admin" />}
                  {owner && <Crown className="size-4 shrink-0 text-warn-400" aria-label="Dono do grupo" />}
                  {timedOut && <Clock className="size-4 shrink-0 text-warn-400" aria-label="De castigo" />}
                </p>
                <p className="truncate text-xs text-fog-500">@{member.username}</p>
              </div>
              <ul className="flex max-w-full flex-wrap gap-1.5">
                {view.roles
                  .filter((role) => member.roleIds.includes(role.id))
                  .map((role) => (
                    <li key={role.id} className="flex items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800 px-2 py-0.5 text-xs font-bold" data-testid="member-role">
                      <span className="size-2 rounded-full" style={{ background: role.color ?? 'currentColor' }} aria-hidden="true" />
                      {role.name}
                    </li>
                  ))}
              </ul>
              {can(view, P.MANAGE_ROLES) && (!owner || view.me.isCosmicAdmin) && (!member.cosmicAdmin || self) && (
                <Menu
                  side="bottom"
                  align="end"
                  trigger={({ toggle }) => (
                    <Button size="sm" onClick={toggle} disabled={busy} data-testid="member-roles">
                      Cargos
                    </Button>
                  )}
                >
                  <div className="max-h-72 w-56 overflow-y-auto">
                    <MenuLabel>Cargos que você pode dar ou tirar</MenuLabel>
                    {assignable.map((role) => (
                      <MenuItem key={role.id} selected={member.roleIds.includes(role.id)} onClick={() => void toggleRole(member, role.id)} data-testid={`member-role-${role.name}`}>
                        {role.name}
                      </MenuItem>
                    ))}
                    {assignable.length === 0 && <p className="px-2.5 py-2 text-sm text-fog-400">Não há cargos abaixo do seu.</p>}
                  </div>
                </Menu>
              )}
              {(can(view, P.MANAGE_ROLES) || self) && (
                <IconButton label={`Ver permissões efetivas de ${memberName(member)}`} className="size-8" onClick={() => setInspecting(member.userId)} data-testid="member-effective">
                  <Eye className="size-4" />
                </IconButton>
              )}
              {!member.cosmicAdmin && (!owner || view.me.isCosmicAdmin) && !self && (can(view, P.KICK_MEMBERS) || can(view, P.BAN_MEMBERS)) && (
                <Menu
                  side="bottom"
                  align="end"
                  trigger={({ toggle }) => (
                    <IconButton label={`Punir ${memberName(member)}`} className="size-8 hover:text-live-300" onClick={toggle} data-testid="member-punish">
                      <Gavel className="size-4" />
                    </IconButton>
                  )}
                >
                  {(close) => (
                    <div className="w-56">
                      {can(view, P.KICK_MEMBERS) && (
                        <>
                          <MenuLabel>Castigo (lê, mas não escreve nem fala)</MenuLabel>
                          {TIMEOUTS.map(([label, minutes]) => (
                            <MenuItem key={minutes} icon={<Clock className="size-4" />} onClick={() => (close(), void run(() => groups.change('POST', path(member, '/timeout'), { minutes })))}>
                              {label}
                            </MenuItem>
                          ))}
                          {timedOut && <MenuItem onClick={() => (close(), void run(() => groups.change('POST', path(member, '/timeout'), { minutes: 0 })))}>Tirar do castigo</MenuItem>}
                          <MenuItem
                            icon={<UserX className="size-4" />}
                            data-testid="member-kick"
                            onClick={() => {
                              close();
                              void dialogs.confirm({
                                title: `Expulsar ${memberName(member)}?`,
                                message: 'A pessoa sai do grupo agora e pode voltar com um convite.',
                                confirmLabel: 'Expulsar',
                                tone: 'perigo',
                                action: () => groups.change('POST', path(member, '/kick'), {}),
                              });
                            }}
                          >
                            Expulsar do grupo
                          </MenuItem>
                        </>
                      )}
                      {can(view, P.BAN_MEMBERS) && (
                        <MenuItem
                          icon={<Gavel className="size-4" />}
                          data-testid="member-ban"
                          onClick={() => {
                            close();
                            void dialogs.prompt({
                              title: `Banir ${memberName(member)}?`,
                              message: 'A pessoa sai do grupo e não volta nem com convite, até alguém desfazer o banimento.',
                              label: 'Motivo (opcional, aparece na auditoria)',
                              maxLength: 300,
                              confirmLabel: 'Banir',
                              tone: 'perigo',
                              action: (reason) => groups.change('POST', path(member, '/ban'), { reason }),
                            });
                          }}
                        >
                          Banir do grupo
                        </MenuItem>
                      )}
                    </div>
                  )}
                </Menu>
              )}
            </li>
          );
        })}
      </ul>
      {inspected && <EffectivePermissions view={view} member={inspected} onClose={() => setInspecting(null)} />}
    </div>
  );
}
