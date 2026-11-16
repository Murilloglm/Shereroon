import { useCallback, useState } from 'react';
import { has } from '../../../../shared/permissions.ts';
import { ApiError } from '../../lib/api.ts';
import { groups, type GroupSummary, type GroupView, type MemberView, type RoleView } from '../../lib/groups/client.ts';
import { cx } from '../ui.tsx';

export const errorText = (error: unknown, fallback = 'Não foi possível concluir a ação.'): string =>
  error instanceof ApiError || error instanceof Error ? error.message : fallback;

export const groupHash = (groupId?: string, channelId?: string): string => `#/grupos${groupId ? `/${groupId}` : ''}${groupId && channelId ? `/${channelId}` : ''}`;

/** A conta tem esta permissão no grupo? Só serve para mostrar ou esconder controles; quem decide é o backend. */
export const can = (view: GroupView, permission: bigint): boolean => has(view.me.permissions, permission);

export const memberName = (member: Pick<MemberView, 'nickname' | 'displayName'>): string => member.nickname || member.displayName;

/** Cargo mais alto com cor: é ele que pinta o nome da pessoa no chat e na lista. */
export function topRole(view: GroupView, member: Pick<MemberView, 'roleIds'>): RoleView | null {
  return view.roles.find((role) => !role.isEveryone && member.roleIds.includes(role.id)) ?? null;
}

export function nameColor(view: GroupView, member: Pick<MemberView, 'roleIds'>): string | undefined {
  return view.roles.find((role) => role.color && member.roleIds.includes(role.id))?.color ?? undefined;
}

export function GroupIcon({ group, size = 48, active }: { group: Pick<GroupSummary, 'id' | 'name' | 'icon'>; size?: number; active?: boolean }) {
  const initials = Array.from(group.name.trim())
    .filter((char, index, all) => index === 0 || all[index - 1] === ' ')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className={cx(
        'flex shrink-0 items-center justify-center overflow-hidden font-extrabold text-brand-100 transition-[border-radius,box-shadow] duration-150',
        active ? 'rounded-2xl shadow-glow ring-2 ring-brand-300' : 'rounded-[1.4rem] hover:rounded-2xl',
        !group.icon && 'bg-linear-to-br from-brand-500 to-brand-700',
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {group.icon ? <img src={group.icon} alt="" className="size-full object-cover" /> : initials || '?'}
    </span>
  );
}

/**
 * Roda uma ação que fala com o servidor: marca "ocupado" e mostra o erro do backend como aviso.
 * Devolve true se deu certo.
 */
export function useAction(): { busy: boolean; run: (action: () => Promise<unknown>) => Promise<boolean> } {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      return true;
    } catch (error) {
      groups.notify(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

/** Lê uma imagem escolhida pela pessoa e devolve um ícone quadrado pequeno (data URL), pronto para enviar. */
export async function fileToIcon(file: File, size = 128): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const side = Math.min(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL('image/webp', 0.85);
}

export const when = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fieldLabel = 'grid gap-1.5 text-sm font-semibold';
export const selectClass = 'h-10 w-full rounded-xl border border-ink-600 bg-ink-900/70 px-3 text-sm text-fog-100 focus:border-brand-400 focus:outline-none';
