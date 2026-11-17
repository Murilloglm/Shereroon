import { RotateCcw } from 'lucide-react';
import { MAX_PERSON_VOLUME, type RoomSession } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { cx, Slider } from '../ui.tsx';

/**
 * Volume de uma pessoa (ou de uma transmissão) só para quem ouve, de 0% a 200%. Acima de 100% o som é
 * reforçado com limitador, para ouvir quem tem microfone baixo sem distorcer.
 */
export function PersonVolume({
  session,
  volumeKey,
  name,
  className,
}: {
  session: RoomSession;
  /** `voz:<id>` para a voz da pessoa, `<id>` para o som da transmissão dela. */
  volumeKey: string;
  name: string;
  className?: string;
}) {
  const volume = useStore(session.store, (state) => state.volumes[volumeKey] ?? 1);
  const percent = Math.round(volume * 100);
  const max = MAX_PERSON_VOLUME * 100;
  return (
    <div className={cx('grid gap-1.5', className)} data-testid="person-volume" data-key={volumeKey}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-semibold text-fog-100">{name}</span>
        <span className={cx('shrink-0 font-extrabold tabular-nums', percent > 100 ? 'text-neon-300' : percent === 0 ? 'text-live-300' : 'text-fog-200')} data-testid="person-volume-value">
          {percent}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Slider label={`Volume de ${name}`} min={0} max={max} step={5} value={percent} onChange={(value) => session.setVolume(volumeKey, value / 100)} className="w-full" />
          {/* Marca do volume normal (100%). */}
          <span className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-fog-400/60" style={{ left: `${(100 / max) * 100}%` }} aria-hidden="true" />
        </div>
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-fog-400 hover:bg-ink-700 hover:text-fog-100 disabled:opacity-35"
          disabled={percent === 100}
          onClick={() => session.setVolume(volumeKey, 1)}
          aria-label={`Voltar o volume de ${name} para 100%`}
          title="Voltar para 100%"
          data-testid="person-volume-reset"
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>
      {percent > 100 && <p className="text-xs leading-snug text-fog-500">Acima de 100% o som é reforçado com proteção contra distorção.</p>}
    </div>
  );
}
