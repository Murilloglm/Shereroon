import { Copy, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { describePermissions, P } from '../../../../../shared/permissions.ts';
import { navigate } from '../../../App.tsx';
import { desktop } from '../../../lib/desktop.ts';
import { copyText } from '../../../lib/format.ts';
import { groups, type GroupView } from '../../../lib/groups/client.ts';
import { dialogs } from '../../../lib/dialogs.ts';
import { Button, cx, Modal, Notice, TextInput, Toggle } from '../../ui.tsx';
import { can, fieldLabel, fileToIcon, GroupIcon, memberName, selectClass, useAction, when } from '../common.tsx';
import { BotsTab } from './BotsTab.tsx';
import { ChannelsTab } from './ChannelsTab.tsx';
import { MembersTab } from './MembersTab.tsx';
import { RolesTab } from './RolesTab.tsx';
import { EmojisTab } from './EmojisTab.tsx';

export type SettingsTab = 'geral' | 'cargos' | 'canais' | 'membros' | 'bots' | 'emojis' | 'convites' | 'banimentos' | 'auditoria';

/** Link de convite de grupo. No aplicativo de Windows aponta para o site, para abrir em qualquer navegador. */
export function groupInviteLink(code: string): string {
  if (desktop) return desktop.config.siteUrl ? `${desktop.config.siteUrl}/#/convite/${code}` : code;
  const url = new URL(window.location.href);
  url.hash = `#/convite/${code}`;
  url.search = '';
  return url.toString();
}

/** Aceita o link inteiro ou só o código do convite. */
export function extractGroupInvite(input: string): string | null {
  const text = input.trim();
  return /#\/convite\/([A-Za-z0-9_-]{8,20})/.exec(text)?.[1] ?? (/^[A-Za-z0-9_-]{8,20}$/.test(text) ? text : null);
}

function Overview({ view, onClose }: { view: GroupView; onClose: () => void }) {
  const { group } = view;
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [icon, setIcon] = useState(group.icon);
  const [isPublic, setPublic] = useState(group.isPublic);
  const [heir, setHeir] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const editable = can(view, P.MANAGE_GROUP);
  const dirty = name.trim() !== group.name || description.trim() !== group.description || icon !== group.icon || isPublic !== group.isPublic;
  const gone = () => {
    onClose();
    navigate('#/grupos');
  };

  return (
    <div className="grid gap-6" data-testid="overview-tab">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="grid justify-items-center gap-2">
          <GroupIcon group={{ ...group, name: name || group.name, icon }} size={96} />
          {editable && (
            <>
              <input
                ref={picker}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void run(async () => setIcon(await fileToIcon(file)));
                  event.target.value = '';
                }}
              />
              <Button size="sm" onClick={() => picker.current?.click()}>
                Trocar ícone
              </Button>
              {icon && (
                <Button size="sm" onClick={() => setIcon(null)}>
                  Remover
                </Button>
              )}
            </>
          )}
        </div>
        <div className="grid content-start gap-4">
          <label className={fieldLabel}>
            Nome do grupo
            <TextInput value={name} maxLength={48} disabled={!editable} onChange={(event) => setName(event.target.value)} data-testid="group-name-input" />
          </label>
          <label className={fieldLabel}>
            Descrição
            <textarea
              value={description}
              maxLength={300}
              rows={3}
              disabled={!editable}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full resize-none rounded-xl border border-ink-600 bg-ink-900/70 px-3 py-2 text-sm text-fog-100 focus:border-brand-400 focus:outline-none disabled:opacity-60"
            />
          </label>
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Grupo público</p>
              <p className="text-[13px] leading-snug text-fog-400">Aparece na busca de grupos e qualquer conta pode entrar. Desligado, só se entra por convite.</p>
            </div>
            <Toggle on={isPublic} disabled={!editable} label="Grupo público" onChange={setPublic} />
          </div>
          {editable && (
            <Button
              variant="primary"
              className="w-fit"
              disabled={!dirty || busy || !name.trim()}
              data-testid="group-save"
              onClick={() => void run(() => groups.change('PATCH', `/api/groups/${group.id}`, { name: name.trim(), description: description.trim(), icon, isPublic }))}
            >
              {busy ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          )}
        </div>
      </div>

      <section className="grid gap-3 border-t border-ink-700 pt-5">
        <h3 className="text-base font-extrabold">Sair ou encerrar</h3>
        {view.me.isOwner ? (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <label className={cx(fieldLabel, 'min-w-48 flex-1')}>
                Passar o grupo para outra pessoa
                <select className={selectClass} value={heir} onChange={(event) => setHeir(event.target.value)}>
                  <option value="">Escolher membro…</option>
                  {view.members
                    .filter((member) => member.userId !== view.me.userId)
                    .map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {memberName(member)} (@{member.username})
                      </option>
                    ))}
                </select>
              </label>
              <Button
                disabled={!heir || busy}
                onClick={() =>
                  void dialogs.confirm({
                    title: 'Passar o grupo?',
                    message: 'Você deixa de ser o dono e não dá para desfazer sozinho.',
                    confirmLabel: 'Passar o grupo',
                    tone: 'perigo',
                    action: () => groups.change('POST', `/api/groups/${group.id}/transfer`, { userId: heir }),
                  })
                }
              >
                Passar o grupo
              </Button>
            </div>
            <Button
              variant="danger"
              className="w-fit"
              disabled={busy}
              data-testid="group-delete"
              onClick={() =>
                void dialogs
                  .remove({
                    title: 'Excluir o grupo?',
                    item: group.name,
                    message: 'Canais, mensagens e cargos são apagados para todos. Não tem volta.',
                    irreversible: true,
                    action: () => groups.call('DELETE', `/api/groups/${group.id}`),
                  })
                  .then((done) => done && (void groups.refreshGroups(), gone()))
              }
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Excluir o grupo
            </Button>
          </>
        ) : (
          <Button
            variant="danger"
            className="w-fit"
            disabled={busy}
            data-testid="group-leave"
            onClick={() =>
              void dialogs
                .confirm({
                  title: `Sair de “${group.name}”?`,
                  message: 'Para voltar você vai precisar de um novo convite (ou de o grupo ser público).',
                  confirmLabel: 'Sair do grupo',
                  tone: 'perigo',
                  action: () => groups.call('POST', `/api/groups/${group.id}/leave`),
                })
                .then((done) => done && (void groups.refreshGroups(), gone()))
            }
          >
            Sair do grupo
          </Button>
        )}
      </section>
    </div>
  );
}

function Invites({ view }: { view: GroupView }) {
  const [invites, setInvites] = useState<any[] | null>(null);
  const [maxUses, setMaxUses] = useState('0');
  const [hours, setHours] = useState('168');
  const { busy, run } = useAction();
  const load = async () => setInvites((await groups.call('GET', `/api/groups/${view.group.id}/invites`)).invites);
  useEffect(() => {
    void run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.group.id]);

  return (
    <div className="grid gap-4" data-testid="invites-tab">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-600 bg-ink-800/50 p-3">
        <label className={cx(fieldLabel, 'min-w-36 flex-1')}>
          Validade
          <select className={selectClass} value={hours} onChange={(event) => setHours(event.target.value)}>
            <option value="1">1 hora</option>
            <option value="24">1 dia</option>
            <option value="168">7 dias</option>
            <option value="720">30 dias</option>
            <option value="0">Não vence</option>
          </select>
        </label>
        <label className={cx(fieldLabel, 'min-w-36 flex-1')}>
          Quantas pessoas
          <select className={selectClass} value={maxUses} onChange={(event) => setMaxUses(event.target.value)}>
            <option value="0">Sem limite</option>
            <option value="1">1 pessoa</option>
            <option value="5">5 pessoas</option>
            <option value="25">25 pessoas</option>
            <option value="100">100 pessoas</option>
          </select>
        </label>
        <Button
          variant="primary"
          disabled={busy}
          data-testid="invite-create"
          onClick={() =>
            void run(async () => {
              const { invite } = await groups.call('POST', `/api/groups/${view.group.id}/invites`, { maxUses: Number(maxUses), expiresInHours: Number(hours) });
              await load();
              groups.notify((await copyText(groupInviteLink(invite.code))) ? 'Convite criado e copiado.' : 'Convite criado. Copie o link na lista.');
            })
          }
        >
          Criar convite
        </Button>
      </div>
      <ul className="grid gap-2">
        {invites?.map((invite) => (
          <li key={invite.code} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-2" data-testid="invite-row">
            <input readOnly value={groupInviteLink(invite.code)} aria-label="Link do convite" className="min-w-40 flex-1 truncate bg-transparent text-sm text-fog-200 outline-none" data-testid="invite-link" onFocus={(event) => event.target.select()} />
            <span className="text-xs text-fog-500">
              {invite.uses}
              {invite.maxUses > 0 ? ` de ${invite.maxUses}` : ''} {invite.uses === 1 ? 'uso' : 'usos'} • {invite.expiresAt ? `vence em ${when(invite.expiresAt)}` : 'não vence'} • por {invite.createdByName}
            </span>
            <Button size="sm" onClick={() => void copyText(groupInviteLink(invite.code)).then((done) => groups.notify(done ? 'Link copiado.' : 'Não foi possível copiar; selecione o link.'))}>
              <Copy className="size-4" aria-hidden="true" />
              Copiar
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(async () => (await groups.call('DELETE', `/api/invites/${invite.code}`), await load()))}>
              Revogar
            </Button>
          </li>
        ))}
        {invites?.length === 0 && <li className="text-sm text-fog-400">Nenhum convite ativo.</li>}
      </ul>
    </div>
  );
}

function Bans({ view }: { view: GroupView }) {
  const [bans, setBans] = useState<any[] | null>(null);
  const { busy, run } = useAction();
  const load = async () => setBans((await groups.call('GET', `/api/groups/${view.group.id}/bans`)).bans);
  useEffect(() => {
    void run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.group.id]);
  return (
    <ul className="grid gap-2" data-testid="bans-tab">
      {bans?.map((ban) => (
        <li key={ban.userId} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-2" data-testid="ban-row">
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {ban.displayName} <span className="text-xs font-normal text-fog-500">@{ban.username}</span>
            </p>
            <p className="text-xs text-fog-400">
              {when(ban.createdAt)}
              {ban.reason && ` • ${ban.reason}`}
            </p>
          </div>
          <Button size="sm" disabled={busy} onClick={() => void run(async () => (await groups.call('DELETE', `/api/groups/${view.group.id}/bans/${ban.userId}`), await load()))}>
            Desbanir
          </Button>
        </li>
      ))}
      {bans?.length === 0 && <li className="text-sm text-fog-400">Ninguém está banido deste grupo.</li>}
    </ul>
  );
}

const ACTIONS: Record<string, string> = {
  'grupo.criado': 'criou o grupo',
  'grupo.atualizado': 'alterou o grupo',
  'grupo.dono_transferido': 'passou o grupo para',
  'cargo.criado': 'criou o cargo',
  'cargo.atualizado': 'alterou o cargo',
  'cargo.excluido': 'excluiu o cargo',
  'cargo.reordenado': 'reordenou os cargos',
  'membro.cargos': 'mudou os cargos de',
  'membro.expulso': 'expulsou',
  'membro.banido': 'baniu',
  'membro.desbanido': 'desbaniu',
  'membro.castigo': 'mudou o castigo de',
  'canal.criado': 'criou o canal',
  'canal.atualizado': 'alterou o canal',
  'canal.excluido': 'excluiu o canal',
  'canal.reordenado': 'reorganizou os canais',
  'canal.permissoes': 'mudou as permissões do canal',
  'emoji.criado': 'adicionou o emoji',
  'emoji.excluido': 'excluiu o emoji',
  'canal.acesso_concedido': 'liberou o acesso a um canal para',
  'convite.criado': 'criou o convite',
  'convite.revogado': 'revogou o convite',
  'mensagem.excluida': 'apagou uma mensagem em',
  'mensagem.fixada': 'fixou uma mensagem em',
  'mensagem.desafixada': 'desafixou uma mensagem em',
  'voz.silenciado': 'desligou o microfone de',
  'voz.fala_bloqueada': 'impediu de falar',
  'voz.fala_liberada': 'deixou falar de novo',
  'voz.transmissao_encerrada': 'encerrou a transmissão de',
  'voz.movido': 'moveu de canal',
  'voz.desconectado': 'tirou do canal de voz',
};

/** Detalhe legível: conjuntos de permissões viram a lista do que entrou e do que saiu. */
function detailLines(detail: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(detail)) {
    const pair = Array.isArray(value) && value.length === 2 ? value : null;
    if (pair && ['permissoes', 'permitir', 'negar'].includes(key) && pair.every((item) => typeof item === 'string' && /^\d+$/.test(item))) {
      const [before, after] = [BigInt(pair[0] as string), BigInt(pair[1] as string)];
      const added = describePermissions(after & ~before);
      const removed = describePermissions(before & ~after);
      const label = key === 'permissoes' ? 'permissões' : key;
      if (added.length > 0) lines.push(`${label} + ${added.join(', ')}`);
      if (removed.length > 0) lines.push(`${label} − ${removed.join(', ')}`);
    } else if (pair) {
      lines.push(`${key}: ${String(pair[0] ?? '—')} → ${String(pair[1] ?? '—')}`);
    } else if (Array.isArray(value)) {
      if (value.length > 0) lines.push(`${key}: ${value.join(', ')}`);
    } else if (value !== '' && value !== null && value !== false) {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines;
}

function Audit({ view }: { view: GroupView }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [done, setDone] = useState(false);
  const { busy, run } = useAction();
  const load = (before?: string) =>
    run(async () => {
      const result = await groups.call('GET', `/api/groups/${view.group.id}/audit${before ? `?before=${before}` : ''}`);
      setEntries((current) => (before ? [...current, ...result.entries] : result.entries));
      setDone(result.entries.length < 50);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.group.id]);

  return (
    <div className="grid gap-3" data-testid="audit-tab">
      <ol className="grid gap-1.5">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-2 text-sm" data-testid="audit-entry" data-action={entry.action}>
            <p>
              <b>{entry.actorName}</b> {ACTIONS[entry.action] ?? entry.action} {entry.targetName && <b>{entry.targetName}</b>}
              <span className="ml-2 text-xs text-fog-500">{when(entry.createdAt)}</span>
            </p>
            {detailLines(entry.detail).map((line) => (
              <p key={line} className="text-[13px] text-fog-400">
                {line}
              </p>
            ))}
          </li>
        ))}
      </ol>
      {entries.length === 0 && !busy && <p className="text-sm text-fog-400">Nada registrado ainda.</p>}
      {!done && entries.length > 0 && (
        <Button size="sm" variant="outline" className="w-fit" disabled={busy} onClick={() => void load(entries.at(-1).id)}>
          Carregar mais antigos
        </Button>
      )}
    </div>
  );
}

export function GroupSettings({ view, tab, onTab, onClose }: { view: GroupView; tab: SettingsTab; onTab: (tab: SettingsTab) => void; onClose: () => void }) {
  const tabs: [SettingsTab, string, boolean][] = [
    ['geral', 'Visão geral', true],
    ['cargos', 'Cargos', can(view, P.MANAGE_ROLES)],
    ['canais', 'Canais', can(view, P.MANAGE_CHANNELS)],
    ['membros', 'Membros', true],
    ['bots', 'Bots', can(view, P.INSTALL_BOTS) || can(view, P.CONFIGURE_BOTS) || can(view, P.VIEW_BOT_LOGS)],
    ['emojis', 'Emojis', can(view, P.MANAGE_EMOJIS)],
    ['convites', 'Convites', can(view, P.CREATE_INVITE)],
    ['banimentos', 'Banimentos', can(view, P.BAN_MEMBERS)],
    ['auditoria', 'Auditoria', can(view, P.VIEW_AUDIT_LOG)],
  ];
  const available = tabs.filter(([, , allowed]) => allowed);
  const current = available.some(([id]) => id === tab) ? tab : 'geral';

  return (
    <Modal title={`Configurações de ${view.group.name}`} onClose={onClose} wide>
      <div className="grid gap-5" data-testid="group-settings">
        <nav className="flex flex-wrap gap-1.5" aria-label="Seções das configurações">
          {available.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={current === id}
              data-testid={`settings-tab-${id}`}
              onClick={() => onTab(id)}
              className={cx(
                'h-9 rounded-lg border px-3 text-sm font-bold transition-[background,border-color] duration-150',
                current === id ? 'border-brand-300 bg-brand-500/25 text-white' : 'border-ink-600 bg-ink-800 text-fog-300 hover:border-ink-500',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
        {current === 'geral' && <Overview view={view} onClose={onClose} />}
        {current === 'cargos' && <RolesTab view={view} />}
        {current === 'canais' && <ChannelsTab view={view} />}
        {current === 'membros' && <MembersTab view={view} />}
        {current === 'bots' && <BotsTab view={view} />}
        {current === 'emojis' && <EmojisTab view={view} />}
        {current === 'convites' && <Invites view={view} />}
        {current === 'banimentos' && <Bans view={view} />}
        {current === 'auditoria' && <Audit view={view} />}
        {!can(view, P.MANAGE_GROUP) && current === 'geral' && <Notice>Você pode ver estas informações; para alterá-las é preciso a permissão “Gerenciar grupo”.</Notice>}
      </div>
    </Modal>
  );
}
