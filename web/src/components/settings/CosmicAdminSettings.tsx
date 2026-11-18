import { Crown, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../lib/api.ts';
import { dialogs } from '../../lib/dialogs.ts';
import { groups } from '../../lib/groups/client.ts';
import { closeSettings } from '../../lib/settings-screen.ts';
import { errorText, selectClass } from '../groups/common.tsx';
import { Button, cx, TextInput } from '../ui.tsx';

const sections = [
  ['overview', 'Visão geral'], ['users', 'Usuários'], ['servers', 'Servidores'],
  ['permissions', 'Cargos globais'], ['codes', 'Códigos promocionais'], ['points', 'Cosmic Points'],
  ['shop', 'Loja e decorações'], ['gifts', 'Presentes e transações'], ['audit', 'Logs de auditoria'], ['settings', 'Configurações globais'],
] as const;
type Section = typeof sections[number][0];
type Row = Record<string, unknown>;
type Mfa = { enrolled: boolean; verified: boolean; primary: boolean };
const labels: Record<string, string> = {
  id: 'ID', user_id: 'ID da conta', username: 'Usuário', display_name: 'Nome', points: 'Pontos', created_at: 'Data',
  name: 'Nome', owner_id: 'ID do dono', is_public: 'Público', members: 'Membros', role: 'Permissão',
  unlimited_cosmetics: 'Compras ilimitadas', is_primary: 'Principal', mfa_enabled: 'MFA', code: 'Código',
  uses: 'Resgates', maxUses: 'Limite total', perUser: 'Por conta', expiresAt: 'Validade', active: 'Ativo', revokedAt: 'Revogado em',
  rewardKind: 'Recompensa', itemId: 'Item', delta: 'Quantidade', reason: 'Motivo', detail: 'Detalhes', price: 'Preço',
  transferable: 'Transferível', sender: 'Remetente', recipient: 'Destinatário', item_id: 'Item', kind: 'Tipo',
  action: 'Ação', target_id: 'Alvo', key: 'Configuração', value: 'Ativo', updated_at: 'Atualizado em',
  reward: 'Recompensa', actor_id: 'ID do administrador', cosmic_admin: 'Cosmic Admin',
  promotions_enabled: 'Resgates habilitados', gifts_enabled: 'Presentes habilitados',
};
const columns: Record<Exclude<Section, 'overview'>, string[]> = {
  users: ['id', 'username', 'display_name', 'points', 'cosmic_admin'],
  servers: ['id', 'name', 'owner_id', 'members', 'is_public'],
  permissions: ['user_id', 'username', 'role', 'is_primary', 'unlimited_cosmetics', 'mfa_enabled'],
  codes: ['code', 'rewardKind', 'points', 'itemId', 'uses', 'maxUses', 'perUser', 'expiresAt', 'active', 'revokedAt'],
  points: ['username', 'user_id', 'delta', 'reason', 'detail', 'created_at'],
  shop: ['id', 'name', 'price', 'active', 'transferable'],
  gifts: ['sender', 'recipient', 'item_id', 'kind', 'price', 'created_at'],
  audit: ['username', 'action', 'target_id', 'reason', 'detail', 'created_at'],
  settings: ['key', 'value', 'updated_at'],
};
function display(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) return new Date(value).toLocaleString('pt-BR');
  return labels[String(value)] ?? String(value);
}
function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="grid gap-3 rounded-2xl border border-brand-500/20 bg-ink-900/80 p-4"><h2 className="font-extrabold text-neon-300">{title}</h2>{children}</section>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-bold text-fog-300">{label}{children}</label>;
}
function AdminForm({ title, children, onSubmit }: { title: string; children: ReactNode; onSubmit: (data: FormData) => void }) {
  return <Block title={title}><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
    {children}
    <Field label="Motivo da operação"><TextInput name="reason" minLength={5} maxLength={300} required placeholder="Descreva a autorização ou necessidade" /></Field>
    <div className="flex items-end"><Button type="submit" variant="primary">Revisar operação</Button></div>
  </form></Block>;
}

export function CosmicAdminSettings() {
  const [status, setStatus] = useState<Mfa | null>(null);
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [tab, setTab] = useState<Section>('overview');
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Row>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [redemptions, setRedemptions] = useState<{ id: string; code: string; rows: Row[]; page: number } | null>(null);
  const [editItem, setEditItem] = useState<Row | null>(null);
  const [rewardKind, setRewardKind] = useState('points');
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    groups.call<Mfa>('GET', '/api/admin/mfa').then((value) => { if (!cancelled) setStatus(value); }).catch((err) => { if (!cancelled) setError(errorText(err)); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!status?.verified) return;
    let cancelled = false;
    setLoading(true); setError(''); setRows([]);
    groups.call<{ rows?: Row[]; summary?: Row }>('GET', `/api/admin/${tab}?q=${encodeURIComponent(search)}&page=${page}`).then((data) => {
      if (!cancelled) { setRows(data.rows ?? []); setSummary(data.summary ?? {}); }
    }).catch((err) => {
      if (!cancelled) {
        setError(errorText(err));
        if (err instanceof ApiError && err.code === 'mfa_necessario') setStatus((previous) => previous && { ...previous, verified: false });
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status?.verified, tab, search, page, revision]);

  const mfaAction = async (event: FormEvent<HTMLFormElement>, path: string) => {
    event.preventDefault(); const form = event.currentTarget, input = Object.fromEntries(new FormData(form));
    setBusy(true); setError('');
    try {
      if (path === 'enroll') setEnrollment(await groups.call('POST', '/api/admin/mfa/enroll', input));
      else if (path === 'recover') {
        await groups.call('POST', '/api/admin/mfa/recover', input);
        await groups.logout(); closeSettings();
      } else {
        const result = await groups.call<{ recoveryCodes: string[] }>('POST', '/api/admin/mfa/verify', input);
        setRecoveryCodes(result.recoveryCodes); setEnrollment(null);
        setStatus((previous) => ({ enrolled: true, verified: true, primary: previous?.primary ?? false }));
        await groups.refreshAccount();
        await groups.refreshGroups();
      }
      form.reset();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  const perform = async (method: string, path: string, input: Row, description: string) => {
    const accepted = await dialogs.confirm({ title: 'Confirmar operação global', message: <div className="grid gap-2"><p>{description}</p><p className="text-fog-400">Motivo: {String(input.reason)}</p><p className="text-xs text-neon-300">A operação será registrada na auditoria.</p></div>, confirmLabel: 'Confirmar operação', tone: method === 'DELETE' ? 'perigo' : 'normal', action: async () => {
      await groups.call(method, path, { ...input, confirm: true });
    } });
    if (accepted) { refresh(); setEditItem(null); setError(''); }
  };
  const action = async (method: string, path: string, input: Row, description: string) => {
    const reason = await dialogs.prompt({ title: description, label: 'Motivo da operação', required: true, maxLength: 300, validate: (value) => value.length < 5 ? 'Use pelo menos 5 caracteres.' : null });
    if (reason) await perform(method, path, { ...input, reason }, description);
  };
  const join = async (row: Row) => {
    const reason = await dialogs.prompt({ title: `Acessar ${String(row.name)}`, message: 'Sua entrada será visível como acesso oficial e registrada na auditoria do servidor e da plataforma.', label: 'Motivo do acesso', required: true, validate: (value) => value.length < 5 ? 'Use pelo menos 5 caracteres.' : null });
    if (!reason) return;
    const accepted = await dialogs.confirm({ title: 'Entrar com acesso global?', message: `${String(row.name)} · ${String(row.id)}. Motivo: ${reason}`, confirmLabel: 'Entrar como Cosmic Admin', action: () => groups.call('POST', `/api/admin/servers/${String(row.id)}/join`, { confirm: true, reason }) });
    if (accepted) {
      await groups.refreshGroups(); closeSettings(); window.location.hash = `#/grupos/${String(row.id)}`;
    }
  };
  const showRedemptions = async (row: Row, requestedPage = 0) => {
    try { const data = await groups.call<{ rows: Row[] }>('GET', `/api/admin/codes/${String(row.id)}/redemptions?page=${requestedPage}`); setRedemptions({ id: String(row.id), code: String(row.code), rows: data.rows, page: requestedPage }); }
    catch (err) { setError(errorText(err)); }
  };
  return <>
    <div className="flex items-center gap-3 rounded-2xl border border-neon-400/20 bg-linear-to-r from-brand-900/40 to-ink-950 p-4">
      <Crown className="size-8 shrink-0 text-neon-300" /><div><p className="font-extrabold">Cosmic Admin {status?.primary && '· conta principal'}</p><p className="text-sm text-fog-400">Administração oficial da plataforma. Todas as ações administrativas são auditadas.</p></div>
    </div>
    {error && <p role="alert" className="rounded-xl bg-live-500/10 p-3 text-sm text-live-300">{error}</p>}
    {!status && !error && <p className="text-fog-400">Verificando acesso…</p>}
    {status && !status.verified && <Block title="Verificação multifator">
      <p className="text-sm text-fog-400">Use um aplicativo autenticador. A confirmação autoriza operações globais nesta sessão por 10 minutos.</p>
      {!status.enrolled && !enrollment && <form className="grid gap-3" onSubmit={(e) => void mfaAction(e, 'enroll')}>
        <Field label="Senha atual"><TextInput name="password" type="password" required autoComplete="current-password" maxLength={128} /></Field>
        <Button type="submit" variant="primary" disabled={busy}>Configurar autenticador</Button>
      </form>}
      {enrollment && <><p className="text-sm">Adicione uma conta TOTP ao autenticador com esta chave:</p><code className="break-all rounded-xl bg-ink-950 p-3 text-neon-300">{enrollment.secret}</code><a className="text-sm text-neon-300 underline" href={enrollment.uri}>Abrir no autenticador</a></>}
      {(status.enrolled || enrollment) && <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void mfaAction(e, 'verify')}>
        <Field label="Código de 6 dígitos"><TextInput name="code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="one-time-code" required /></Field>
        <Button type="submit" variant="primary" disabled={busy}><ShieldCheck className="size-4" />Verificar acesso</Button>
      </form>}
      {status.enrolled && <details className="text-sm"><summary className="cursor-pointer text-fog-300">Perdi o autenticador</summary><form className="mt-3 grid gap-3" onSubmit={(e) => void mfaAction(e, 'recover')}>
        <p className="text-fog-400">Informe sua senha e um código de recuperação. Todas as sessões serão encerradas; entre novamente para cadastrar o novo autenticador.</p>
        <Field label="Senha atual"><TextInput name="password" type="password" required autoComplete="current-password" /></Field>
        <Field label="Código de recuperação"><TextInput name="recoveryCode" required autoComplete="off" /></Field>
        <Button type="submit" disabled={busy}>Recuperar acesso</Button>
      </form></details>}
    </Block>}
    {recoveryCodes.length > 0 && <Block title="Guarde seus códigos de recuperação">
      <p className="text-sm text-fog-400">Exibidos uma única vez. Guarde em um local seguro separado da senha. Cada código recupera o acesso ao autenticador.</p>
      <textarea readOnly aria-label="Códigos de recuperação" className="h-64 rounded-xl bg-ink-950 p-3 font-mono text-sm text-neon-300" value={recoveryCodes.join('\n')} />
      <Button onClick={() => setRecoveryCodes([])}>Já guardei os códigos</Button>
    </Block>}
    {status?.verified && <>
      <nav aria-label="Seções da Administração Cosmic" className="flex flex-wrap gap-2">{sections.map(([id, title]) => <Button key={id} size="sm" variant={tab === id ? 'primary' : 'quiet'} onClick={() => { setTab(id); setPage(0); setSearch(''); setQuery(''); setRedemptions(null); setEditItem(null); }}>{title}</Button>)}</nav>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(query); setPage(0); }}>
        <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar por nome ou ID" aria-label="Pesquisar administração" />
        <Button type="submit" aria-label="Pesquisar"><Search className="size-4" /></Button><Button onClick={refresh} aria-label="Atualizar"><RefreshCw className="size-4" /></Button>
      </form>
      {tab === 'overview' && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Object.entries(summary).map(([key, value]) => <div key={key} className="rounded-2xl border border-brand-500/20 bg-ink-900 p-4"><p className="text-2xl font-extrabold text-neon-300">{Number(value).toLocaleString('pt-BR')}</p><p className="text-sm text-fog-400">{{ users: 'Usuários', servers: 'Servidores', admins: 'Cosmic Admins', points: 'Pontos em circulação', redemptions: 'Resgates', gifts: 'Presentes' }[key] ?? key}</p></div>)}</div>}
      {tab === 'codes' && <AdminForm title="Criar código promocional" onSubmit={(data) => void perform('POST', '/api/admin/codes', { code: data.get('code'), rewardKind: data.get('rewardKind'), points: Number(data.get('points')), itemId: data.get('itemId'), expiresAt: data.get('expiresAt') ? new Date(String(data.get('expiresAt'))).toISOString() : null, maxUses: data.get('maxUses') ? Number(data.get('maxUses')) : null, perUser: Number(data.get('perUser')), reason: data.get('reason') }, `Criar ${String(data.get('code'))}: ${rewardKind === 'points' ? `${String(data.get('points'))} Cosmic Points` : String(data.get('itemId'))}; ${String(data.get('perUser'))} resgate(s) por conta, limite total ${String(data.get('maxUses') || 'ilimitado')}, validade ${String(data.get('expiresAt') || 'sem prazo')}.`)}>
        <Field label="Código personalizado"><TextInput name="code" placeholder="Update3.1" pattern="[A-Za-z0-9_.\-]{3,64}" required /></Field>
        <Field label="Tipo de recompensa"><select name="rewardKind" value={rewardKind} onChange={(e) => setRewardKind(e.target.value)} className={selectClass}><option value="points">Cosmic Points</option><option value="cosmetic">Item cosmético</option></select></Field>
        {rewardKind === 'points' ? <Field label="Quantidade de pontos"><TextInput name="points" type="number" min={1} max={1000000} required defaultValue={500} /></Field> : <Field label="ID do item cosmético"><TextInput name="itemId" required placeholder="anel-aurora" /></Field>}
        <Field label="Validade (horário local, opcional)"><TextInput name="expiresAt" type="datetime-local" /></Field>
        <Field label="Total de resgates (opcional)"><TextInput name="maxUses" type="number" min={1} max={10000000} /></Field>
        <Field label="Resgates por usuário"><TextInput name="perUser" type="number" min={1} max={100} defaultValue={1} required /></Field>
      </AdminForm>}
      {tab === 'points' && <AdminForm title="Conceder ou remover Cosmic Points" onSubmit={(data) => void perform('POST', '/api/admin/points', { userId: data.get('userId'), delta: Number(data.get('delta')), reason: data.get('reason'), requestId: crypto.randomUUID() }, `Alterar ${String(data.get('delta'))} Cosmic Points na conta ${String(data.get('userId'))}.`)}>
        <Field label="ID interno da conta"><TextInput name="userId" required /></Field><Field label="Quantidade (negativa para remover)"><TextInput name="delta" type="number" min={-1000000} max={1000000} required /></Field>
      </AdminForm>}
      {tab === 'permissions' && <AdminForm title="Conceder permissão global" onSubmit={(data) => void perform('PUT', `/api/admin/permissions/${String(data.get('userId'))}`, { active: true, unlimited: data.get('unlimited') === 'on', reason: data.get('reason') }, `Promover a conta ${String(data.get('userId'))} a Cosmic Admin. As sessões dessa conta serão encerradas e ela deverá configurar MFA.`)}>
        <Field label="ID interno da conta"><TextInput name="userId" required /></Field><label className="flex items-center gap-2 text-sm"><input name="unlimited" type="checkbox" defaultChecked />Permitir aquisições cosméticas sem débito</label>
      </AdminForm>}
      {tab === 'shop' && editItem && <AdminForm key={String(editItem.id)} title={`Editar ${String(editItem.name)}`} onSubmit={(data) => void perform('PATCH', `/api/admin/shop/${String(editItem.id)}`, { price: Number(data.get('price')), active: data.get('active') === 'on', transferable: data.get('transferable') === 'on', reason: data.get('reason') }, `${String(editItem.name)}: preço ${String(data.get('price'))}, disponível ${data.get('active') === 'on' ? 'sim' : 'não'}, transferível ${data.get('transferable') === 'on' ? 'sim' : 'não'}.`)}>
        <Field label="Preço"><TextInput name="price" type="number" min={0} max={1000000} required defaultValue={Number(editItem.price)} /></Field><div className="grid gap-2"><label className="flex gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={editItem.active === true} />Disponível na loja</label><label className="flex gap-2 text-sm"><input name="transferable" type="checkbox" defaultChecked={editItem.transferable === true} />Permitir transferência</label></div>
      </AdminForm>}
      {tab === 'codes' && <p className="text-xs text-fog-400">Revogar remove o código de circulação e preserva o histórico dos resgates.</p>}
      {loading && <p className="text-sm text-fog-400" role="status">Carregando registros…</p>}
      {tab !== 'overview' && !loading && <div className="overflow-x-auto rounded-xl border border-white/5"><table className="w-full text-left text-xs"><caption className="sr-only">{sections.find(([id]) => id === tab)?.[1]}</caption><thead className="bg-ink-900"><tr>{columns[tab].map((key) => <th key={key} className="px-3 py-3 whitespace-nowrap">{labels[key] ?? key}</th>)}{['servers', 'permissions', 'codes', 'shop', 'settings'].includes(tab) && <th className="px-3">Ações</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.user_id ?? row.key ?? index)} className="border-t border-white/5 text-fog-300">{columns[tab].map((key) => <td key={key} className={cx('max-w-64 px-3 py-3', ['id', 'user_id', 'owner_id'].includes(key) && 'font-mono select-all')}><span className="block max-h-32 overflow-auto break-words">{display(row[key])}</span></td>)}
        {tab === 'servers' && <td><Button size="sm" onClick={() => void join(row)}>Entrar como Admin</Button></td>}
        {tab === 'permissions' && <td>{!row.is_primary && <Button size="sm" variant="danger" onClick={() => void action('PUT', `/api/admin/permissions/${String(row.user_id)}`, { active: false }, `Revogar Cosmic Admin de ${String(row.username)}?`)}>Revogar</Button>}</td>}
        {tab === 'codes' && <td className="min-w-48 space-x-2"><Button size="sm" onClick={() => void showRedemptions(row)}>Ver resgates</Button>{!row.revokedAt && <><Button size="sm" onClick={() => void action('PATCH', `/api/admin/codes/${String(row.id)}`, { active: !row.active }, `${row.active ? 'Desativar' : 'Ativar'} ${String(row.code)}?`)}>{row.active ? 'Desativar' : 'Ativar'}</Button><Button size="sm" variant="danger" onClick={() => void action('DELETE', `/api/admin/codes/${String(row.id)}`, {}, `Revogar ${String(row.code)} permanentemente?`)}>Revogar</Button></>}</td>}
        {tab === 'shop' && <td><Button size="sm" onClick={() => setEditItem(row)}>Editar item</Button></td>}
        {tab === 'settings' && <td><Button size="sm" onClick={() => void action('PATCH', '/api/admin/settings', { key: row.key, value: !row.value }, `${row.value ? 'Pausar' : 'Habilitar'} ${display(row.key)}?`)}>{row.value ? 'Pausar' : 'Habilitar'}</Button></td>}
      </tr>)}</tbody></table>{rows.length === 0 && <p className="p-4 text-sm text-fog-400">Nenhum registro encontrado.</p>}</div>}
      {tab !== 'overview' && <div className="flex items-center justify-between gap-3 text-xs text-fog-400"><Button size="sm" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Anterior</Button><span>Página {page + 1} · até {100} registros</span><Button size="sm" disabled={rows.length < 100 || ['permissions', 'shop', 'settings'].includes(tab)} onClick={() => setPage((n) => n + 1)}>Próxima</Button></div>}
      {redemptions && <Block title={`Contas que resgataram ${redemptions.code}`}><ul className="grid gap-2 text-sm">{redemptions.rows.map((row) => <li key={String(row.id)} className="rounded-xl bg-ink-950 p-3"><p className="font-bold">{String(row.username)} <span className="font-mono text-xs text-fog-500">{String(row.user_id)}</span></p><p className="text-xs text-fog-400">{display(row.reward)} · {display(row.created_at)}</p></li>)}</ul><div className="flex justify-between gap-2"><Button size="sm" disabled={redemptions.page === 0} onClick={() => void showRedemptions({ id: redemptions.id, code: redemptions.code }, redemptions.page - 1)}>Anterior</Button><span>{redemptions.page + 1}</span><Button size="sm" disabled={redemptions.rows.length < 100} onClick={() => void showRedemptions({ id: redemptions.id, code: redemptions.code }, redemptions.page + 1)}>Mais resgates</Button></div>{!redemptions.rows.length && <p className="text-sm text-fog-400">Ainda sem resgates.</p>}</Block>}
    </>}
  </>;
}
