import { Accessibility, Bell, Check, Download, LogOut, Mic, Palette, Power, Search, ShieldCheck, UserPen, UserRound, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { appearance, setAppearance, type MotionChoice } from '../../lib/appearance.ts';
import { desktop } from '../../lib/desktop.ts';
import { dialogs } from '../../lib/dialogs.ts';
import { alertPrefs, allowDesktopAlerts, desktopAlertsSupported } from '../../lib/groups/alerts.ts';
import { groups, type Account } from '../../lib/groups/client.ts';
import { closeSettings, openSettings, settingsScreen, type SettingsSection } from '../../lib/settings-screen.ts';
import { THEME_IDS, THEMES } from '../../lib/themes.ts';
import { social, type Profile } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { AutostartSettings } from '../AutostartSettings.tsx';
import { errorText, fieldLabel, selectClass, useAction } from '../groups/common.tsx';
import { CallSettings } from '../room/CallSettings.tsx';
import { ProfileEditor } from '../social/ProfileEditor.tsx';
import { UpdateSettings } from '../UpdateSettings.tsx';
import { Avatar, Button, cx, Notice, TextInput, Toggle } from '../ui.tsx';

interface SectionDef {
  id: SettingsSection;
  group: string;
  title: string;
  /** Palavras que a pesquisa também encontra. */
  keywords: string;
  icon: typeof UserRound;
  needsAccount?: boolean;
  available?: () => boolean;
  render: (account: Account | null) => ReactNode;
}

const GROUPS = ['Conta', 'Experiência', 'Voz e vídeo', 'Aplicativo'];

const SECTIONS: SectionDef[] = [
  { id: 'conta', group: 'Conta', title: 'Minha conta', keywords: 'usuário senha trocar sair', icon: UserRound, needsAccount: true, render: (account) => account && <MyAccount account={account} /> },
  { id: 'perfil', group: 'Conta', title: 'Editar perfil', keywords: 'foto avatar banner bio status nome imagem', icon: UserPen, needsAccount: true, render: (account) => account && <ProfileEditor userId={account.id} /> },
  { id: 'privacidade', group: 'Conta', title: 'Privacidade e segurança', keywords: 'quem pode ver perfil mensagem privada', icon: ShieldCheck, needsAccount: true, render: (account) => account && <PrivacySettings account={account} /> },
  { id: 'amigos', group: 'Conta', title: 'Amigos e bloqueios', keywords: 'amizade bloquear desbloquear pedidos', icon: Users, needsAccount: true, render: () => <FriendsSettings /> },
  { id: 'aparencia', group: 'Experiência', title: 'Aparência e temas', keywords: 'tema claro escuro cores cosmic night visual', icon: Palette, render: () => <AppearanceSettings /> },
  { id: 'notificacoes', group: 'Experiência', title: 'Notificações', keywords: 'som aviso alerta mensagem', icon: Bell, render: () => <NotificationSettings /> },
  { id: 'acessibilidade', group: 'Experiência', title: 'Acessibilidade', keywords: 'animações movimento reduzir gif', icon: Accessibility, render: () => <AccessibilitySettings /> },
  { id: 'voz', group: 'Voz e vídeo', title: 'Voz, vídeo e transmissão', keywords: 'microfone saída fone áudio ruído eco codec qualidade volume transmissão tela', icon: Mic, render: () => <VoiceSettings /> },
  { id: 'inicializacao', group: 'Aplicativo', title: 'Inicialização com o Windows', keywords: 'iniciar bandeja minimizado windows', icon: Power, available: () => Boolean(desktop?.autostart), render: () => <AutostartSettings /> },
  { id: 'atualizacoes', group: 'Aplicativo', title: 'Atualizações', keywords: 'versão baixar instalar atualizar', icon: Download, available: () => Boolean(desktop), render: () => <UpdateSettings /> },
];

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Configurações em tela própria: ocupa a janela, com as categorias numa barra lateral, pesquisa e o painel da
 * categoria no centro. Fecha pelo X ou pelo Esc e volta para onde a pessoa estava (a chamada continua por baixo).
 */
export function SettingsScreen() {
  const open = useStore(settingsScreen, (state) => state.open);
  const section = useStore(settingsScreen, (state) => state.section);
  const account = useStore(groups.store, (state) => state.account);
  const [query, setQuery] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  const available = useMemo(() => SECTIONS.filter((item) => (!item.needsAccount || account) && (!item.available || item.available())), [account]);
  const shown = query.trim() ? available.filter((item) => normalize(`${item.title} ${item.group} ${item.keywords}`).includes(normalize(query.trim()))) : available;
  const current = available.find((item) => item.id === section) ?? available[0];

  useEffect(() => {
    if (!open) return;
    setQuery('');
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      // Esc fecha a tela, a menos que um diálogo ou menu por cima tenha tratado a tecla.
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="alertdialog"], .cn-dialog-backdrop, [aria-modal="true"]:not([data-settings-screen])')) closeSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || !current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Configurações"
      data-settings-screen
      data-testid="settings-screen"
      data-section={current.id}
      className="fixed inset-x-0 top-(--titlebar-h) bottom-0 z-[45] flex animate-fade flex-col bg-ink-950 sm:flex-row"
    >
      <aside className="flex shrink-0 flex-col border-white/5 bg-ink-900/70 sm:w-72 sm:border-r">
        <div className="p-3 pb-2">
          <label className="flex h-9 items-center gap-2 rounded-lg bg-ink-950/80 px-2.5 text-sm text-fog-400 focus-within:ring-1 focus-within:ring-brand-400">
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar configurações"
              aria-label="Pesquisar configurações"
              className="min-w-0 flex-1 bg-transparent text-fog-100 outline-none placeholder:text-fog-500"
              data-testid="settings-search"
            />
          </label>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 sm:flex-1 sm:flex-col sm:overflow-y-auto sm:pb-3" aria-label="Categorias das configurações">
          {GROUPS.map((group) => {
            const items = shown.filter((item) => item.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="flex shrink-0 gap-1 sm:flex-col">
                <p className="hidden px-2.5 pt-3 pb-1 text-[11px] font-extrabold tracking-wider text-fog-500 uppercase sm:block">{group}</p>
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === current.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openSettings(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={cx(
                        'flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition-colors',
                        active ? 'bg-brand-500/20 text-white' : 'text-fog-300 hover:bg-white/5 hover:text-fog-100',
                      )}
                      data-testid={`settings-nav-${item.id}`}
                    >
                      <Icon className={cx('size-4 shrink-0', active ? 'text-neon-300' : 'text-fog-500')} aria-hidden="true" />
                      {item.title}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {shown.length === 0 && <p className="px-2.5 py-3 text-sm text-fog-500">Nada encontrado para “{query}”.</p>}
        </nav>
        {account && (
          <div className="hidden border-t border-white/5 p-2 sm:block">
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-live-300 transition-colors hover:bg-live-500/10"
              onClick={() =>
                void dialogs.confirm({
                  title: 'Sair da conta?',
                  message: 'Você sai neste aparelho. Para voltar, entre de novo com seu usuário e senha.',
                  confirmLabel: 'Sair da conta',
                  tone: 'perigo',
                  action: async () => {
                    closeSettings();
                    await groups.logout();
                  },
                })
              }
              data-testid="account-logout"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sair da conta
            </button>
          </div>
        )}
      </aside>

      <main className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-5 px-5 py-6 sm:px-10 sm:py-10">
          <h1 className="pr-14 text-xl font-extrabold tracking-tight" data-testid="settings-title">
            {current.title}
          </h1>
          <div className="grid gap-5" data-testid={`settings-panel-${current.id}`}>
            {current.render(account)}
          </div>
        </div>
      </main>

      <div className="absolute top-4 right-4 flex flex-col items-center gap-1 sm:top-8 sm:right-8">
        <button
          ref={closeRef}
          type="button"
          aria-label="Fechar"
          title="Voltar ao aplicativo (Esc)"
          onClick={closeSettings}
          className="flex size-10 items-center justify-center rounded-full border border-fog-500/40 text-fog-300 transition-colors hover:border-fog-200 hover:bg-white/5 hover:text-white"
          data-testid="settings-close"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
        <span className="text-[11px] font-bold text-fog-500" aria-hidden="true">
          ESC
        </span>
      </div>
    </div>
  );
}

// --- Seções -------------------------------------------------------------------------------------

function Row({ title, about, children }: { title: string; about?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {about && <p className="text-[13px] leading-snug text-fog-400">{about}</p>}
      </div>
      {children}
    </div>
  );
}

function Block({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-2xl bg-ink-900/60 p-4">
      {title && <h2 className="text-sm font-extrabold">{title}</h2>}
      {children}
    </section>
  );
}

function MyAccount({ account }: { account: Account }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const { busy, run } = useAction();
  const password = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await groups.changePassword(current, next);
      setCurrent('');
      setNext('');
      groups.notify('Senha trocada. Os outros aparelhos foram desconectados.');
    });
  };
  return (
    <>
      <Block>
        <div className="flex items-center gap-4" data-testid="account-settings">
          <Avatar id={account.id} name={account.displayName} size={64} image={social.store.get().profiles[account.id]?.avatar} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-extrabold">{account.displayName}</p>
            <p className="truncate text-sm text-fog-400">@{account.username}</p>
          </div>
          <Button size="sm" onClick={() => openSettings('perfil')}>
            Editar perfil
          </Button>
        </div>
      </Block>
      <Block title="Trocar a senha">
        <form className="grid gap-3" onSubmit={password}>
          <label className={fieldLabel}>
            Senha atual
            <TextInput type="password" autoComplete="current-password" value={current} required onChange={(event) => setCurrent(event.target.value)} />
          </label>
          <label className={fieldLabel}>
            Senha nova
            <TextInput type="password" autoComplete="new-password" value={next} required minLength={8} onChange={(event) => setNext(event.target.value)} />
          </label>
          <Button type="submit" className="justify-self-start" disabled={busy || !current || next.length < 8}>
            Trocar senha
          </Button>
        </form>
      </Block>
    </>
  );
}

function PrivacySettings({ account }: { account: Account }) {
  const profile = useStore(social.store, (state) => state.profiles[account.id]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void social.profile(account.id, true).catch(() => undefined);
  }, [account.id]);
  if (!profile) return <p className="text-sm text-fog-400">Carregando…</p>;
  const save = async (patch: Partial<Pick<Profile, 'profilePrivacy' | 'dmPrivacy'>>) => {
    setSaving(true);
    try {
      await social.updateProfile(patch);
      groups.notify('Privacidade salva.');
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Não foi possível salvar', message: errorText(error) });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Block>
      <label className={fieldLabel}>
        Quem vê sua bio, status e grupos em comum
        <select className={selectClass} disabled={saving} value={profile.profilePrivacy ?? 'membros'} onChange={(event) => void save({ profilePrivacy: event.target.value as Profile['profilePrivacy'] })} data-testid="profile-privacy">
          <option value="todos">Qualquer pessoa que me encontrar</option>
          <option value="membros">Quem divide um grupo comigo</option>
          <option value="amigos">Só amigos</option>
        </select>
      </label>
      <label className={fieldLabel}>
        Quem pode mandar mensagem privada
        <select className={selectClass} disabled={saving} value={profile.dmPrivacy ?? 'membros'} onChange={(event) => void save({ dmPrivacy: event.target.value as Profile['dmPrivacy'] })} data-testid="dm-privacy">
          <option value="membros">Amigos e quem divide um grupo</option>
          <option value="amigos">Só amigos</option>
        </select>
      </label>
      <p className="text-[13px] leading-snug text-fog-500">As mensagens privadas só são vistas por quem participa da conversa. Bloquear alguém impede mensagens e pedidos de amizade dessa pessoa.</p>
    </Block>
  );
}

function FriendsSettings() {
  const friends = useStore(social.store, (state) => state.friends);
  const blocks = useStore(social.store, (state) => state.blocks);
  useEffect(() => {
    void social.loadFriends().catch(() => undefined);
  }, []);
  const accepted = (friends ?? []).filter((friend) => friend.state === 'amigos');
  return (
    <>
      <Block title={`Amigos — ${accepted.length}`}>
        {accepted.length === 0 && <p className="text-sm text-fog-400">Nenhum amigo ainda. Clique com o botão direito em alguém num grupo para adicionar.</p>}
        <ul className="grid gap-1" data-testid="settings-friends">
          {accepted.map((friend) => (
            <li key={friend.user.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Avatar id={friend.user.id} name={friend.user.displayName} size={34} image={friend.user.avatar} online={friend.online} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {friend.user.displayName} <span className="font-normal text-fog-500">@{friend.user.username}</span>
              </span>
              <Button
                size="sm"
                variant="quiet"
                onClick={() =>
                  void dialogs.confirm({
                    title: `Desfazer a amizade com ${friend.user.displayName}?`,
                    message: 'Vocês deixam de aparecer como amigos. Dá para pedir de novo depois.',
                    confirmLabel: 'Desfazer amizade',
                    tone: 'perigo',
                    action: () => social.removeFriend(friend.user.id),
                  })
                }
              >
                Desfazer amizade
              </Button>
            </li>
          ))}
        </ul>
      </Block>
      <Block title={`Bloqueados — ${(blocks ?? []).length}`}>
        {(blocks ?? []).length === 0 && <p className="text-sm text-fog-400">Ninguém bloqueado.</p>}
        <ul className="grid gap-1" data-testid="settings-blocks">
          {(blocks ?? []).map((user) => (
            <li key={user.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Avatar id={user.id} name={user.displayName} size={34} image={user.avatar} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {user.displayName} <span className="font-normal text-fog-500">@{user.username}</span>
              </span>
              <Button size="sm" variant="quiet" onClick={() => void social.unblock(user.id)} data-testid="settings-unblock">
                Desbloquear
              </Button>
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}

function NotificationSettings() {
  const [prefs, setPrefs] = useState(alertPrefs.get);
  const save = (patch: Partial<typeof prefs>) => {
    const value = { ...prefs, ...patch };
    setPrefs(value);
    alertPrefs.set(value);
  };
  return (
    <Block>
      <Row title="Notificações do sistema" about={desktopAlertsSupported() ? 'Mostra um aviso quando chega mensagem e a janela não está em foco.' : 'Este navegador não mostra notificações.'}>
        <Toggle
          on={prefs.desktop}
          label="Notificações do sistema"
          disabled={!desktopAlertsSupported()}
          onChange={(on) => {
            if (!on) return save({ desktop: false });
            void allowDesktopAlerts().then((allowed) => {
              save({ desktop: allowed });
              if (!allowed) groups.notify('As notificações estão bloqueadas para este site. Libere nas permissões do navegador.');
            });
          }}
        />
      </Row>
      <Row title="Som de mensagem" about="Um toque curto quando chega mensagem em outro canal ou com a janela em segundo plano.">
        <Toggle on={prefs.sound} label="Som de mensagem" onChange={(sound) => save({ sound })} />
      </Row>
      <p className="text-[13px] leading-snug text-fog-500">Quais mensagens avisam (todas, só menções ou nenhuma) você escolhe em cada grupo e em cada canal, pelo sino.</p>
    </Block>
  );
}

/**
 * Temas: cada cartão é uma miniatura da interface pintada com as variáveis daquele tema (aplicadas só no cartão),
 * então a prévia é a real. Escolher aplica na hora em todas as telas, menus e diálogos, e fica guardado.
 */
function AppearanceSettings() {
  const theme = useStore(appearance, (state) => state.theme);
  return (
    <Block title="Tema">
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Tema">
        {THEME_IDS.map((id) => {
          const def = THEMES[id];
          const selected = theme === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setAppearance({ theme: id })}
              className={cx('group grid gap-2 rounded-2xl border-2 p-2 text-left transition-colors', selected ? 'border-brand-400' : 'border-transparent hover:border-ink-600')}
              data-testid={`theme-${id}`}
            >
              <div style={def.vars as React.CSSProperties} className="relative flex h-28 overflow-hidden rounded-xl bg-ink-950" aria-hidden="true">
                <div className="flex w-9 flex-col items-center gap-1.5 bg-ink-900 py-2">
                  <span className="size-5 rounded-lg bg-brand-500 shadow-glow" />
                  <span className="size-5 rounded-lg bg-ink-700" />
                  <span className="size-5 rounded-lg bg-ink-700" />
                </div>
                <div className="flex flex-1 flex-col gap-1.5 bg-ink-850 p-2">
                  <span className="h-2 w-2/3 rounded-full bg-fog-100/80" />
                  <span className="h-1.5 w-11/12 rounded-full bg-fog-400/60" />
                  <span className="h-1.5 w-3/4 rounded-full bg-fog-400/60" />
                  <span className="mt-auto flex items-center gap-1.5">
                    <span className="h-4 w-10 rounded-md bg-linear-to-b from-brand-500 to-brand-700" />
                    <span className="size-2 rounded-full bg-neon-400" />
                    <span className="size-2 rounded-full bg-ok-400" />
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2 px-1">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{def.name}</p>
                  <p className="text-xs leading-snug text-fog-400">{def.description}</p>
                </div>
                {selected && <Check className="mt-0.5 size-4 shrink-0 text-neon-300" aria-hidden="true" />}
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[13px] leading-snug text-fog-500">O tema vale neste aparelho e muda na hora, sem reiniciar.</p>
    </Block>
  );
}

const MOTION: { value: MotionChoice; label: string; about: string }[] = [
  { value: 'sistema', label: 'Seguir o sistema', about: 'Usa a opção de animações do Windows ou do navegador.' },
  { value: 'reduzir', label: 'Reduzir animações', about: 'Sem transições nem animações; GIFs e avatares animados ficam parados até passar o mouse.' },
  { value: 'normal', label: 'Animações completas', about: 'Mesmo que o sistema peça menos movimento.' },
];

function AccessibilitySettings() {
  const motion = useStore(appearance, (state) => state.motion);
  return (
    <Block title="Movimento">
      <div className="grid gap-2" role="radiogroup" aria-label="Animações">
        {MOTION.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={motion === option.value}
            onClick={() => setAppearance({ motion: option.value })}
            className={cx('rounded-xl border px-3 py-2.5 text-left transition-colors', motion === option.value ? 'border-brand-400 bg-brand-500/15' : 'border-ink-600 hover:border-ink-500')}
            data-testid={`motion-${option.value}`}
          >
            <p className="text-sm font-semibold">{option.label}</p>
            <p className="text-[13px] leading-snug text-fog-400">{option.about}</p>
          </button>
        ))}
      </div>
    </Block>
  );
}

function VoiceSettings() {
  const call = useStore(settingsScreen, (state) => state.call);
  if (!call) {
    return (
      <Notice>
        As opções de microfone, som, supressão de ruído e transmissão ficam disponíveis durante uma chamada, onde dá para testar cada uma ao vivo. Entre num canal de voz e abra esta tela de novo (ou use a engrenagem da barra da chamada).
      </Notice>
    );
  }
  return (
    <div className="grid" data-testid="settings-voice">
      <CallSettings session={call.session} noise={call.noise} />
    </div>
  );
}
