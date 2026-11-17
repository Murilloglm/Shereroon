import { ChartColumn, Clock, Layers, Monitor, Signal } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatBitrate, formatFps, formatMs, formatPercent, formatSize } from '../../lib/format.ts';
import type { Limitation } from '../../lib/quality.ts';
import type { RoomSession } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { Card, cx } from '../ui.tsx';

type Tone = 'ok' | 'aviso' | 'ruim' | 'neutro';

const TONES: Record<Tone, string> = {
  ok: 'text-ok-400',
  aviso: 'text-warn-400',
  ruim: 'text-live-400',
  neutro: 'text-fog-300',
};

/** Verde, amarelo ou vermelho conforme os limites; cinza quando não há valor medido. */
function grade(value: number | null | undefined, warn: number, bad: number): Tone {
  if (value == null) return 'neutro';
  return value >= bad ? 'ruim' : value >= warn ? 'aviso' : 'ok';
}

const LIMITATION: Record<Limitation, string> = {
  none: 'Nenhuma',
  cpu: 'CPU/GPU no limite',
  bandwidth: 'Conexão de envio',
  other: 'Outra',
};

function engine(name: string | null, hardware: boolean | null): string {
  const kind = hardware === true ? 'hardware' : hardware === false ? 'software' : null;
  if (!name && !kind) return '—';
  return [name, kind && `(${kind})`].filter(Boolean).join(' ');
}

function Row({ icon, label, value, tone, testId }: { icon: ReactNode; label: string; value: string; tone: Tone; testId?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-ink-700/70 py-2.5 last:border-b-0">
      <span className="text-brand-300">{icon}</span>
      <span className="flex-1 text-[15px]">{label}</span>
      <span className={cx('text-[15px] font-extrabold', TONES[tone])} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-fog-400">{label}</dt>
      <dd className="text-right font-semibold text-fog-100">{value}</dd>
    </>
  );
}

export function StatsCard({ session, className }: { session: RoomSession; className?: string }) {
  const publisher = useStore(session.store, (state) => state.publisher);
  const viewer = useStore(session.store, (state) => state.viewer);
  const selected = useStore(session.store, (state) => state.selected);
  const identity = useStore(session.store, (state) => state.identity);

  // Mostra o lado que está em destaque no player: a própria transmissão ou a de outra pessoa.
  const watchingOther = selected !== null && selected !== identity;
  const role = watchingOther ? 'assistindo' : publisher ? 'transmitindo' : null;
  const icon = 'size-[18px]';

  return (
    <Card className={cx('px-4 py-3.5', className)} data-testid="stats-card" data-role={role ?? 'nenhum'}>
      <h2 className="flex items-center gap-2.5 text-[17px] font-extrabold">
        <ChartColumn className="size-5 text-brand-300" aria-hidden="true" />
        Estatísticas da transmissão
      </h2>

      {role === null && (
        <p className="mt-3 text-sm leading-snug text-fog-400">
          Sem transmissão em andamento. Os números aparecem aqui assim que houver vídeo — sempre os medidos, não os
          pedidos.
        </p>
      )}

      {role === 'transmitindo' && publisher && (
        <>
          <div className="mt-2">
            <Row
              icon={<Layers className={icon} />}
              label="Taxa de bits"
              value={formatBitrate(publisher.stats.bitrateKbps)}
              tone={publisher.stats.bitrateKbps == null ? 'neutro' : 'ok'}
              testId="stat-bitrate"
            />
            <Row
              icon={<Clock className={icon} />}
              label="Latência até o servidor"
              value={formatMs(publisher.stats.rttMs)}
              tone={grade(publisher.stats.rttMs, 80, 150)}
              testId="stat-latency"
            />
            <Row
              icon={<Signal className={icon} />}
              label="Perda de pacotes"
              value={formatPercent(publisher.stats.lossPct)}
              tone={grade(publisher.stats.lossPct, 1, 5)}
              testId="stat-loss"
            />
            <Row
              icon={<Monitor className={icon} />}
              label="FPS atual"
              value={formatFps(publisher.stats.fps)}
              tone={publisher.stats.fps == null ? 'neutro' : 'ok'}
              testId="stat-fps"
            />
          </div>
          <details className="mt-2 text-sm">
            <summary className="font-semibold text-fog-400 hover:text-fog-100">Detalhes técnicos</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <Detail label="Resolução enviada" value={formatSize(publisher.stats.width, publisher.stats.height)} />
              <Detail
                label="Captura"
                value={`${formatSize(publisher.stats.captureWidth, publisher.stats.captureHeight)} a ${formatFps(publisher.stats.captureFps)}`}
              />
              <Detail label="Pico de captura (20 s)" value={formatFps(publisher.captureFpsPeak)} />
              <Detail label="Codec" value={publisher.stats.codec ?? '—'} />
              <Detail label="Codificador" value={engine(publisher.stats.encoder, publisher.stats.hardware)} />
              <Detail label="Tempo por quadro" value={formatMs(publisher.stats.encodeMs)} />
              <Detail label="Limitação" value={LIMITATION[publisher.stats.limitation]} />
              <Detail label="Banda de envio estimada" value={formatBitrate(publisher.stats.availableKbps)} />
              <Detail label="Retransmissões" value={formatPercent(publisher.stats.retransmitPct)} />
              <Detail
                label="Camadas"
                value={publisher.stats.scalability ? `${publisher.stats.layers} (${publisher.stats.scalability})` : String(publisher.stats.layers)}
              />
            </dl>
          </details>
        </>
      )}

      {role === 'assistindo' && !viewer && <p className="mt-3 text-sm text-fog-400">Medindo a transmissão…</p>}

      {role === 'assistindo' && viewer && (
        <>
          <div className="mt-2">
            <Row
              icon={<Layers className={icon} />}
              label="Taxa de bits"
              value={formatBitrate(viewer.stats.bitrateKbps)}
              tone={viewer.stats.bitrateKbps == null ? 'neutro' : 'ok'}
              testId="stat-bitrate"
            />
            <Row
              icon={<Clock className={icon} />}
              label="Atraso estimado"
              value={formatMs(viewer.delayMs)}
              tone={grade(viewer.delayMs, 150, 300)}
              testId="stat-latency"
            />
            <Row
              icon={<Signal className={icon} />}
              label="Perda de pacotes"
              value={formatPercent(viewer.stats.lossPct)}
              tone={grade(viewer.stats.lossPct, 1, 5)}
              testId="stat-loss"
            />
            <Row
              icon={<Monitor className={icon} />}
              label="FPS atual"
              value={formatFps(viewer.stats.fps)}
              tone={viewer.stats.fps == null ? 'neutro' : 'ok'}
              testId="stat-fps"
            />
          </div>
          <details className="mt-2 text-sm">
            <summary className="font-semibold text-fog-400 hover:text-fog-100">Detalhes técnicos</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <Detail label="Resolução recebida" value={formatSize(viewer.stats.width, viewer.stats.height)} />
              <Detail label="FPS exibido na sua tela" value={formatFps(viewer.presentedFps)} />
              <Detail label="Codec" value={viewer.stats.codec ?? '—'} />
              <Detail label="Decodificador" value={engine(viewer.stats.decoder, viewer.stats.hardware)} />
              <Detail label="Rede até o servidor (ida e volta)" value={formatMs(viewer.stats.rttMs)} />
              <Detail label="Espera no buffer" value={formatMs(viewer.stats.bufferMs)} />
              <Detail label="Decodificação por quadro" value={formatMs(viewer.stats.decodeMs)} />
              <Detail label="Variação da rede (jitter)" value={formatMs(viewer.stats.jitterMs)} />
              <Detail
                label="Quadros descartados"
                value={viewer.stats.droppedPerSecond == null ? '—' : `${viewer.stats.droppedPerSecond.toFixed(1).replace('.', ',')}/s`}
              />
              <Detail label="Travamentos" value={viewer.stats.freezes == null ? '—' : String(viewer.stats.freezes)} />
              {viewer.sync.audioDelayMs != null && (
                <>
                  <Detail label="Atraso do som na origem" value={formatMs(viewer.sync.audioDelayMs)} />
                  <Detail
                    label="Imagem segurada para sincronizar"
                    value={viewer.sync.supported ? formatMs(viewer.sync.compensationMs) : 'navegador sem suporte'}
                  />
                </>
              )}
              {viewer.uplink && (
                <>
                  <Detail
                    label="Na origem"
                    value={`${formatSize(viewer.uplink.width, viewer.uplink.height)} a ${formatFps(viewer.uplink.fps)}`}
                  />
                  <Detail
                    label={viewer.uplink.mode === 'manual' ? 'Pedido por quem transmite' : 'Alvo automático na origem'}
                    value={`${viewer.uplink.requestedHeight}p a ${viewer.uplink.requestedFps} FPS`}
                  />
                  <Detail label="Limitação na origem" value={LIMITATION[viewer.uplink.limitation]} />
                </>
              )}
            </dl>
            <p className="mt-2 text-xs leading-snug text-fog-500">
              O atraso é uma soma de partes medidas (codificação, rede nos dois trechos, buffer e decodificação), não
              uma medição direta de ponta a ponta.
            </p>
          </details>
        </>
      )}
    </Card>
  );
}
