import { useState, type FormEvent } from 'react';
import { navigate } from '../../App.tsx';
import { groups } from '../../lib/groups/client.ts';
import { Button, Card, cx, Logo, Notice, TextInput } from '../ui.tsx';
import { errorText, fieldLabel } from './common.tsx';
import { AppLinks, InviteCard, useInvitePreview } from './InviteCard.tsx';

/** Entrar ou criar conta. Os grupos guardam mensagens, cargos e convites, então precisam saber quem é quem. */
export function AuthPage({ invite }: { invite?: string }) {
  const invited = Boolean(invite);
  const { preview, error: inviteError } = useInvitePreview(invite);
  const [mode, setMode] = useState<'entrar' | 'criar'>(invited ? 'criar' : 'entrar');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'criar') await groups.register({ username: username.trim(), displayName: displayName.trim(), password });
      else await groups.login({ username: username.trim(), password });
    } catch (failure) {
      setError(errorText(failure, 'Não foi possível entrar.'));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-(--app-h) max-w-md flex-col justify-center px-5 py-10">
      <button type="button" className="mb-8 self-start" onClick={() => navigate('#/')} aria-label="Voltar para o início">
        <Logo />
      </button>
      {invite && (preview || inviteError) && (
        <div className="mb-4 animate-rise">
          {preview ? (
            <InviteCard preview={preview}>
              <p className="text-sm text-fog-400">Entre ou crie sua conta para aceitar. O convite continua guardado.</p>
              <AppLinks code={invite} />
            </InviteCard>
          ) : (
            <p className="rounded-xl border border-live-400/40 bg-live-500/10 px-3 py-2 text-sm font-semibold text-live-300" data-testid="invite-invalid">
              {inviteError}
            </p>
          )}
        </div>
      )}
      <Card className="animate-rise p-6">
        <h1 className="text-2xl font-extrabold tracking-tight">{mode === 'criar' ? 'Criar sua conta' : 'Entrar nos grupos'}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-fog-400">
          {invited
            ? 'Você recebeu um convite para um grupo. Entre ou crie uma conta para aceitar.'
            : 'Grupos guardam canais, mensagens e cargos, por isso pedem uma conta. As salas por link continuam sem cadastro.'}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2" role="tablist">
          {(['entrar', 'criar'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              data-testid={`auth-tab-${value}`}
              onClick={() => {
                setMode(value);
                setError(null);
              }}
              className={cx(
                'h-10 rounded-xl border text-sm font-bold transition-[background,border-color] duration-150',
                mode === value ? 'border-brand-300 bg-brand-500/25 text-white' : 'border-ink-600 bg-ink-800 text-fog-300 hover:border-ink-500',
              )}
            >
              {value === 'entrar' ? 'Já tenho conta' : 'Criar conta'}
            </button>
          ))}
        </div>

        <form className="mt-5 grid gap-4" onSubmit={(event) => void submit(event)}>
          <label className={fieldLabel}>
            Nome de usuário
            <TextInput
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={24}
              required
              data-testid="auth-username"
            />
            {mode === 'criar' && <span className="text-xs font-normal text-fog-500">De 3 a 24 caracteres: letras sem acento, números, ponto ou sublinhado.</span>}
          </label>
          {mode === 'criar' && (
            <label className={fieldLabel}>
              Nome que aparece para os outros
              <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={32} placeholder="Opcional" data-testid="auth-display-name" />
            </label>
          )}
          <label className={fieldLabel}>
            Senha
            <TextInput
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'criar' ? 'new-password' : 'current-password'}
              minLength={mode === 'criar' ? 8 : undefined}
              maxLength={128}
              required
              data-testid="auth-password"
            />
            {mode === 'criar' && <span className="text-xs font-normal text-fog-500">No mínimo 8 caracteres. Não há recuperação de senha por e-mail: guarde bem.</span>}
          </label>
          {error && (
            <Notice tone="aviso" data-testid="auth-error">
              {error}
            </Notice>
          )}
          <Button type="submit" variant="primary" size="lg" disabled={busy} data-testid="auth-submit">
            {busy ? 'Aguarde…' : mode === 'criar' ? 'Criar conta e entrar' : 'Entrar'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
