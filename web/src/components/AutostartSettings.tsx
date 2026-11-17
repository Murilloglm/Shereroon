import { useEffect, useState } from 'react';
import { desktop, type AutostartState } from '../lib/desktop.ts';
import { Toggle } from './ui.tsx';

/**
 * "Iniciar o Cosmic Night com o Windows" (e minimizado na bandeja). Só existe no aplicativo instalado; vem
 * desligado e só liga quando a pessoa mexe. Não pede administrador: vale só para este usuário do Windows.
 */
export function AutostartSettings() {
  const [state, setState] = useState<AutostartState | null>(null);
  useEffect(() => {
    void desktop?.autostart?.get().then(setState);
  }, []);
  if (!desktop?.autostart || !state?.supported) return null;
  const apply = (patch: Partial<AutostartState>) => void desktop!.autostart!.set({ enabled: patch.enabled ?? state.enabled, minimized: patch.minimized ?? state.minimized }).then(setState);
  return (
    <div className="grid gap-3" data-testid="autostart">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Iniciar o Cosmic Night com o Windows</p>
          <p className="text-[13px] leading-snug text-fog-400">Abre sozinho quando você entra no Windows. Só para este usuário, sem precisar de administrador.</p>
        </div>
        <Toggle on={state.enabled} label="Iniciar com o Windows" onChange={(on) => apply({ enabled: on })} />
      </div>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className={state.enabled ? 'text-sm font-semibold' : 'text-sm font-semibold text-fog-500'}>Iniciar minimizado</p>
          <p className="text-[13px] leading-snug text-fog-400">Fica só no ícone perto do relógio até você abrir.</p>
        </div>
        <Toggle on={state.minimized} label="Iniciar minimizado" disabled={!state.enabled} onChange={(on) => apply({ minimized: on })} />
      </div>
    </div>
  );
}
