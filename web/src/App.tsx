import { lazy, Suspense, useEffect, useState } from 'react';
import { DialogHost } from './components/DialogHost.tsx';
import { desktop } from './lib/desktop.ts';
import { HomePage } from './components/HomePage.tsx';
import { RoomGate } from './components/RoomGate.tsx';
import { Backdrop } from './components/ui.tsx';

// Os grupos só são baixados por quem abre os grupos: a página inicial e as salas por link ficam leves.
const GroupsPage = lazy(() => import('./components/groups/GroupsPage.tsx').then((module) => ({ default: module.GroupsPage })));

type Route =
  | { page: 'inicio' }
  | { page: 'sala'; invite: string }
  | { page: 'grupos'; groupId?: string; channelId?: string; invite?: string };

const ID = '[A-Za-z0-9_-]{8,40}';

/** Rotas no hash (#/sala/..., #/grupos/...): funcionam em hospedagem estática como o GitHub Pages, sem regra de servidor. */
function parseRoute(hash: string): Route {
  const room = /^#\/sala\/([A-Za-z0-9_-]{20,})\/?$/.exec(hash);
  if (room) return { page: 'sala', invite: room[1]! };
  const group = new RegExp(`^#/grupos(?:/(${ID}))?(?:/(${ID}))?/?$`).exec(hash);
  if (group) return { page: 'grupos', groupId: group[1], channelId: group[2] };
  const invite = new RegExp(`^#/convite/(${ID})/?$`).exec(hash);
  if (invite) return { page: 'grupos', invite: invite[1] };
  return { page: 'inicio' };
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  // Aplicativo de Windows: um link cosmicnight://convite/... abre a tela do convite aqui dentro.
  useEffect(() => {
    const links = desktop?.links;
    if (!links) return;
    const take = async () => {
      const link = await links.take();
      if (link?.kind === 'convite' && /^[A-Za-z0-9_-]{8,40}$/.test(link.code)) navigate(`#/convite/${link.code}`);
    };
    void take();
    return links.onLink(() => void take());
  }, []);

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return (
    <>
      <Backdrop />
      {route.page === 'sala' ? (
        <RoomGate key={route.invite} invite={route.invite} />
      ) : route.page === 'grupos' ? (
        <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-fog-400">Carregando…</div>}>
          <GroupsPage groupId={route.groupId} channelId={route.channelId} invite={route.invite} />
        </Suspense>
      ) : (
        <HomePage />
      )}
      <DialogHost />
    </>
  );
}
