import { useEffect, useState } from 'react';
import { desktop, type UpdateStatus } from '../lib/desktop.ts';
import { dialogs } from '../lib/dialogs.ts';
import { Button, cx, Toggle } from './ui.tsx';

const DOWNLOAD_PAGE = 'https://murilloglm.github.io/Shereroon/';

function bytes(value: number | null | undefined): string {
  if (!value || value <= 0) return '';
  if (value >= 1024 * 1024) {
    const megabytes = value / (1024 * 1024);
    return `${megabytes.toLocaleString('pt-BR', { minimumFractionDigits: megabytes < 10 ? 1 : 0, maximumFractionDigits: megabytes < 10 ? 1 : 0 })} MB`;
  }
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function when(at: number | null | undefined): string {
  if (!at) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} min`;
  return new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function headline(status: UpdateStatus | null): string {
  if (!status) return 'Consultando…';
  const version = status.version ? `a versão ${status.version}` : 'uma versão nova';
  switch (status.state) {
    case 'verificando':
      return 'Procurando uma versão nova…';
    case 'atualizado':
      return 'Você está na versão mais recente.';
    case 'disponivel':
      return `Há ${version} disponível.`;
    case 'baixando':
      return `Baixando ${version}…`;
    case 'conferindo':
      return 'Conferindo a assinatura e a integridade do arquivo…';
    case 'pronta':
      return status.installOnQuit ? `${capital(version)} será instalada quando você fechar o aplicativo.` : `${capital(version)} está pronta para instalar.`;
    case 'instalando':
      return 'Fechando para instalar…';
    case 'recusada':
      return 'A atualização foi recusada.';
    case 'erro':
      return 'Não foi possível concluir agora.';
    case 'ocioso':
      return 'A atualização automática está ativa.';
    default:
      return 'Esta cópia não se atualiza sozinha.';
  }
}

/**
 * Configurações → Atualizações (só no aplicativo para Windows). Mostra a versão instalada, procura versões
 * novas, mostra as novidades, baixa quando a pessoa pede (com progresso) e reinicia para instalar, ou deixa
 * para quando ela fechar o aplicativo. Reiniciar numa chamada ou transmissão pede confirmação antes.
 */
export function UpdateSettings() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    void desktop.update.status().then(setStatus);
    return desktop.update.onStatus(setStatus);
  }, []);
  if (!desktop) return null;
  const update = desktop.update;
  const current = status?.currentVersion ?? desktop.config.version;
  const supported = status?.supported !== false && status?.state !== 'indisponivel';
  const state = status?.state;
  const run = (task: () => Promise<unknown> | void) => async () => {
    setBusy(true);
    try {
      const next = await task();
      if (next && typeof next === 'object' && 'state' in next) setStatus(next as UpdateStatus);
    } finally {
      setBusy(false);
    }
  };

  const restart = run(async () => {
    const result = await update.restart(false);
    if (!result || result.ok || !result.needsConfirm) return;
    const ok = await dialogs.confirm({
      title: 'Reiniciar e atualizar agora?',
      message:
        result.needsConfirm === 'transmissao'
          ? 'Você está transmitindo. O Cosmic Night vai fechar para instalar: a transmissão termina e você sai da chamada até ele abrir de novo.'
          : 'Você está numa chamada. O Cosmic Night vai fechar para instalar e você sai da chamada até ele abrir de novo.',
      confirmLabel: 'Reiniciar e atualizar',
      cancelLabel: 'Agora não',
      tone: 'perigo',
    });
    if (ok) await update.restart(true);
  });

  const percent = Math.max(0, Math.min(100, status?.percent ?? 0));
  const notes = status?.notes?.trim();
  const showNotes = Boolean(notes) && (state === 'disponivel' || state === 'baixando' || state === 'conferindo' || state === 'pronta');

  return (
    <div className="grid gap-3" data-testid="app-update" data-state={state ?? ''}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            Versão instalada: <span data-testid="update-current">{current}</span>
          </p>
          <p className="text-[13px] leading-snug text-fog-400" data-testid="update-headline">
            {headline(status)}
            {status?.lastCheck && (state === 'atualizado' || state === 'disponivel') ? ` Última verificação ${when(status.lastCheck)}.` : ''}
          </p>
        </div>
        {supported && state !== 'pronta' && state !== 'instalando' && (
          <Button
            variant="quiet"
            size="sm"
            data-testid="update-check"
            disabled={busy || state === 'verificando' || state === 'baixando' || state === 'conferindo'}
            onClick={run(() => update.check())}
          >
            {state === 'verificando' ? 'Procurando…' : 'Procurar atualizações'}
          </Button>
        )}
      </div>

      {!supported && status?.reason && (
        <p className="rounded-lg border border-ink-600 bg-ink-800/80 px-3 py-2 text-[13px] leading-snug text-fog-300" data-testid="update-reason">
          {status.reason}{' '}
          <a className="font-semibold text-neon-300 underline-offset-2 hover:underline" href={DOWNLOAD_PAGE} target="_blank" rel="noreferrer">
            Abrir a página de downloads
          </a>
        </p>
      )}

      {showNotes && (
        <div className="grid gap-1.5 rounded-xl border border-ink-600 bg-ink-900/60 p-3" data-testid="update-notes">
          <p className="text-[13px] font-bold text-fog-200">
            Novidades{status?.releaseName ? ` · ${status.releaseName}` : status?.version ? ` da versão ${status.version}` : ''}
            {status?.size ? <span className="font-normal text-fog-500"> · {bytes(status.size)}</span> : null}
          </p>
          <p className="max-h-40 overflow-y-auto text-[13px] leading-relaxed whitespace-pre-line text-fog-300">{notes}</p>
        </div>
      )}

      {(state === 'baixando' || state === 'conferindo') && (
        <div className="grid gap-1.5">
          <div
            role="progressbar"
            aria-label="Download da atualização"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            data-testid="update-progress"
            className="h-2 overflow-hidden rounded-full bg-ink-700"
          >
            <div
              className={cx('h-full rounded-full bg-linear-to-r from-brand-500 to-neon-400 transition-[width] duration-300 motion-reduce:transition-none', state === 'conferindo' && 'animate-pulse motion-reduce:animate-none')}
              style={{ width: `${state === 'conferindo' ? 100 : percent}%` }}
            />
          </div>
          <p className="text-xs text-fog-500">
            {state === 'conferindo'
              ? 'Conferindo…'
              : `${percent}%${status?.total ? ` · ${bytes(status.transferred)} de ${bytes(status.total)}` : ''}${status?.bytesPerSecond ? ` · ${bytes(status.bytesPerSecond)}/s` : ''}`}
          </p>
        </div>
      )}

      {state === 'disponivel' && update.download && (
        <div>
          <Button variant="primary" size="sm" data-testid="update-download" disabled={busy} onClick={run(() => update.download!())}>
            Baixar atualização
          </Button>
        </div>
      )}

      {state === 'pronta' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" data-testid="update-restart" disabled={busy} onClick={restart}>
            Reiniciar e atualizar
          </Button>
          {update.later && !status?.installOnQuit && (
            <Button variant="quiet" size="sm" data-testid="update-later" disabled={busy} onClick={run(() => update.later!())}>
              Instalar depois
            </Button>
          )}
        </div>
      )}

      {status?.message && (
        <div
          className={cx(
            'flex items-start gap-3 rounded-lg border px-3 py-2 text-[13px] leading-snug',
            status.messageKind === 'erro' ? 'border-live-500/40 bg-live-500/10 text-live-300' : status.messageKind === 'offline' ? 'border-warn-400/40 bg-warn-400/10 text-warn-400' : 'border-ink-600 bg-ink-800/80 text-fog-300',
          )}
          role={status.messageKind === 'erro' ? 'alert' : 'status'}
          data-testid="update-message"
        >
          <span className="min-w-0 flex-1">{status.message}</span>
          {update.dismiss && (
            <button type="button" className="shrink-0 font-semibold text-fog-200 hover:text-white" data-testid="update-dismiss" onClick={run(() => update.dismiss!())}>
              Limpar
            </button>
          )}
        </div>
      )}

      {supported && update.setAutoCheck && typeof status?.autoCheck === 'boolean' && (
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Procurar atualizações automaticamente</p>
            <p className="text-[13px] leading-snug text-fog-400">Ao abrir e a cada 6 horas. Nada é baixado nem instalado sem você pedir.</p>
          </div>
          <Toggle on={status.autoCheck} label="Procurar atualizações automaticamente" onChange={(on) => void update.setAutoCheck!(on).then(setStatus)} />
        </div>
      )}
    </div>
  );
}
