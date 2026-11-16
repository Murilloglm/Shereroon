import { api } from './api.ts';
import { desktop } from './desktop.ts';
import type { SessionAccess } from './session.ts';
import { storage } from './storage.ts';

/** Acesso a uma sala por link de convite: troca o convite (e a senha, se houver) por um token temporário. */
export function inviteAccess(invite: string, name: string, password?: string): SessionAccess {
  const hostKey = () => {
    const key = storage.getRoom(invite)?.hostKey;
    if (!key) throw new Error('Só quem criou a sala pode fazer isso.');
    return key;
  };

  return {
    async grant() {
      const saved = storage.getRoom(invite);
      const typed = password || saved?.password;
      const result = await api.join({
        invite,
        name,
        password: typed,
        hostKey: saved?.hostKey,
        session: saved?.session,
      });
      storage.saveRoom(invite, {
        name: result.room.name,
        session: { identity: result.identity, proof: result.proof },
        ...(result.room.hasPassword && typed ? { password: typed } : {}),
      });
      return {
        url: result.url,
        token: result.token,
        identity: result.identity,
        isHost: result.isHost,
        room: result.room,
      };
    },
    async kick(identity) {
      await api.kick(invite, hostKey(), identity);
    },
    async setLocked(locked) {
      await api.lock(invite, hostKey(), locked);
    },
    async closeRoom() {
      await api.close(invite, hostKey());
    },
  };
}

/** Link completo de convite. A rota fica no hash, então funciona em qualquer hospedagem estática. */
export function inviteLink(invite: string): string {
  if (desktop) {
    // Dentro do aplicativo a página não tem endereço público: o link aponta para o site, que abre em qualquer
    // navegador. Sem site configurado, o convite é o próprio código (o aplicativo e o site aceitam colá-lo).
    return desktop.config.siteUrl ? `${desktop.config.siteUrl}/#/sala/${invite}` : invite;
  }
  const url = new URL(window.location.href);
  url.hash = `#/sala/${invite}`;
  url.search = '';
  return url.toString();
}

/** Aceita o link inteiro ou só o código. */
export function extractInvite(input: string): string | null {
  const text = input.trim();
  const fromLink = /#\/sala\/([A-Za-z0-9_-]{20,})/.exec(text);
  if (fromLink) return fromLink[1]!;
  return /^[A-Za-z0-9_-]{20,}$/.test(text) ? text : null;
}
