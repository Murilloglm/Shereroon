import { Download, ExternalLink, Ticket } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { desktop } from '../../lib/desktop.ts';
import { groups } from '../../lib/groups/client.ts';
import { GroupIcon } from './common.tsx';

export interface InvitePreview {
  code: string;
  group: { id: string; name: string; description: string; icon: string | null; memberCount: number };
  joined: boolean;
  invite?: { expiresAt: string | null; maxUses: number; uses: number };
}

/** Página de download do aplicativo de Windows (a mesma do README). */
export const DOWNLOAD_PAGE = (import.meta.env.VITE_DOWNLOAD_URL ?? '').trim() || 'https://murilloglm.github.io/Shereroon/';

/** Lê o convite sem precisar de conta: quem recebeu o link vê para onde vai. */
export function useInvitePreview(code: string | undefined): { preview: InvitePreview | null; error: string | null } {
  const [state, setState] = useState<{ preview: InvitePreview | null; error: string | null }>({ preview: null, error: null });
  useEffect(() => {
    if (!code) return;
    let alive = true;
    groups
      .call('GET', `/api/invites/${code}`)
      .then((preview: InvitePreview) => alive && setState({ preview, error: null }))
      .catch((error: unknown) => alive && setState({ preview: null, error: error instanceof Error ? error.message : 'Este convite não pôde ser aberto.' }));
    return () => {
      alive = false;
    };
  }, [code]);
  return state;
}

/** Validade do convite em texto curto: "vale até 23/11 às 14:30 • 3 de 10 usos". */
export function inviteValidity(invite: InvitePreview['invite']): string | null {
  if (!invite) return null;
  const parts: string[] = [];
  if (invite.expiresAt) {
    const date = new Date(invite.expiresAt);
    parts.push(`vale até ${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } else {
    parts.push('não vence');
  }
  if (invite.maxUses > 0) parts.push(`${invite.uses} de ${invite.maxUses} usos`);
  return parts.join(' • ');
}

/**
 * No site: abrir o convite no aplicativo instalado (só com o clique da pessoa; o navegador pergunta se pode
 * abrir o Cosmic Night) ou baixar o aplicativo. Nada é detectado nem redirecionado sozinho. Dentro do
 * aplicativo estes botões não aparecem.
 */
export function AppLinks({ code }: { code: string }) {
  if (desktop) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="invite-app-links">
      <a
        href={`cosmicnight://convite/${encodeURIComponent(code)}`}
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-neon-400/60 bg-neon-500/10 px-3 text-sm font-bold text-neon-200 hover:bg-neon-500/20"
        data-testid="invite-open-app"
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        Abrir no aplicativo
      </a>
      <a
        href={DOWNLOAD_PAGE}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-ink-600 px-3 text-sm font-bold text-fog-300 hover:border-ink-500 hover:text-fog-100"
        data-testid="invite-download"
      >
        <Download className="size-4" aria-hidden="true" />
        Baixar o aplicativo
      </a>
    </div>
  );
}

/** Cartão com o grupo do convite (nome, ícone, descrição, tamanho e validade). */
export function InviteCard({ preview, children }: { preview: InvitePreview; children?: ReactNode }) {
  const validity = inviteValidity(preview.invite);
  return (
    <div className="cn-panel grid gap-3 rounded-2xl p-4" data-testid="invite-card">
      <div className="flex items-center gap-3">
        <GroupIcon group={preview.group} size={56} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-neon-300 uppercase">
            <Ticket className="size-3.5" aria-hidden="true" /> Convite
          </p>
          <p className="truncate text-lg font-extrabold">{preview.group.name}</p>
          <p className="truncate text-sm text-fog-400">
            {preview.group.memberCount} {preview.group.memberCount === 1 ? 'membro' : 'membros'}
            {validity && ` • ${validity}`}
          </p>
        </div>
      </div>
      {preview.group.description && <p className="text-sm leading-snug text-fog-300">{preview.group.description}</p>}
      {children}
    </div>
  );
}
