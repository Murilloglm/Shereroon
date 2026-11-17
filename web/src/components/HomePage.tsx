import { Crown, Link2, Lock, LoaderCircle, Trash2, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { navigate } from '../App.tsx';
import { api, ApiError } from '../lib/api.ts';
import { extractInvite } from '../lib/invite-access.ts';
import { storage } from '../lib/storage.ts';
import { Button, Card, Logo, Notice, TextInput } from './ui.tsx';

type ServerState = 'verificando' | 'acordando' | 'pronto' | 'fora';

/** Hospedagens gratuitas põem o backend para dormir; avisa em vez de parecer travado. */
function useServerState(): ServerState {
  const [state, setState] = useState<ServerState>('verificando');
  useEffect(() => {
    let alive = true;
    const slow = setTimeout(() => alive && setState((current) => (current === 'verificando' ? 'acordando' : current)), 2500);
    api
      .health()
      .then(() => alive && setState('pronto'))
      .catch(() => alive && setState('fora'))
      .finally(() => clearTimeout(slow));
    return () => {
      alive = false;
      clearTimeout(slow);
    };
  }, []);
  return state;
}

export function HomePage() {
  const server = useServerState();
  const [userName, setUserName] = useState(storage.getName);
  const [roomName, setRoomName] = useState('');
  const [password, setPassword] = useState('');
  const [capacity, setCapacity] = useState(10);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [recent, setRecent] = useState(storage.recentRooms);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const name = userName.trim();
    if (!name) {
      setError('Escolha um nome de usuário antes de criar a sala.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createRoom({
        name: roomName.trim() || `Sala de ${name}`,
        password: password || undefined,
        capacity,
      });
      storage.setName(name);
      storage.saveRoom(created.invite, {
        name: created.room.name,
        hostKey: created.hostKey,
        password: password || undefined,
      });
      // Quem cria entra direto, sem passar pela tela de nome de novo.
      sessionStorage.setItem('shareroom:entrar-direto', created.invite);
      navigate(`#/sala/${created.invite}`);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Não foi possível criar a sala.');
      setBusy(false);
    }
  };

  const enter = (event: FormEvent) => {
    event.preventDefault();
    const invite = extractInvite(link);
    if (!invite) {
      setLinkError('Cole o link de convite completo (ele contém “#/sala/…”).');
      return;
    }
    navigate(`#/sala/${invite}`);
  };

  return (
    <div className="mx-auto flex min-h-(--app-h) max-w-6xl flex-col px-5 pb-16 sm:px-8">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => navigate('#/grupos')} data-testid="home-groups">
            <Users className="size-4" aria-hidden="true" />
            Grupos
          </Button>
          <ServerBadge state={server} />
        </div>
      </header>

      <main className="grid flex-1 items-start gap-10 pt-6 lg:grid-cols-[1.05fr_1fr] lg:pt-14">
        <div className="animate-rise">
          <h1 className="max-w-[16ch] text-4xl leading-[1.08] font-extrabold tracking-tight text-balance sm:text-5xl">
            Sua tela ao vivo, só para quem tem o link.
          </h1>
          <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-fog-300">
            Crie uma sala privada, mande o convite e compartilhe o monitor, uma janela ou uma aba. Seus amigos assistem
            no PC ou no celular, sem cadastro e sem instalar nada.
          </p>
          <ul className="mt-8 grid max-w-xl gap-3 text-[15px] text-fog-300">
            <li className="flex gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-400" />
              De 480p a 1080p e de 30 a 120 FPS, até onde seu PC, navegador e conexão alcançarem.
            </li>
            <li className="flex gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-400" />
              Os números na tela são os medidos na transmissão. Se o real ficar abaixo do pedido, o Cosmic Night avisa.
            </li>
            <li className="flex gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-400" />
              Nada é gravado nem guardado: o vídeo passa pelo servidor de transmissão e segue para quem está na sala.
            </li>
          </ul>

          {recent.length > 0 && (
            <section className="mt-10 max-w-xl">
              <h2 className="text-sm font-bold text-fog-400">Salas recentes neste navegador</h2>
              <ul className="mt-3 grid gap-2">
                {recent.slice(0, 5).map(({ invite, room }) => (
                  <li
                    key={invite}
                    className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-850/70 px-3.5 py-2.5"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left font-semibold hover:text-brand-200"
                      onClick={() => navigate(`#/sala/${invite}`)}
                    >
                      {room.hostKey ? (
                        <Crown className="size-4 shrink-0 text-warn-400" aria-label="Você criou esta sala" />
                      ) : (
                        <Users className="size-4 shrink-0 text-fog-500" aria-hidden="true" />
                      )}
                      <span className="truncate">{room.name || 'Sala'}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Esquecer ${room.name || 'sala'}`}
                      title="Esquecer esta sala"
                      className="rounded-md p-1.5 text-fog-500 hover:bg-ink-700 hover:text-fog-100"
                      onClick={() => {
                        storage.removeRoom(invite);
                        setRecent(storage.recentRooms());
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="grid gap-5">
          <Card className="animate-rise p-6">
            <h2 className="text-xl font-extrabold">Criar uma sala</h2>
            <form className="mt-5 grid gap-4" onSubmit={create}>
              <label className="grid gap-1.5 text-sm font-semibold text-fog-300">
                Seu nome de usuário
                <TextInput
                  value={userName}
                  onChange={(event) => setUserName(event.target.value)}
                  maxLength={32}
                  autoComplete="nickname"
                  placeholder="Como os outros vão te ver"
                  data-testid="home-user-name"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-fog-300">
                Nome da sala
                <TextInput
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  maxLength={32}
                  placeholder="Jogatina com a galera"
                  data-testid="home-room-name"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
                <label className="grid gap-1.5 text-sm font-semibold text-fog-300">
                  <span className="flex items-center gap-1.5">
                    <Lock className="size-3.5" aria-hidden="true" /> Senha (opcional)
                  </span>
                  <TextInput
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    maxLength={64}
                    autoComplete="new-password"
                    placeholder="Sem senha, basta o link"
                    data-testid="home-password"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-fog-300">
                  Lotação
                  <select
                    value={capacity}
                    onChange={(event) => setCapacity(Number(event.target.value))}
                    className="h-11 w-full min-w-0 rounded-xl border border-ink-600 bg-ink-900/70 px-3 text-[15px] text-fog-100 focus:border-brand-400 focus:outline-none"
                  >
                    {[2, 4, 6, 10, 15, 25, 50].map((value) => (
                      <option key={value} value={value}>
                        Até {value} pessoas
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {error && <Notice tone="aviso">{error}</Notice>}
              <Button type="submit" variant="primary" size="lg" disabled={busy} data-testid="home-create">
                {busy && <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />}
                Criar sala
              </Button>
            </form>
          </Card>

          <Card className="animate-rise p-6">
            <h2 className="text-xl font-extrabold">Entrar com um convite</h2>
            <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={enter}>
              <TextInput
                value={link}
                onChange={(event) => {
                  setLink(event.target.value);
                  setLinkError(null);
                }}
                placeholder="Cole aqui o link que você recebeu"
                aria-label="Link de convite"
                data-testid="home-invite"
              />
              <Button type="submit" variant="outline" className="sm:w-36">
                <Link2 className="size-4" aria-hidden="true" />
                Entrar
              </Button>
            </form>
            {linkError && (
              <Notice tone="aviso" className="mt-3">
                {linkError}
              </Notice>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}

function ServerBadge({ state }: { state: ServerState }) {
  if (state === 'pronto' || state === 'verificando') return null;
  if (state === 'acordando') {
    return (
      <span className="flex items-center gap-2 rounded-full border border-warn-400/40 bg-warn-400/10 px-3 py-1.5 text-sm font-semibold text-warn-400">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Acordando o servidor (pode levar até 1 minuto)…
      </span>
    );
  }
  return (
    <span className="max-w-md rounded-xl border border-live-500/50 bg-live-500/10 px-3 py-1.5 text-sm font-semibold text-live-300">
      Sem resposta do backend de salas. Se este site está no GitHub Pages, confira a variável VITE_API_URL.
    </span>
  );
}
