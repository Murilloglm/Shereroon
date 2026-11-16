import { Bot, ChevronDown, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { P } from '../../../../../shared/permissions.ts';
import { groups, type GroupView } from '../../../lib/groups/client.ts';
import { Button, Card, cx, Notice, TextInput, Toggle } from '../../ui.tsx';
import { can, fieldLabel, selectClass, useAction } from '../common.tsx';

type FieldType = 'toggle' | 'text' | 'longtext' | 'number' | 'list' | 'select' | 'channel' | 'channels' | 'role' | 'roles' | 'members';

interface Field {
  key: string;
  type: FieldType;
  label: string;
  about?: string;
  section?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  placeholder?: string;
  channelKind?: 'texto' | 'voz' | 'categoria';
}

interface CatalogBot {
  id: string;
  name: string;
  about: string;
  category: string;
  icon: string;
  features: string[];
  fields: Field[];
  commands: { name: string; usage: string; about: string }[];
}

interface Installed {
  botId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  displayName: string | null;
  prefix: string;
  status: { state: 'ativo' | 'aviso' | 'erro' | 'desativado'; text: string };
}

const STATUS_COLOR: Record<Installed['status']['state'], string> = { ativo: 'bg-ok-400', aviso: 'bg-warn-400', erro: 'bg-live-400', desativado: 'bg-fog-500' };

/** Escolha de vários itens (canais, cargos, membros) como botões de liga e desliga. */
function Many({ options, value, onChange, disabled }: { options: { id: string; label: string }[]; value: string[]; onChange: (next: string[]) => void; disabled: boolean }) {
  if (options.length === 0) return <p className="text-sm text-fog-500">Nada para escolher ainda.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = value.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((id) => id !== option.id) : [...value, option.id])}
            className={cx('h-8 rounded-lg border px-2.5 text-sm font-semibold disabled:opacity-50', on ? 'border-brand-300 bg-brand-500/25 text-white' : 'border-ink-600 bg-ink-800 text-fog-300 hover:border-ink-500')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function FieldInput({ field, value, onChange, view, disabled }: { field: Field; value: unknown; onChange: (value: unknown) => void; view: GroupView; disabled: boolean }) {
  const channels = view.channels.filter((channel) => channel.kind === (field.channelKind ?? 'texto')).map((channel) => ({ id: channel.id, label: channel.kind === 'texto' ? `#${channel.name}` : channel.name }));
  const roles = view.roles.filter((role) => !role.isEveryone).map((role) => ({ id: role.id, label: role.name }));
  const list = Array.isArray(value) ? value.map(String) : [];
  switch (field.type) {
    case 'toggle':
      return <Toggle on={value === true} label={field.label} disabled={disabled} onChange={onChange} />;
    case 'number':
      return <TextInput type="number" min={field.min} max={field.max} disabled={disabled} value={typeof value === 'number' ? value : ''} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} />;
    case 'longtext':
      return (
        <textarea
          rows={3}
          disabled={disabled}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className="w-full resize-y rounded-xl border border-ink-600 bg-ink-900/70 px-3 py-2 text-sm text-fog-100 focus:border-brand-400 focus:outline-none disabled:opacity-50"
        />
      );
    case 'list':
      return <TextInput disabled={disabled} placeholder={field.placeholder ? `${field.placeholder}, …` : 'separe com vírgulas'} value={list.join(', ')} onChange={(event) => onChange(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} />;
    case 'select':
    case 'channel':
    case 'role': {
      const options = field.type === 'select' ? (field.options ?? []).map((option) => ({ id: option.value, label: option.label })) : field.type === 'channel' ? channels : roles;
      return (
        <select className={selectClass} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || null)}>
          {field.type !== 'select' && <option value="">Nenhum</option>}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    case 'channels':
      return <Many options={channels} value={list} onChange={onChange} disabled={disabled} />;
    case 'roles':
      return <Many options={roles} value={list} onChange={onChange} disabled={disabled} />;
    case 'members':
      return <Many options={view.members.map((member) => ({ id: member.userId, label: member.nickname || member.displayName }))} value={list} onChange={onChange} disabled={disabled} />;
    default:
      return <TextInput disabled={disabled} placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />;
  }
}

function InstalledBot({ view, bot, install, onChanged }: { view: GroupView; bot: CatalogBot; install: Installed; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(install.config);
  const [prefix, setPrefix] = useState(install.prefix);
  const { busy, run } = useAction();
  const configure = can(view, P.CONFIGURE_BOTS);
  const path = `/api/groups/${view.group.id}/bots/${bot.id}`;
  const change = (body: Record<string, unknown>) => run(async () => (await groups.change('PATCH', path, body), onChanged()));
  const sections = [...new Set(bot.fields.map((field) => field.section ?? 'Opções'))];

  return (
    <Card className="p-3" data-testid="installed-bot" data-bot={bot.id}>
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/20 text-2xl">{bot.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold">{install.displayName ?? bot.name}</p>
          <p className="flex items-center gap-1.5 text-[13px] leading-snug text-fog-400" data-testid="bot-status" data-state={install.status.state}>
            <span className={cx('size-2 shrink-0 rounded-full', STATUS_COLOR[install.status.state])} />
            <span className="line-clamp-2">{install.status.text}</span>
          </p>
        </div>
        <Toggle on={install.enabled} label={`${bot.name} ligado`} disabled={!configure || busy} onChange={(enabled) => void change({ enabled })} />
        <Button size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} data-testid="bot-configure">
          Configurar <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </Button>
      </div>
      {open && (
        <div className="mt-3 grid gap-4 border-t border-ink-700 pt-3">
          {!configure && <Notice>Para mudar estas opções é preciso a permissão “Configurar bots”.</Notice>}
          {sections.map((section) => (
            <section key={section} className="grid gap-3">
              <h4 className="text-xs font-extrabold tracking-wide text-fog-500 uppercase">{section}</h4>
              {bot.fields
                .filter((field) => (field.section ?? 'Opções') === section)
                .map((field) =>
                  field.type === 'toggle' ? (
                    <div key={field.key} className="flex items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{field.label}</p>
                        {field.about && <p className="text-[13px] leading-snug text-fog-400">{field.about}</p>}
                      </div>
                      <FieldInput field={field} value={config[field.key]} view={view} disabled={!configure} onChange={(value) => setConfig({ ...config, [field.key]: value })} />
                    </div>
                  ) : (
                    <div key={field.key} className={fieldLabel}>
                      <span>{field.label}</span>
                      <FieldInput field={field} value={config[field.key]} view={view} disabled={!configure} onChange={(value) => setConfig({ ...config, [field.key]: value })} />
                      {field.about && <span className="text-[13px] leading-snug font-normal text-fog-400">{field.about}</span>}
                    </div>
                  ),
                )}
            </section>
          ))}
          {bot.commands.length > 0 && (
            <section className="grid gap-2">
              <h4 className="text-xs font-extrabold tracking-wide text-fog-500 uppercase">Comandos</h4>
              <label className={cx(fieldLabel, 'max-w-40')}>
                Prefixo
                <TextInput value={prefix} maxLength={3} disabled={!configure} onChange={(event) => setPrefix(event.target.value)} />
              </label>
              <ul className="grid gap-1 text-sm">
                {bot.commands.map((command) => (
                  <li key={command.name} className="flex flex-wrap gap-x-2">
                    <code className="font-bold text-neon-300">
                      {prefix}
                      {command.usage}
                    </code>
                    <span className="text-fog-400">{command.about}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="flex flex-wrap gap-2">
            {configure && (
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void change({ config, ...(prefix !== install.prefix ? { prefix } : {}) }).then((done) => done && groups.notify('Configuração do bot salva.'))} data-testid="bot-save">
                Salvar
              </Button>
            )}
            {can(view, P.INSTALL_BOTS) && (
              <Button
                variant="bare"
                size="sm"
                className="text-live-300"
                disabled={busy}
                onClick={() => window.confirm(`Remover o bot ${bot.name} do grupo? As configurações e os dados dele neste grupo são apagados.`) && void run(async () => (await groups.change('DELETE', path), onChanged()))}
                data-testid="bot-remove"
              >
                <Trash2 className="size-4" aria-hidden="true" /> Remover do grupo
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/** Central de Bots: o que está instalado no grupo e a biblioteca de bots oficiais. As permissões são conferidas no servidor. */
export function BotsTab({ view }: { view: GroupView }) {
  const [catalog, setCatalog] = useState<CatalogBot[] | null>(null);
  const [installed, setInstalled] = useState<Installed[]>([]);
  const { busy, run } = useAction();
  const load = useCallback(async () => {
    const [library, mine] = await Promise.all([groups.call<{ bots: CatalogBot[] }>('GET', '/api/bots'), groups.call<{ installed: Installed[] }>('GET', `/api/groups/${view.group.id}/bots`)]);
    setCatalog(library.bots);
    setInstalled(mine.installed);
  }, [view.group.id]);
  useEffect(() => void run(load), [load, run]);

  if (!catalog) return <p className="py-6 text-center text-fog-400">Carregando os bots…</p>;
  const available = catalog.filter((bot) => !installed.some((item) => item.botId === bot.id));
  return (
    <div className="grid gap-5" data-testid="bots-tab">
      <section className="grid gap-2">
        <h3 className="font-extrabold">Instalados neste grupo</h3>
        {installed.length === 0 && <p className="text-sm text-fog-400">Nenhum bot instalado. Os bots rodam no servidor: continuam funcionando com todo mundo offline.</p>}
        {installed.map((install) => {
          const bot = catalog.find((item) => item.id === install.botId);
          return bot ? <InstalledBot key={`${install.botId}:${JSON.stringify(install.config)}:${install.prefix}`} view={view} bot={bot} install={install} onChanged={load} /> : null;
        })}
      </section>
      {available.length > 0 && (
        <section className="grid gap-2">
          <h3 className="font-extrabold">Biblioteca</h3>
          {!can(view, P.INSTALL_BOTS) && <Notice>Para instalar bots é preciso a permissão “Instalar bots”.</Notice>}
          <ul className="grid gap-2 sm:grid-cols-2">
            {available.map((bot) => (
              <li key={bot.id}>
                <Card className="flex h-full flex-col gap-2 p-3" data-testid="library-bot" data-bot={bot.id}>
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/20 text-2xl">{bot.icon || <Bot className="size-6" />}</span>
                    <div className="min-w-0">
                      <p className="truncate font-extrabold">{bot.name}</p>
                      <p className="text-xs font-bold text-brand-300">{bot.category}</p>
                    </div>
                  </div>
                  <p className="flex-1 text-sm leading-snug text-fog-300">{bot.about}</p>
                  <Button variant="primary" size="sm" disabled={busy || !can(view, P.INSTALL_BOTS)} onClick={() => void run(async () => (await groups.change('POST', `/api/groups/${view.group.id}/bots`, { botId: bot.id }), load()))} data-testid="bot-install">
                    Instalar
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
