import { ArrowLeft, LoaderCircle, Lock, Users } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { navigate } from '../App.tsx';
import { api, ApiError, type RoomInfo } from '../lib/api.ts';
import { inviteAccess } from '../lib/invite-access.ts';
import { RoomSession, type EndReason } from '../lib/session.ts';
import { storage } from '../lib/storage.ts';
import { useStore } from '../lib/store.ts';
import { RoomView } from './room/RoomView.tsx';
import { Button, Card, Logo, Notice, TextInput } from './ui.tsx';

const END_MESSAGES: Record<EndReason, { title: string; body: string; canReturn: boolean }> = {
  saiu: { title: 'Você saiu da sala', body: 'Sua transmissão e seu microfone foram encerrados.', canReturn: true },
  expulso: {
    title: 'Você foi removido da sala',
    body: 'O dono da sala removeu você. Não é possível voltar com este convite.',
    canReturn: false,
  },
  duplicado: {
    title: 'Sala aberta em outra aba',
    body: 'Você entrou nesta sala por outra aba ou aparelho, e esta conexão foi encerrada.',
    canReturn: true,
  },
  encerrada: { title: 'A sala foi encerrada', body: 'O dono encerrou a sala para todos.', canReturn: true },
  trancada: {
    title: 'A sala está trancada',
    body: 'O dono trancou a sala enquanto você estava fora. Peça para ele destrancar.',
    canReturn: true,
  },
  erro: { title: 'Não foi possível voltar para a sala', body: 'A conexão caiu e a reconexão foi recusada.', canReturn: true },
};

export function RoomGate({ invite }: { invite: string }) {
  const sessionRef = useRef<RoomSession | null>(null);
  sessionRef.current ??= new RoomSession();
  const session = sessionRef.current;

  const phase = useStore(session.store, (state) => state.phase);
  const endReason = useStore(session.store, (state) => state.endReason);
  const sessionError = useStore(session.store, (state) => state.error);

  const saved = storage.getRoom(invite);
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [lookup, setLookup] = useState<'carregando' | 'ok' | 'invalido' | 'fora'>('carregando');
  const [name, setName] = useState(storage.getName);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async (userName: string, typedPassword?: string) => {
    setBusy(true);
    setError(null);
    try {
      storage.setName(userName);
      await session.join(inviteAccess(invite, userName, typedPassword));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'senha_incorreta') storage.saveRoom(invite, { password: undefined });
      setError(failure instanceof Error ? failure.message : 'Não foi possível entrar na sala.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    api
      .roomInfo(invite)
      .then(({ room }) => {
        if (!alive) return;
        setInfo(room);
        setLookup('ok');
        // Quem acabou de criar a sala entra direto.
        if (sessionStorage.getItem('shareroom:entrar-direto') === invite) {
          sessionStorage.removeItem('shareroom:entrar-direto');
          const userName = storage.getName();
          if (userName) void join(userName);
        }
      })
      .catch((failure) => alive && setLookup(failure instanceof ApiError && failure.status === 404 ? 'invalido' : 'fora'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite]);

  // Fechar a aba ou trocar de sala encerra a conexão e solta a captura.
  useEffect(() => () => void session.leave(), [session]);

  useEffect(() => {
    document.title = info ? `${info.name} – ShareRoom` : 'ShareRoom – Compartilhar Tela';
  }, [info]);

  if (phase === 'connected' || phase === 'reconnecting') {
    return <RoomView session={session} invite={invite} onLeave={() => void session.leave()} />;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const userName = name.trim();
    if (!userName) {
      setError('Escolha um nome para entrar.');
      return;
    }
    void join(userName, password || undefined);
  };

  const needsPassword = info?.hasPassword === true && !saved?.hostKey && !saved?.session && !saved?.password;
  const ended = phase === 'ended' && endReason ? END_MESSAGES[endReason] : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 pb-16">
      <header className="flex items-center justify-between py-6">
        <button type="button" onClick={() => navigate('#/')} className="rounded-lg" aria-label="Voltar ao início">
          <Logo />
        </button>
      </header>

      <main className="flex flex-1 items-center">
        <Card className="w-full animate-rise p-6 sm:p-8">
          {lookup === 'carregando' && (
            <p className="flex items-center gap-3 text-fog-300">
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
              Conferindo o convite… Se o servidor estava em repouso, isso pode levar até 1 minuto.
            </p>
          )}

          {lookup === 'invalido' && (
            <>
              <h1 className="text-2xl font-extrabold">Convite inválido</h1>
              <p className="mt-3 text-fog-300">
                Este link não corresponde a nenhuma sala. Confira se ele foi copiado inteiro ou peça um convite novo.
              </p>
              <BackHome />
            </>
          )}

          {lookup === 'fora' && (
            <>
              <h1 className="text-2xl font-extrabold">Servidor sem resposta</h1>
              <p className="mt-3 text-fog-300">
                Não foi possível conferir o convite agora. Verifique sua internet e recarregue a página.
              </p>
              <Button className="mt-6" variant="outline" onClick={() => window.location.reload()}>
                Tentar de novo
              </Button>
            </>
          )}

          {lookup === 'ok' && info && ended && (
            <>
              <h1 className="text-2xl font-extrabold">{ended.title}</h1>
              <p className="mt-3 text-fog-300">{endReason === 'erro' && sessionError ? sessionError : ended.body}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                {ended.canReturn && (
                  <Button variant="primary" disabled={busy} onClick={() => name.trim() && void join(name.trim())} data-testid="gate-return">
                    {busy && <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />}
                    Voltar para a sala
                  </Button>
                )}
                <Button onClick={() => navigate('#/')}>Ir para o início</Button>
              </div>
              {error && (
                <Notice tone="aviso" className="mt-4">
                  {error}
                </Notice>
              )}
            </>
          )}

          {lookup === 'ok' && info && !ended && (
            <>
              <p className="flex items-center gap-2 text-sm font-semibold text-brand-300">
                {info.hasPassword ? <Lock className="size-4" aria-hidden="true" /> : <Users className="size-4" aria-hidden="true" />}
                Sala privada, até {info.capacity} participantes
              </p>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-balance" data-testid="gate-room-name">
                {info.name}
              </h1>
              <form className="mt-6 grid gap-4" onSubmit={submit}>
                <label className="grid gap-1.5 text-sm font-semibold text-fog-300">
                  Seu nome de usuário
                  <TextInput
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={32}
                    autoFocus
                    autoComplete="nickname"
                    placeholder="Como os outros vão te ver"
                    data-testid="gate-name"
                  />
                </label>
                {needsPassword && (
                  <label className="grid gap-1.5 text-sm font-semibold text-fog-300">
                    Senha da sala
                    <TextInput
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      maxLength={64}
                      autoComplete="off"
                      data-testid="gate-password"
                    />
                  </label>
                )}
                {error && (
                  <Notice tone="aviso" data-testid="gate-error">
                    {error}
                  </Notice>
                )}
                <Button type="submit" variant="primary" size="lg" disabled={busy || phase === 'connecting'} data-testid="gate-join">
                  {(busy || phase === 'connecting') && <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />}
                  Entrar na sala
                </Button>
              </form>
              <p className="mt-4 text-[13px] leading-snug text-fog-500">
                Ao entrar você só assiste. Sua tela e seu microfone só são transmitidos quando você escolher, e o
                navegador sempre pede sua autorização antes.
              </p>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}

function BackHome() {
  return (
    <Button className="mt-6" onClick={() => navigate('#/')}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      Ir para o início
    </Button>
  );
}
