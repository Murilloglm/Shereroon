/**
 * Ações de moderação e atalhos usados em mais de um lugar da interface (menu de botão direito, arrastar
 * pessoas entre canais, painel de moderação). Quem decide se pode é sempre o backend; aqui só se pede e se
 * explica a resposta.
 */
import { has, P } from '../../../../shared/permissions.ts';
import { ApiError } from '../api.ts';
import { desktop } from '../desktop.ts';
import { dialogs } from '../dialogs.ts';
import { groups, type GroupView } from './client.ts';

/** Leva alguém de um canal de voz para outro. Sem acesso ao destino, oferece a concessão explícita (se puder). */
export async function moveToVoice(view: GroupView, fromChannelId: string, userId: string, toChannelId: string): Promise<boolean> {
  const path = `/api/channels/${fromChannelId}/voice/moderate`;
  try {
    await groups.call('POST', path, { userId, action: 'move', toChannelId });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'sem_acesso_destino') {
      const destination = view.channels.find((channel) => channel.id === toChannelId);
      // Liberar alguém num canal é mudar as permissões dele: só quem pode fazer isso vê a opção.
      if (destination && has(destination.permissions, P.MANAGE_ROLES)) {
        return dialogs.confirm({
          title: 'Liberar o acesso e mover?',
          message: `${error.message} Se confirmar, essa pessoa passa a poder ver e entrar em “${destination.name}” (fica registrado na auditoria e dá para tirar depois nas permissões do canal).`,
          confirmLabel: 'Liberar e mover',
          action: () => groups.call('POST', path, { userId, action: 'move', toChannelId, grantAccess: true }),
        });
      }
      await dialogs.alert({ kind: 'aviso', title: 'Não dá para mover', message: error.message });
      return false;
    }
    await dialogs.alert({ kind: 'erro', title: 'Não foi possível mover', message: error instanceof Error ? error.message : 'Tente de novo.' });
    return false;
  }
}

/** Link para abrir um canal (site público; no aplicativo, o endereço do site). */
export function channelLink(groupId: string, channelId: string): string {
  const hash = `#/grupos/${groupId}/${channelId}`;
  if (desktop) return desktop.config.siteUrl ? `${desktop.config.siteUrl}/${hash}` : hash;
  const url = new URL(window.location.href);
  url.hash = hash;
  url.search = '';
  return url.toString();
}
