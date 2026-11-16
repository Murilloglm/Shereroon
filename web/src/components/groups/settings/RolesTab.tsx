import { ChevronDown, ChevronUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AREA_NAMES, has, PERMISSIONS, ROLE_TEMPLATES, type PermissionArea, type PermissionInfo } from '../../../../../shared/permissions.ts';
import { groups, type GroupView, type RoleView } from '../../../lib/groups/client.ts';
import { Button, cx, IconButton, Menu, MenuItem, MenuLabel, Notice, TextInput, Toggle } from '../../ui.tsx';
import { fieldLabel, useAction } from '../common.tsx';

const AREAS = Object.keys(AREA_NAMES) as PermissionArea[];
const bitOf = (permission: PermissionInfo): bigint => 1n << BigInt(permission.bit);

const ENFORCEMENT_NOTE: Record<PermissionInfo['enforcement'], string | null> = {
  servidor: null,
  aplicativo: 'Aplicada pelo aplicativo de quem assiste ou transmite; o servidor de transmissão não tem como impor.',
  sem_efeito: 'Ainda sem efeito: o recurso não existe no Cosmic Night. A escolha fica guardada.',
};

/** Lista de permissões por categoria, com um interruptor para cada. `locked` diz quais a pessoa não pode mexer. */
export function PermissionList({
  value,
  onChange,
  locked,
  filter = () => true,
}: {
  value: bigint;
  onChange: (next: bigint) => void;
  locked: (permission: PermissionInfo) => string | null;
  filter?: (permission: PermissionInfo) => boolean;
}) {
  return (
    <div className="grid gap-5">
      {AREAS.map((area) => {
        const items = PERMISSIONS.filter((permission) => permission.area === area && filter(permission));
        if (items.length === 0) return null;
        return (
          <section key={area}>
            <h4 className="mb-2 text-xs font-extrabold tracking-wide text-brand-300 uppercase">{AREA_NAMES[area]}</h4>
            <ul className="grid gap-1">
              {items.map((permission) => {
                const bit = bitOf(permission);
                const reason = locked(permission);
                const note = ENFORCEMENT_NOTE[permission.enforcement];
                return (
                  <li key={permission.key} className="flex items-start gap-4 rounded-lg px-2 py-2 hover:bg-ink-800/70" data-testid={`perm-${permission.key}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{permission.name}</p>
                      <p className="text-[13px] leading-snug text-fog-400">{permission.about}</p>
                      {note && <p className="mt-0.5 text-xs leading-snug text-warn-400">{note}</p>}
                      {reason && <p className="mt-0.5 text-xs leading-snug text-fog-500">{reason}</p>}
                    </div>
                    <Toggle on={has(value, bit)} disabled={reason !== null} label={permission.name} onChange={(on) => onChange(on ? value | bit : value & ~bit)} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function RoleEditor({ view, role, manageable }: { view: GroupView; role: RoleView; manageable: boolean }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [permissions, setPermissions] = useState(role.permissions);
  const { busy, run } = useAction();

  useEffect(() => {
    setName(role.name);
    setColor(role.color);
    setPermissions(role.permissions);
  }, [role.id, role.name, role.color, role.permissions]);

  const dirty = name.trim() !== role.name || color !== role.color || permissions !== role.permissions;
  const save = () =>
    run(() =>
      groups.change('PATCH', `/api/roles/${role.id}`, {
        ...(role.isEveryone ? {} : { name: name.trim(), color }),
        ...(permissions !== role.permissions ? { permissions: permissions.toString() } : {}),
      }),
    );

  return (
    <div className="grid content-start gap-5" data-testid="role-editor" data-role={role.name}>
      {!manageable && (
        <Notice tone="aviso">
          {role.isEveryone
            ? 'Você precisa ter um cargo acima do @everyone para mexer nele.'
            : 'Este cargo é igual ou superior ao seu cargo mais alto. Você pode ver, mas não pode alterar.'}
        </Notice>
      )}
      {role.isEveryone ? (
        <Notice>O @everyone vale para todos os membros, com ou sem outros cargos. É o ponto de partida das permissões do grupo.</Notice>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <label className={fieldLabel}>
            Nome do cargo
            <TextInput value={name} maxLength={48} disabled={!manageable} onChange={(event) => setName(event.target.value)} data-testid="role-name" />
          </label>
          <label className={fieldLabel}>
            Cor
            <span className="flex h-11 items-center gap-2">
              <input
                type="color"
                aria-label="Cor do cargo"
                disabled={!manageable}
                value={color ?? '#a78bfa'}
                onChange={(event) => setColor(event.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-ink-600 bg-ink-900 p-1"
              />
              <Button size="sm" disabled={!manageable || color === null} onClick={() => setColor(null)}>
                Sem cor
              </Button>
            </span>
          </label>
        </div>
      )}

      <PermissionList
        value={permissions}
        onChange={setPermissions}
        locked={(permission) => {
          if (!manageable) return '';
          // O backend recusa: ninguém liga nem desliga uma permissão que não tem.
          return has(view.me.permissions, bitOf(permission)) ? null : 'Você não tem esta permissão, então não pode ligar nem desligar.';
        }}
      />

      {manageable && (
        <div className="sticky -bottom-4 flex flex-wrap items-center gap-2 border-t border-ink-700 bg-ink-850 pt-3 pb-4">
          <Button variant="primary" disabled={!dirty || busy || !name.trim()} onClick={() => void save()} data-testid="role-save">
            {busy ? 'Salvando…' : 'Salvar alterações'}
          </Button>
          {dirty && (
            <Button
              onClick={() => {
                setName(role.name);
                setColor(role.color);
                setPermissions(role.permissions);
              }}
            >
              Descartar
            </Button>
          )}
          {!role.isEveryone && (
            <>
              <Button className="ml-auto" disabled={busy} onClick={() => void run(() => groups.change('POST', `/api/groups/${view.group.id}/roles`, { copyFrom: role.id }))} data-testid="role-duplicate">
                <Copy className="size-4" aria-hidden="true" />
                Duplicar
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                data-testid="role-delete"
                onClick={() =>
                  window.confirm(`Excluir o cargo “${role.name}”? ${role.memberCount} ${role.memberCount === 1 ? 'membro perde' : 'membros perdem'} este cargo.`) &&
                  void run(() => groups.change('DELETE', `/api/roles/${role.id}`))
                }
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Excluir
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function RolesTab({ view }: { view: GroupView }) {
  const [selected, setSelected] = useState<string>(() => view.roles.find((role) => !role.isEveryone)?.id ?? view.roles[0]!.id);
  const [dragging, setDragging] = useState<string | null>(null);
  const { busy, run } = useAction();
  const movable = view.roles.filter((role) => !role.isEveryone);
  const role = view.roles.find((item) => item.id === selected) ?? view.roles[0]!;
  const manageable = (item: RoleView): boolean => view.me.isOwner || item.position < (view.me.top ?? 0);

  const reorder = (order: string[]) => run(() => groups.change('PUT', `/api/groups/${view.group.id}/roles/order`, { order }));
  const moveBefore = (movedId: string, targetId: string) => {
    if (movedId === targetId) return;
    const ids = movable.map((item) => item.id).filter((id) => id !== movedId);
    ids.splice(ids.indexOf(targetId), 0, movedId);
    void reorder(ids);
  };
  const step = (id: string, delta: -1 | 1) => {
    const ids = movable.map((item) => item.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    void reorder(ids);
  };
  const create = (input: object) =>
    run(async () => {
      const { id } = await groups.change<{ id: string }>('POST', `/api/groups/${view.group.id}/roles`, input);
      setSelected(id);
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_1fr]" data-testid="roles-tab">
      <div className="grid content-start gap-2">
        <Menu
          side="bottom"
          trigger={({ toggle }) => (
            <Button variant="primary" size="sm" className="h-10 w-full" disabled={busy} onClick={toggle} data-testid="role-new">
              <Plus className="size-4" aria-hidden="true" />
              Novo cargo
            </Button>
          )}
        >
          {(close) => (
            <div className="w-56">
              <MenuItem
                onClick={() => {
                  close();
                  void create({ name: 'novo cargo' });
                }}
                data-testid="role-new-blank"
              >
                Em branco
              </MenuItem>
              <MenuLabel>A partir de um modelo</MenuLabel>
              {ROLE_TEMPLATES.map((template) => (
                <MenuItem
                  key={template.name}
                  icon={<span className="size-3 rounded-full" style={{ background: template.color }} />}
                  onClick={() => {
                    close();
                    void create({ name: template.name, color: template.color, permissions: template.permissions.toString() });
                  }}
                >
                  {template.name}
                </MenuItem>
              ))}
            </div>
          )}
        </Menu>
        <p className="text-xs leading-snug text-fog-500">Do mais alto para o mais baixo. Arraste para reordenar; só dá para mexer nos cargos abaixo do seu.</p>
        <ul className="grid gap-1" data-testid="role-list">
          {view.roles.map((item) => {
            const can = !item.isEveryone && manageable(item);
            return (
              <li
                key={item.id}
                data-testid="role-item"
                data-role={item.name}
                draggable={can}
                onDragStart={() => setDragging(item.id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => dragging && can && event.preventDefault()}
                onDrop={() => dragging && can && moveBefore(dragging, item.id)}
                className={cx(
                  'flex items-center gap-1.5 rounded-lg border pr-1 transition-[background,border-color] duration-150',
                  item.id === role.id ? 'border-brand-400 bg-brand-500/15' : 'border-transparent hover:bg-ink-800',
                  dragging === item.id && 'opacity-50',
                )}
              >
                <GripVertical className={cx('ml-1 size-4 shrink-0', can ? 'cursor-grab text-fog-500' : 'text-transparent')} aria-hidden="true" />
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left" onClick={() => setSelected(item.id)}>
                  <span className="size-3 shrink-0 rounded-full border border-white/20" style={{ background: item.color ?? 'transparent' }} aria-hidden="true" />
                  <span className="truncate text-sm font-bold">{item.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-fog-500">{item.memberCount}</span>
                </button>
                {can && (
                  <span className="flex shrink-0">
                    <IconButton label={`Subir ${item.name}`} className="size-7" disabled={busy} onClick={() => step(item.id, -1)}>
                      <ChevronUp className="size-4" />
                    </IconButton>
                    <IconButton label={`Descer ${item.name}`} className="size-7" disabled={busy} onClick={() => step(item.id, 1)}>
                      <ChevronDown className="size-4" />
                    </IconButton>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <RoleEditor view={view} role={role} manageable={role.isEveryone ? view.me.isOwner || (view.me.top ?? 0) > 0 : manageable(role)} />
    </div>
  );
}
