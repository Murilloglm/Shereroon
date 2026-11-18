import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { activities, detectionAvailable } from '../../lib/activities.ts';
import { desktop } from '../../lib/desktop.ts';
import { dialogs } from '../../lib/dialogs.ts';
import { groups } from '../../lib/groups/client.ts';
import { social, type Profile } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { errorText, selectClass, useAction } from '../groups/common.tsx';
import { Button, cx, Notice, TextInput, Toggle } from '../ui.tsx';
import { GameIcon } from './GameIcon.tsx';

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 rounded-2xl bg-ink-900/60 p-4">
      <h2 className="text-sm font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Configurações → Jogos e atividades: detecção do jogo aberto (só no aplicativo de Windows e só se ligada), quem vê
 * o que você joga, jogos vinculados (no perfil ou não, atividade oculta por jogo) e o estado das integrações.
 */
export function GamesSettings({ userId }: { userId: string }) {
  const detection = useStore(activities.store, (state) => state.detection);
  const detected = useStore(activities.store, (state) => state.detected);
  const games = useStore(activities.store, (state) => state.games);
  const profile = useStore(social.store, (state) => state.profiles[userId]);
  const [name, setName] = useState('');
  const [programs, setPrograms] = useState<{ exe: string; name: string; icon: string | null }[] | null>(null);
  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const { busy, run } = useAction();

  useEffect(() => {
    void activities.loadGames().catch(() => undefined);
    void social.profile(userId, true).catch(() => undefined);
  }, [userId]);

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await activities.addGame({ name: name.trim() });
      setName('');
      groups.notify('Jogo adicionado.');
    });
  };

  const listPrograms = async () => {
    if (!desktop?.activity) return;
    setLoadingPrograms(true);
    try {
      setPrograms(await desktop.activity.programs());
    } finally {
      setLoadingPrograms(false);
    }
  };

  const savePrivacy = async (activityPrivacy: NonNullable<Profile['activityPrivacy']>) => {
    try {
      await social.updateProfile({ activityPrivacy });
      groups.notify('Privacidade das atividades salva.');
    } catch (error) {
      await dialogs.alert({ kind: 'erro', title: 'Não foi possível salvar', message: errorText(error) });
    }
  };

  const linkedExes = new Set((games ?? []).map((game) => game.exe).filter(Boolean));

  return (
    <>
      <Block title="Detecção de jogos">
        {detectionAvailable() ? (
          <>
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Detectar o jogo aberto neste computador</p>
                <p className="text-[13px] leading-snug text-fog-400">
                  A cada 30 segundos o aplicativo confere os nomes dos programas abertos e reconhece o jogo. Só o nome do jogo é enviado, e só aparece para quem você deixar abaixo.
                </p>
              </div>
              <Toggle on={detection} label="Detectar o jogo aberto neste computador" onChange={(on) => activities.setDetection(on)} />
            </div>
            {detection && (
              <p className="text-[13px] text-fog-300" data-testid="games-detected">
                {detected ? (
                  <>
                    Agora: <b className="text-fog-100">jogando {detected}</b>
                  </>
                ) : (
                  'Nenhum jogo aberto agora.'
                )}
              </p>
            )}
          </>
        ) : (
          <Notice>A detecção automática existe no aplicativo para Windows. Aqui no site, você pode vincular jogos à mão.</Notice>
        )}
      </Block>

      <Block title="Quem vê o que você está jogando">
        <select
          className={selectClass}
          value={profile?.activityPrivacy ?? 'amigos'}
          onChange={(event) => void savePrivacy(event.target.value as NonNullable<Profile['activityPrivacy']>)}
          aria-label="Quem vê o que você está jogando"
          data-testid="activity-privacy"
        >
          <option value="amigos">Só amigos</option>
          <option value="membros">Amigos e quem divide um grupo comigo</option>
          <option value="ninguem">Ninguém</option>
        </select>
        <p className="text-[13px] leading-snug text-fog-500">Vale para o jogo atual, as atividades recentes e os jogos mostrados no perfil.</p>
      </Block>

      <Block title="Jogos vinculados">
        {games && games.length === 0 && <p className="text-sm text-fog-400">Nenhum jogo vinculado ainda. Jogos conhecidos são reconhecidos sem vincular; vincule para mostrar no perfil, mudar o nome ou ocultar.</p>}
        <ul className="grid gap-1" data-testid="games-list">
          {(games ?? []).map((game) => (
            <li key={game.id} className="flex flex-wrap items-center gap-3 rounded-xl px-1 py-1.5" data-testid="game-row" data-game={game.name}>
              <GameIcon icon={game.icon} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{game.name}</p>
                <p className="truncate text-xs text-fog-500">{game.exe ?? 'adicionado à mão'}</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-fog-300">
                <Toggle on={game.showOnProfile} label={`Mostrar ${game.name} no perfil`} onChange={(showOnProfile) => void activities.updateGame(game.id, { showOnProfile })} />
                No perfil
              </label>
              <label className="flex items-center gap-2 text-xs text-fog-300">
                <Toggle on={game.hidden} label={`Ocultar a atividade de ${game.name}`} onChange={(hidden) => void activities.updateGame(game.id, { hidden })} />
                Ocultar atividade
              </label>
              <button type="button" aria-label={`Remover ${game.name}`} title="Remover" className="rounded-lg p-1.5 text-fog-500 hover:bg-live-500/10 hover:text-live-300" onClick={() => void activities.removeGame(game.id)} data-testid="game-remove">
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex gap-2">
          <TextInput value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Nome do jogo" aria-label="Nome do jogo" className="min-w-0 flex-1" data-testid="game-name" />
          <Button type="submit" disabled={busy || !name.trim()} data-testid="game-add">
            <Plus className="size-4" aria-hidden="true" /> Adicionar
          </Button>
        </form>
        {desktop?.activity && (
          <div className="grid gap-2">
            <Button size="sm" variant="quiet" className="justify-self-start" disabled={loadingPrograms} onClick={() => void listPrograms()} data-testid="game-programs">
              {loadingPrograms ? 'Procurando programas abertos…' : 'Escolher entre os programas abertos'}
            </Button>
            {programs && (
              <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-xl border border-ink-700 p-1" data-testid="game-program-list">
                {programs.length === 0 && <li className="px-2 py-1.5 text-sm text-fog-400">Nenhum programa com janela aberta.</li>}
                {programs.map((program) => (
                  <li key={program.exe}>
                    <button
                      type="button"
                      disabled={linkedExes.has(program.exe.toLowerCase())}
                      className={cx('flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/5 disabled:opacity-50')}
                      onClick={() => void run(async () => (await activities.addGame({ name: program.name, exe: program.exe, icon: program.icon }), groups.notify(`${program.name} vinculado.`)))}
                    >
                      <GameIcon icon={program.icon} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{program.name}</span>
                        <span className="block truncate text-xs text-fog-500">{program.exe}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Block>

      <Block title="Contas de plataformas">
        <p className="text-[13px] leading-snug text-fog-400">
          Integrações com Xbox, Riot Games e outras plataformas só entram quando houver API oficial e permissão para isso, e nunca pedindo a senha dessas contas aqui. Conectar uma
          conta Microsoft não revelaria jogos de outras lojas. Por enquanto, a atividade vem da detecção local (quando você liga) ou dos jogos que você vincula.
        </p>
      </Block>
    </>
  );
}
