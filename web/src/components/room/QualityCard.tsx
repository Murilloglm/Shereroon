import { ChevronDown, ChevronUp, Gauge, Info, Monitor } from 'lucide-react';
import { useState } from 'react';
import { formatBitrate, formatFps, formatHeight } from '../../lib/format.ts';
import { FRAME_RATES, RESOLUTIONS } from '../../lib/quality.ts';
import type { RoomSession } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { Card, Chip, cx, Notice } from '../ui.tsx';

export function QualityCard({ session, className }: { session: RoomSession; className?: string }) {
  const quality = useStore(session.store, (state) => state.quality);
  const share = useStore(session.store, (state) => state.share);
  const publisher = useStore(session.store, (state) => state.publisher);
  const [open, setOpen] = useState(true);

  const manual = quality.mode === 'manual';
  const target = share.target;

  return (
    <Card className={cx('flex flex-col', className)} data-testid="quality-card">
      <button
        type="button"
        className="flex items-center justify-between gap-3 px-4 py-3.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-2.5 text-lg font-extrabold">
          <span className="rounded-md border border-brand-400/70 px-1 text-[11px] leading-5 font-black text-brand-300">HD</span>
          Qualidade
        </span>
        {open ? <ChevronUp className="size-5 text-fog-400" /> : <ChevronDown className="size-5 text-fog-400" />}
      </button>

      {open && (
        <div className="grid gap-4 px-4 pb-4">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
              Modo de qualidade
              <span title="Automático começa no melhor que a captura oferece e ajusta sozinho. Manual mantém o que você escolher e avisa quando o real ficar abaixo.">
                <Info className="size-4 text-fog-500" aria-hidden="true" />
              </span>
            </p>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-ink-600 bg-ink-800 p-1" role="radiogroup" aria-label="Modo de qualidade">
              {(['auto', 'manual'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={quality.mode === mode}
                  data-testid={`quality-mode-${mode}`}
                  onClick={() => void session.updateQuality({ mode })}
                  className={cx(
                    'h-9 rounded-lg text-sm font-bold transition-[background,box-shadow] duration-150',
                    quality.mode === mode
                      ? 'bg-linear-to-b from-brand-500 to-brand-700 text-on-accent shadow-glow'
                      : 'text-fog-300 hover:text-fog-100',
                  )}
                >
                  {mode === 'auto' ? 'Automático' : 'Manual'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-bold">
              <Monitor className="size-4 text-brand-300" aria-hidden="true" />
              Resolução
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {RESOLUTIONS.map((resolution) => (
                <Chip
                  key={resolution}
                  selected={manual && quality.resolution === resolution}
                  hinted={!manual && target?.height === resolution}
                  data-testid={`quality-res-${resolution}`}
                  onClick={() => void session.updateQuality({ mode: 'manual', resolution })}
                >
                  {resolution}p
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-bold">
              <Gauge className="size-4 text-brand-300" aria-hidden="true" />
              FPS (taxa de quadros)
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {FRAME_RATES.map((fps) => (
                <Chip
                  key={fps}
                  selected={manual && quality.fps === fps}
                  hinted={!manual && target?.fps === fps}
                  data-testid={`quality-fps-${fps}`}
                  onClick={() => void session.updateQuality({ mode: 'manual', fps })}
                >
                  {fps}
                </Chip>
              ))}
            </div>
          </div>

          {!share.active && (
            <p className="text-[13px] leading-snug text-fog-500">
              {manual
                ? 'Vale para a sua próxima transmissão. Dá para mudar com ela no ar.'
                : 'No automático, o site pede 1080p a 120 FPS e fica com o que a fonte, a sua CPU e a sua conexão entregarem. Os valores reais aparecem aqui.'}
            </p>
          )}

          {share.active && target && (
            <div className="grid gap-2" data-testid="quality-real">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-fog-400">{manual ? 'Pedido' : 'Alvo atual'}</dt>
                <dd className="text-right font-bold">
                  {target.height}p • {target.fps} FPS • até {formatBitrate(share.bitrateKbps)}
                </dd>
                <dt className="text-fog-400">Real</dt>
                <dd className="text-right font-bold text-ok-400" data-testid="quality-real-values">
                  {formatHeight(publisher?.stats.height)} • {formatFps(publisher?.stats.fps)} •{' '}
                  {formatBitrate(publisher?.stats.bitrateKbps)}
                </dd>
              </dl>
              {!manual && share.autoNote && <Notice tone="aviso">{share.autoNote}</Notice>}
              {publisher?.settling && <Notice>Estabilizando: o WebRTC sobe o bitrate aos poucos nos primeiros segundos.</Notice>}
              {publisher?.diagnosis.map((item) => (
                <Notice key={item.code} tone={item.level === 'aviso' ? 'aviso' : 'info'} data-testid={`diagnosis-${item.code}`}>
                  {item.message}
                </Notice>
              ))}
              {publisher && !publisher.settling && publisher.diagnosis.length === 0 && (
                <Notice tone="ok">A transmissão real está no nível {manual ? 'pedido' : 'do alvo atual'}.</Notice>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
