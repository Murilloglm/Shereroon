import { AudioLines, Gamepad2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { activities, playingFor, type FriendActivity } from '../../lib/activities.ts';
import { social } from '../../lib/social/client.ts';
import { useStore } from '../../lib/store.ts';
import { GameIcon } from '../settings/GameIcon.tsx';
import { Avatar } from '../ui.tsx';
import { useUserTriggers } from './UserInteractions.tsx';

/** "há 2 h" a partir do fim de uma atividade recente. */
function ago(at: string | null, now: number): string {
  if (!at) return '';
  const minutes = Math.max(1, Math.floor((now - Date.parse(at)) / 60_000));
  return minutes < 60 ? `há ${minutes} min` : `há ${Math.floor(minutes / 60)} h`;
}

function Row({ item, now }: { item: FriendActivity; now: number }) {
  const triggers = useUserTriggers(item.user.id);
  const name = social.nameFor(item.user.id, item.user.displayName);
  return (
    <li className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.03]" data-testid="activity-row" data-user={item.user.username} data-playing={item.activity ? item.activity.name : ''}>
      <span className="flex min-w-0 flex-1 cursor-pointer items-center gap-3" {...triggers}>
        <Avatar id={item.user.id} name={item.user.displayName} size={40} image={item.user.avatar} online={item.online} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{name}</span>
          {item.activity ? (
            <span className="flex items-center gap-1.5 truncate text-sm text-fog-300" data-testid="activity-playing">
              Jogando <b className="truncate text-fog-100">{item.activity.name}</b>
              <span className="shrink-0 text-xs text-fog-500">· {playingFor(item.activity.startedAt, now)}</span>
            </span>
          ) : (
            <span className="block truncate text-sm text-fog-500">{item.online ? 'Online' : 'Offline'}</span>
          )}
          {item.recent.length > 0 && (
            <span className="block truncate text-xs text-fog-500" data-testid="activity-recent">
              Jogou recentemente: {item.recent.map((recent) => `${recent.name} (${ago(recent.endedAt, now)})`).join(', ')}
            </span>
          )}
        </span>
      </span>
      {item.inVoice && (
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-neon-500/15 px-2 py-0.5 text-xs font-bold text-neon-300" data-testid="activity-voice">
          <AudioLines className="size-3.5" aria-hidden="true" /> Em chamada
        </span>
      )}
      {item.activity && <GameIcon icon={item.activity.icon} size={36} />}
    </li>
  );
}

/**
 * Atividades dos amigos: quem está jogando o quê e há quanto tempo, quem está em chamada e o que jogaram nas
 * últimas horas. Cada amigo escolhe quem vê isso (Configurações → Jogos e atividades).
 */
export function ActivityList() {
  const friends = useStore(activities.store, (state) => state.friends);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    void activities.loadFriends().catch(() => undefined);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const playing = (friends ?? []).filter((item) => item.activity);
  const online = (friends ?? []).filter((item) => !item.activity && item.online);
  const offline = (friends ?? []).filter((item) => !item.activity && !item.online);
  const section = (title: string, items: FriendActivity[], testId: string) =>
    items.length > 0 && (
      <section className="grid gap-1" data-testid={testId}>
        <h2 className="px-3 pt-2 text-xs font-extrabold tracking-wide text-fog-500 uppercase">
          {title} — {items.length}
        </h2>
        <ul className="grid gap-0.5">
          {items.map((item) => (
            <Row key={item.user.id} item={item} now={now} />
          ))}
        </ul>
      </section>
    );
  return (
    <div className="grid max-w-3xl gap-3" data-testid="activities">
      {friends === null && <p className="text-sm text-fog-500">Carregando…</p>}
      {friends !== null && friends.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-fog-400">
          <Gamepad2 className="size-4" aria-hidden="true" /> Adicione amigos para ver o que eles estão jogando.
        </p>
      )}
      {section('Jogando agora', playing, 'activities-playing')}
      {section('Online', online, 'activities-online')}
      {section('Offline', offline, 'activities-offline')}
    </div>
  );
}
