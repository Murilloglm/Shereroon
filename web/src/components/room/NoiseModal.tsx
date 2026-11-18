import { AudioWaveform, Circle, LoaderCircle, Play, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { audioContext } from '../../lib/audio.ts';
import { noiseDelayMs, NOISE_LEVELS, type NoiseCapture, type NoiseStats } from '../../lib/denoise.ts';
import { defaultSetting, noiseAdvice, type ActiveEngine, type NoiseControl } from '../../lib/noise-control.ts';
import { useStore } from '../../lib/store.ts';
import { Button, Chip, cx, Modal, Notice, Toggle } from '../ui.tsx';

const CAPTURE_SECONDS = 4;
const decimal = (value: number, digits = 1) => value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function statusText(on: boolean, engine: ActiveEngine | undefined, isMic: boolean): string {
  if (!on) return 'Desligada. Esta fonte é transmitida como está.';
  if (engine === 'ia') return 'Filtrando agora com o modelo de IA (RNNoise), neste computador. Nenhum áudio é enviado para fora para ser processado.';
  if (engine === 'convencional') return 'Filtrando agora com supressão convencional: o modelo de IA não pôde ser carregado neste navegador.';
  if (engine === 'navegador') return 'O modelo de IA não pôde ser carregado. O microfone está usando a supressão de ruído convencional do navegador.';
  return isMic
    ? 'Ligada. Começa a filtrar quando você ligar o microfone.'
    : 'Ligada. Começa a filtrar quando este aplicativo estiver ligado no mixer.';
}

/** Barra horizontal de 0 a 1 com o valor ao lado. */
function Gauge({ label, about, fill, value, tone = 'brand', testId, data }: {
  label: string;
  about: string;
  fill: number;
  value: string;
  tone?: 'brand' | 'ok';
  testId?: string;
  data?: number;
}) {
  return (
    <div className="grid grid-cols-[9.5rem_1fr_4.5rem] items-center gap-3" data-testid={testId} data-value={data}>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs leading-tight text-fog-500">{about}</p>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-ink-700" aria-hidden="true">
        <div
          className={cx('h-full rounded-full transition-[width] duration-200', tone === 'ok' ? 'bg-ok-400' : 'bg-brand-400')}
          style={{ width: `${Math.round(Math.min(1, Math.max(0, fill)) * 100)}%` }}
        />
      </div>
      <p className="text-right text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

/** Toca uma gravação nas caixas deste computador (não vai para a sala). Devolve como parar. */
function playSamples(samples: Float32Array<ArrayBuffer>, onEnd: () => void): () => void {
  const context = audioContext();
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = onEnd;
  source.start();
  return () => {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // já tinha terminado
    }
    source.disconnect();
  };
}

export function NoiseModal({ control, sourceKey, name, onClose }: { control: NoiseControl; sourceKey: string; name: string; onClose: () => void }) {
  const setting = useStore(control.store, (state) => state.settings[sourceKey]) ?? defaultSetting(sourceKey);
  const engine = useStore(control.store, (state) => state.engines[sourceKey]);
  const allOff = useStore(control.store, (state) => state.allOff);
  const original = useStore(control.store, (state) => state.original[sourceKey] === true);
  const advice = noiseAdvice(sourceKey);
  const [agreed, setAgreed] = useState(false);
  const [stats, setStats] = useState<NoiseStats | null>(null);
  const [usage, setUsage] = useState({ filters: 0, cpuPct: 0 });
  const [recording, setRecording] = useState(false);
  const [capture, setCapture] = useState<NoiseCapture | null>(null);
  const [playing, setPlaying] = useState<'dry' | 'wet' | null>(null);
  const stopPlayback = useRef<(() => void) | null>(null);

  const measurable = engine === 'ia' || engine === 'convencional';
  const locked = advice.kind === 'risco' && !setting.on && !agreed;

  useEffect(() => {
    const read = () => {
      setStats(control.stats(sourceKey));
      setUsage(control.usage());
    };
    read();
    const timer = setInterval(read, 250);
    return () => clearInterval(timer);
  }, [control, sourceKey]);

  // Fechou o painel: a comparação ao vivo termina e a gravação é descartada.
  useEffect(
    () => () => {
      stopPlayback.current?.();
      control.setOriginal(sourceKey, false);
    },
    [control, sourceKey],
  );

  const record = async () => {
    const pending = control.capture(sourceKey, CAPTURE_SECONDS);
    if (!pending) return;
    stopPlayback.current?.();
    setPlaying(null);
    setCapture(null);
    setRecording(true);
    setCapture(await pending);
    setRecording(false);
  };

  const play = (which: 'dry' | 'wet') => {
    stopPlayback.current?.();
    stopPlayback.current = null;
    if (playing === which || !capture) {
      setPlaying(null);
      return;
    }
    setPlaying(which);
    stopPlayback.current = playSamples(capture[which], () => setPlaying(null));
  };

  return (
    <Modal title="Supressão de Ruído IA" onClose={onClose}>
      <div className="grid gap-5" data-testid="noise-modal" data-source={sourceKey} data-engine={engine ?? ''}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-extrabold">{name}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-fog-400" data-testid="noise-status">
              {statusText(setting.on, engine, sourceKey === 'mic')}
            </p>
          </div>
          <Toggle on={setting.on} disabled={locked} label={`Supressão de ruído em ${name}`} onChange={(on) => control.setOn(sourceKey, on)} />
        </div>

        <Notice tone={advice.kind === 'risco' || advice.kind === 'chamada' ? 'aviso' : 'info'}>{advice.text}</Notice>
        {advice.kind === 'risco' && !setting.on && (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" className="size-4 accent-brand-500" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} data-testid="noise-agree" />
            Entendi, quero ligar mesmo assim nesta fonte
          </label>
        )}
        {allOff && <Notice tone="aviso">O interruptor geral está ligado: toda a supressão de ruído está em pausa e as fontes saem com o som original.</Notice>}

        <section className="grid gap-2">
          <h3 className="text-sm font-extrabold">Intensidade</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {NOISE_LEVELS.map((level) => (
              <Chip key={level.value} selected={setting.level === level.value} onClick={() => control.setLevel(sourceKey, level.value)} data-testid={`noise-level-${level.value}`}>
                {level.name}
              </Chip>
            ))}
          </div>
          <p className="text-[13px] leading-snug text-fog-400">
            {NOISE_LEVELS.find((level) => level.value === setting.level)?.about} Trocar a intensidade não interrompe a transmissão.
          </p>
        </section>

        {setting.on && measurable && (
          <section className="grid gap-3 rounded-xl border border-ink-600 bg-ink-800/50 p-3.5">
            <h3 className="text-sm font-extrabold">Medição ao vivo</h3>
            {stats ? (
              <>
                <Gauge
                  testId="noise-input"
                  data={Math.round(stats.inputDb)}
                  label="Entrada"
                  about="nível que chega do aparelho"
                  fill={(stats.inputDb + 70) / 70}
                  value={stats.inputDb <= -119 ? 'silêncio' : `${decimal(stats.inputDb, 0)} dB`}
                />
                <Gauge
                  testId="noise-reduction"
                  data={Math.round(stats.reductionDb * 10) / 10}
                  label="Redução agora"
                  about="quanto o nível caiu no filtro"
                  fill={stats.reductionDb / 40}
                  value={`−${decimal(stats.reductionDb)} dB`}
                />
                <Gauge label="Ruído removido" about="nível do que foi tirado" fill={(stats.noiseDb + 90) / 90} value={stats.noiseDb <= -119 ? 'nenhum' : `${decimal(stats.noiseDb, 0)} dB`} />
                {stats.engine === 'ia' && (
                  <Gauge label="Voz detectada" about="segundo o modelo" tone="ok" fill={stats.voice} value={`${Math.round(stats.voice * 100)}%`} />
                )}
                {stats.engine === 'ia' && typeof stats.presence === 'number' && (
                  <Gauge
                    testId="noise-protection"
                    data={Math.round(stats.presence * 100)}
                    label="Voz protegida"
                    about="fala mantida mesmo no ruído"
                    tone="ok"
                    fill={stats.presence}
                    value={`${Math.round(stats.presence * 100)}%`}
                  />
                )}
                <p className="text-[13px] leading-snug text-fog-400" data-testid="noise-cpu" data-value={Math.round(stats.cpuPct * 100) / 100}>
                  Processamento medido: <b className="text-fog-100">{decimal(stats.cpuPct)}% de um núcleo</b> ({decimal(stats.msPerFrame, 2)} ms para cada 10 ms
                  de áudio). Atraso acrescentado a esta fonte: {noiseDelayMs(setting.level)} ms.
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-fog-400">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Aguardando a primeira medição…
              </p>
            )}
          </section>
        )}

        {setting.on && measurable && (
          <section className="grid gap-3">
            <h3 className="text-sm font-extrabold">Comparar original e processado</h3>
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Transmitir o original agora</p>
                <p className="text-[13px] leading-snug text-fog-400">
                  Enquanto estiver ligado, a sala ouve esta fonte sem filtro. A troca é instantânea, sem estalo e sem mudar o atraso.
                </p>
              </div>
              <Toggle on={original} label={`Transmitir o som original de ${name}`} onChange={(on) => control.setOriginal(sourceKey, on)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void record()} disabled={recording} data-testid="noise-record">
                {recording ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Circle className="size-3.5 fill-live-500 text-live-500" aria-hidden="true" />}
                {recording ? `Gravando ${CAPTURE_SECONDS} s…` : `Gravar ${CAPTURE_SECONDS} s para ouvir`}
              </Button>
              {capture && (
                <>
                  <Button size="sm" active={playing === 'dry'} onClick={() => play('dry')} data-testid="noise-play-dry">
                    {playing === 'dry' ? <Square className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
                    Original
                  </Button>
                  <Button size="sm" active={playing === 'wet'} onClick={() => play('wet')} data-testid="noise-play-wet">
                    {playing === 'wet' ? <Square className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
                    Com filtro
                  </Button>
                </>
              )}
            </div>
            <p className="text-xs leading-snug text-fog-500">
              A gravação toca só neste computador, fica na memória desta aba e é descartada ao fechar este painel. Nada é salvo nem enviado.
            </p>
          </section>
        )}
        {setting.on && engine === 'navegador' && <Notice>O navegador não informa quanto ruído remove, então aqui não há medição nem comparação.</Notice>}

        <section className="flex items-center gap-4 border-t border-ink-700 pt-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Desligar toda a supressão de ruído</p>
            <p className="text-[13px] leading-snug text-fog-400" data-testid="noise-usage">
              Interruptor geral, vale na hora para todas as fontes.{' '}
              {usage.filters === 0
                ? 'Nenhum filtro no ar agora.'
                : `${usage.filters} ${usage.filters === 1 ? 'filtro' : 'filtros'} no ar, usando ${decimal(usage.cpuPct)}% de um núcleo ao todo.`}
            </p>
          </div>
          <Toggle on={allOff} label="Desligar toda a supressão de ruído" onChange={(on) => control.setAllOff(on)} />
        </section>
      </div>
    </Modal>
  );
}

/** Botão "Supressão de Ruído IA" de uma fonte. Aceso quando o filtro dela está ligado. */
export function NoiseButton({ control, sourceKey, name, disabled, className }: {
  control: NoiseControl;
  sourceKey: string;
  name: string;
  disabled?: boolean;
  className?: string;
}) {
  const on = useStore(control.store, (state) => state.settings[sourceKey]?.on === true);
  const running = useStore(control.store, (state) => sourceKey in state.engines);
  const paused = useStore(control.store, (state) => state.allOff);
  const [open, setOpen] = useState(false);
  const label = `Supressão de Ruído IA de ${name}${on ? (paused ? ' (em pausa)' : running ? ' (filtrando)' : ' (ligada)') : ''}`;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        disabled={disabled}
        data-testid={`noise-button-${sourceKey}`}
        data-on={on}
        data-running={running}
        onClick={() => setOpen(true)}
        className={cx(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition-[background,border-color,box-shadow,color] duration-150 disabled:opacity-40',
          on && !paused
            ? 'border-brand-300 bg-brand-500/25 text-brand-100 shadow-glow'
            : on
              ? 'border-dashed border-brand-400 text-brand-200'
              : 'border-ink-600 text-fog-400 hover:border-ink-500 hover:text-fog-100',
          className,
        )}
      >
        <AudioWaveform className="size-4.5" aria-hidden="true" />
      </button>
      {open && createPortal(<NoiseModal control={control} sourceKey={sourceKey} name={name} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
