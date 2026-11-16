import { ChevronDown, ChevronUp, FolderClosed, Hash, Lock, Plus, ShieldCheck, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AREA_NAMES, GROUP_WIDE, has, P, PERMISSIONS, type PermissionArea } from '../../../../../shared/permissions.ts';
import { groups, type ChannelKind, type ChannelView, type GroupView } from '../../../lib/groups/client.ts';
import { Button, cx, IconButton, Modal, Notice, TextInput } from '../../ui.tsx';
import { can, fieldLabel, memberName, selectClass, useAction } from '../common.tsx';

const KIND_ICON = { categoria: FolderClosed, texto: Hash, voz: Volume2 } as const;
const KIND_NAME = { categoria: 'Categoria', texto: 'Canal de texto', voz: 'Canal de voz' } as const;

interface Override {
  targetKind: 'cargo' | 'membro';
  targetId: string;
  allow: bigint;
  deny: bigint;
}

type Choice = 'permitir' | 'herdar' | 'negar';

/** Regras de um canal: para cada cargo ou membro, cada permissão fica em Permitir, Negar ou Herdar. */
function ChannelPermissions({ view, channel, onClose }: { view: GroupView; channel: ChannelView; onClose: () => void }) {
  const [overrides, setOverrides] = useState<Override[] | null>(null);
  const [target, setTarget] = useState<{ kind: 'cargo' | 'membro'; id: string } | null>(null);
  const [draft, setDraft] = useState<{ allow: bigint; deny: bigint }>({ allow: 0n, deny: 0n });
  const { busy, run } = useAction();
  const everyone = view.roles.find((role) => role.isEveryone)!;

  const load = async () => {
    const result = await groups.call<{ overrides: { targetKind: 'cargo' | 'membro'; targetId: string; allow: string; deny: string }[] }>('GET', `/api/channels/${channel.id}/overrides`);
    setOverrides(result.overrides.map((item) => ({ ...item, allow: BigInt(item.allow), deny: BigInt(item.deny) })));
  };

  useEffect(() => {
    void run(load);
    setTarget({ kind: 'cargo', id: everyone.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  const saved = overrides?.find((item) => target && item.targetKind === target.kind && item.targetId === target.id);
  useEffect(() => {
    setDraft({ allow: saved?.allow ?? 0n, deny: saved?.deny ?? 0n });
  }, [saved?.allow, saved?.deny, target?.kind, target?.id]);

  const label = (kind: 'cargo' | 'membro', id: string): string => {
    if (kind === 'cargo') return view.roles.find((role) => role.id === id)?.name ?? 'cargo removido';
    const member = view.members.find((item) => item.userId === id);
    return member ? memberName(member) : 'membro que saiu';
  };

  // Permissões do grupo inteiro (administração) não entram em regra de canal; categorias aceitam todas as demais.
  const scoped = PERMISSIONS.filter((permission) => {
    const bit = 1n << BigInt(permission.bit);
    if (has(GROUP_WIDE, bit)) return false;
    if (channel.kind === 'texto') return permission.area === 'texto' || permission.key === 'USE_COMMANDS' || permission.key === 'MANAGE_TICKETS' || permission.key === 'USE_ADMIN_TOOLS';
    if (channel.kind === 'voz') return permission.area === 'voz' || permission.area === 'tela' || permission.key === 'VIEW_CHANNEL' || permission.key === 'CONTROL_MUSIC';
    return true;
  });
  const dirty = draft.allow !== (saved?.allow ?? 0n) || draft.deny !== (saved?.deny ?? 0n);
  const choiceOf = (bit: bigint): Choice => (has(draft.allow, bit) ? 'permitir' : has(draft.deny, bit) ? 'negar' : 'herdar');
  const choose = (bit: bigint, choice: Choice) =>
    setDraft((current) => ({
      allow: choice === 'permitir' ? current.allow | bit : current.allow & ~bit,
      deny: choice === 'negar' ? current.deny | bit : current.deny & ~bit,
    }));
  const save = () =>
    target &&
    run(async () => {
      await groups.change('PUT', `/api/channels/${channel.id}/overrides/${target.kind}/${target.id}`, { allow: draft.allow.toString(), deny: draft.deny.toString() });
      await load();
    });

  const withRules = overrides ?? [];
  const otherRoles = view.roles.filter((role) => !withRules.some((item) => item.targetKind === 'cargo' && item.targetId === role.id) && role.id !== everyone.id);
  const otherMembers = view.members.filter((member) => !withRules.some((item) => item.targetKind === 'membro' && item.targetId === member.userId));
  const targets: { kind: 'cargo' | 'membro'; id: string }[] = [
    { kind: 'cargo', id: everyone.id },
    ...withRules.filter((item) => !(item.targetKind === 'cargo' && item.targetId === everyone.id)).map((item) => ({ kind: item.targetKind, id: item.targetId })),
  ];
  if (target && !targets.some((item) => item.kind === target.kind && item.id === target.id)) targets.push(target);

  return (
    <Modal title={`Permissões de ${channel.kind === 'categoria' ? 'categoria' : 'canal'}: ${channel.name}`} onClose={onClose} wide>
      <div className="grid gap-4" data-testid="channel-permissions">
        <Notice>
          Cada permissão pode ficar em <b>Permitir</b>, <b>Negar</b> ou <b>Herdar</b>. Herdar deixa valer o que vem
          {channel.parentId ? ' da categoria e, antes dela, dos cargos' : ' dos cargos'}. A regra de um membro vence a dos cargos dele; quem tem “Administrador” passa por
          cima de todas.
        </Notice>
        <div className="grid gap-4 md:grid-cols-[15rem_1fr]">
          <div className="grid content-start gap-2">
            <ul className="grid gap-1">
              {targets.map((item) => {
                const rule = withRules.find((entry) => entry.targetKind === item.kind && entry.targetId === item.id);
                return (
                  <li key={`${item.kind}:${item.id}`}>
                    <button
                      type="button"
                      onClick={() => setTarget(item)}
                      data-testid="override-target"
                      className={cx(
                        'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm font-bold',
                        target?.kind === item.kind && target.id === item.id ? 'border-brand-400 bg-brand-500/15' : 'border-transparent hover:bg-ink-800',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{label(item.kind, item.id)}</span>
                      <span className="shrink-0 text-xs font-normal text-fog-500">{item.kind === 'cargo' ? 'cargo' : 'membro'}</span>
                      {rule && <span className="size-2 shrink-0 rounded-full bg-brand-300" title="Tem regra neste canal" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <select
              aria-label="Adicionar regra para um cargo ou membro"
              className={selectClass}
              value=""
              data-testid="override-add"
              onChange={(event) => {
                const [kind, id] = event.target.value.split(':') as ['cargo' | 'membro', string];
                if (id) setTarget({ kind, id });
              }}
            >
              <option value="">Adicionar cargo ou membro…</option>
              <optgroup label="Cargos">
                {otherRoles.map((role) => (
                  <option key={role.id} value={`cargo:${role.id}`}>
                    {role.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Membros">
                {otherMembers.map((member) => (
                  <option key={member.userId} value={`membro:${member.userId}`}>
                    {memberName(member)}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {target && (
            <div className="grid content-start gap-4">
              {(Object.keys(AREA_NAMES) as PermissionArea[]).map((area) => {
                const items = scoped.filter((permission) => permission.area === area);
                if (items.length === 0) return null;
                return (
                  <section key={area}>
                    <h4 className="mb-1.5 text-xs font-extrabold tracking-wide text-brand-300 uppercase">{AREA_NAMES[area]}</h4>
                    <ul className="grid gap-1">
                      {items.map((permission) => {
                        const bit = 1n << BigInt(permission.bit);
                        const mine = has(channel.permissions, bit);
                        const current = choiceOf(bit);
                        return (
                          <li key={permission.key} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-800/70" data-testid={`override-${permission.key}`} data-choice={current}>
                            <p className="min-w-0 flex-1 text-sm font-semibold" title={permission.about}>
                              {permission.name}
                              {!mine && <span className="ml-2 text-xs font-normal text-fog-500">você não tem neste canal</span>}
                            </p>
                            <div className="flex shrink-0 overflow-hidden rounded-lg border border-ink-600" role="radiogroup" aria-label={permission.name}>
                              {(['negar', 'herdar', 'permitir'] as const).map((choice) => (
                                <button
                                  key={choice}
                                  type="button"
                                  role="radio"
                                  aria-checked={current === choice}
                                  disabled={!mine}
                                  data-choice={choice}
                                  onClick={() => choose(bit, choice)}
                                  className={cx(
                                    'h-8 px-2.5 text-xs font-bold transition-colors disabled:opacity-40',
                                    current === choice
                                      ? choice === 'permitir'
                                        ? 'bg-ok-400/25 text-ok-400'
                                        : choice === 'negar'
                                          ? 'bg-live-500/25 text-live-300'
                                          : 'bg-ink-600 text-fog-100'
                                      : 'text-fog-400 hover:bg-ink-700',
                                  )}
                                >
                                  {choice === 'permitir' ? 'Permitir' : choice === 'negar' ? 'Negar' : 'Herdar'}
                                </button>
                              ))}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              <div className="sticky -bottom-4 flex items-center gap-2 border-t border-ink-700 bg-ink-850 pt-3 pb-4">
                <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()} data-testid="override-save">
                  {busy ? 'Salvando…' : `Salvar a regra de ${label(target.kind, target.id)}`}
                </Button>
                {dirty && <Button onClick={() => setDraft({ allow: saved?.allow ?? 0n, deny: saved?.deny ?? 0n })}>Descartar</Button>}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function CreateChannelModal({ view, initial, onClose }: { view: GroupView; initial: { kind: ChannelKind; parentId: string | null }; onClose: () => void }) {
  const [kind, setKind] = useState<ChannelKind>(initial.kind);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState(initial.parentId ?? '');
  const [isPrivate, setPrivate] = useState(false);
  const { busy, run } = useAction();
  const categories = view.channels.filter((channel) => channel.kind === 'categoria');

  return (
    <Modal title="Criar canal" onClose={onClose}>
      <form
        className="grid gap-4"
        data-testid="create-channel"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => groups.change('POST', `/api/groups/${view.group.id}/channels`, { kind, name, parentId: kind === 'categoria' ? null : parentId || null, private: isPrivate })).then((done) => done && onClose());
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          {(['texto', 'voz', 'categoria'] as const).map((value) => {
            const Icon = KIND_ICON[value];
            return (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                data-testid={`channel-kind-${value}`}
                onClick={() => setKind(value)}
                className={cx(
                  'grid justify-items-center gap-1.5 rounded-xl border px-2 py-3 text-sm font-bold',
                  kind === value ? 'border-brand-300 bg-brand-500/20 text-white' : 'border-ink-600 bg-ink-800 text-fog-300 hover:border-ink-500',
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {KIND_NAME[value]}
              </button>
            );
          })}
        </div>
        <label className={fieldLabel}>
          Nome
          <TextInput value={name} maxLength={48} required autoFocus onChange={(event) => setName(event.target.value)} data-testid="channel-name" />
        </label>
        {kind !== 'categoria' && (
          <label className={fieldLabel}>
            Categoria
            <select className={selectClass} value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-600 bg-ink-800/50 p-3">
          <input type="checkbox" className="mt-1 size-4 accent-brand-500" checked={isPrivate} onChange={(event) => setPrivate(event.target.checked)} data-testid="channel-private" />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Lock className="size-4" aria-hidden="true" /> {kind === 'categoria' ? 'Categoria privada' : 'Canal privado'}
            </span>
            <span className="text-[13px] leading-snug text-fog-400">
              Fica escondido de todos, menos de você e dos administradores. Depois, libere cargos ou pessoas em “Permissões” do canal.
            </span>
          </span>
        </label>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()} data-testid="channel-create">
          {busy ? 'Criando…' : 'Criar'}
        </Button>
      </form>
    </Modal>
  );
}

function ChannelRow({ view, channel, siblings, onPermissions }: { view: GroupView; channel: ChannelView; siblings: ChannelView[]; onPermissions: () => void }) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [limit, setLimit] = useState(String(channel.userLimit));
  const { busy, run } = useAction();
  const Icon = channel.private ? Lock : KIND_ICON[channel.kind];
  const index = siblings.findIndex((item) => item.id === channel.id);
  const categories = view.channels.filter((item) => item.kind === 'categoria');

  useEffect(() => {
    setName(channel.name);
    setTopic(channel.topic);
    setLimit(String(channel.userLimit));
  }, [channel.name, channel.topic, channel.userLimit]);

  const dirty = name.trim() !== channel.name || topic.trim() !== channel.topic || Number(limit) !== channel.userLimit;
  const swap = (delta: -1 | 1) => {
    const other = siblings[index + delta];
    if (!other) return;
    // Troca de lugar com o vizinho; as posições são renumeradas para não haver empate.
    const order = siblings.map((item) => item.id);
    [order[index], order[index + delta]] = [order[index + delta]!, order[index]!];
    void run(() => groups.change('PUT', `/api/groups/${view.group.id}/channels/order`, { items: order.map((id, position) => ({ id, position })) }));
  };

  return (
    <li className={cx('grid gap-2 rounded-xl border border-ink-700 bg-ink-800/40 p-2.5', channel.kind !== 'categoria' && channel.parentId && 'ml-6')} data-testid="channel-row" data-channel={channel.name}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="size-4 shrink-0 text-fog-400" aria-label={KIND_NAME[channel.kind]} />
        <TextInput aria-label="Nome do canal" value={name} maxLength={48} onChange={(event) => setName(event.target.value)} className="h-9 min-w-32 flex-1" />
        {channel.kind === 'voz' && (
          <label className="flex items-center gap-1.5 text-xs font-semibold text-fog-400">
            Limite
            <TextInput aria-label="Limite de pessoas (0 = sem limite)" type="number" min={0} max={99} value={limit} onChange={(event) => setLimit(event.target.value)} className="h-9 w-16" />
          </label>
        )}
        {channel.kind !== 'categoria' && (
          <select
            aria-label="Categoria do canal"
            className={cx(selectClass, 'h-9 w-40')}
            value={channel.parentId ?? ''}
            onChange={(event) => void run(() => groups.change('PATCH', `/api/channels/${channel.id}`, { parentId: event.target.value || null }))}
          >
            <option value="">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        )}
        <IconButton label="Subir" className="size-8" disabled={busy || index <= 0} onClick={() => swap(-1)}>
          <ChevronUp className="size-4" />
        </IconButton>
        <IconButton label="Descer" className="size-8" disabled={busy || index >= siblings.length - 1} onClick={() => swap(1)}>
          <ChevronDown className="size-4" />
        </IconButton>
        {can(view, P.MANAGE_ROLES) && (
          <Button size="sm" onClick={onPermissions} data-testid="channel-permissions-open">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Permissões
          </Button>
        )}
        <IconButton
          label={`Excluir ${channel.name}`}
          className="size-8 hover:text-live-300"
          disabled={busy}
          data-testid="channel-delete"
          onClick={() =>
            window.confirm(channel.kind === 'texto' ? `Excluir #${channel.name}? As mensagens dele são apagadas.` : `Excluir “${channel.name}”?`) &&
            void run(() => groups.change('DELETE', `/api/channels/${channel.id}`))
          }
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      {channel.kind === 'texto' && <TextInput aria-label="Assunto do canal" placeholder="Assunto (opcional)" value={topic} maxLength={300} onChange={(event) => setTopic(event.target.value)} className="h-9" />}
      {dirty && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !name.trim()}
            data-testid="channel-save"
            onClick={() => void run(() => groups.change('PATCH', `/api/channels/${channel.id}`, { name: name.trim(), topic: topic.trim(), ...(channel.kind === 'voz' ? { userLimit: Number(limit) || 0 } : {}) }))}
          >
            Salvar
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setName(channel.name);
              setTopic(channel.topic);
              setLimit(String(channel.userLimit));
            }}
          >
            Descartar
          </Button>
        </div>
      )}
    </li>
  );
}

export function ChannelsTab({ view }: { view: GroupView }) {
  const [creating, setCreating] = useState(false);
  const [permissionsOf, setPermissionsOf] = useState<string | null>(null);
  const byPosition = (a: ChannelView, b: ChannelView) => a.position - b.position || a.name.localeCompare(b.name);
  const categories = view.channels.filter((channel) => channel.kind === 'categoria').sort(byPosition);
  const childrenOf = (parentId: string | null) => view.channels.filter((channel) => channel.kind !== 'categoria' && channel.parentId === parentId).sort(byPosition);
  const editing = view.channels.find((channel) => channel.id === permissionsOf);

  return (
    <div className="grid gap-4" data-testid="channels-tab">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-fog-400">Só aparecem aqui os canais que você pode ver.</p>
        <Button variant="primary" size="sm" className="h-10" onClick={() => setCreating(true)} data-testid="channel-new">
          <Plus className="size-4" aria-hidden="true" />
          Criar canal
        </Button>
      </div>
      <ul className="grid gap-2">
        {childrenOf(null).map((channel) => (
          <ChannelRow key={channel.id} view={view} channel={channel} siblings={childrenOf(null)} onPermissions={() => setPermissionsOf(channel.id)} />
        ))}
        {categories.map((category) => (
          <li key={category.id} className="grid gap-2">
            <ul className="grid gap-2">
              <ChannelRow view={view} channel={category} siblings={categories} onPermissions={() => setPermissionsOf(category.id)} />
              {childrenOf(category.id).map((channel) => (
                <ChannelRow key={channel.id} view={view} channel={channel} siblings={childrenOf(category.id)} onPermissions={() => setPermissionsOf(channel.id)} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {creating && <CreateChannelModal view={view} initial={{ kind: 'texto', parentId: null }} onClose={() => setCreating(false)} />}
      {editing && <ChannelPermissions view={view} channel={editing} onClose={() => setPermissionsOf(null)} />}
    </div>
  );
}
