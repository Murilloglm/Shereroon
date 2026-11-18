import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { inputSettings, setInput, setInputProfile, type InputSettings } from '../../lib/input-settings.ts';
import { DEFAULT_MIC, type InputStats, type MicPipeline, type MicSettings } from '../../lib/mic.ts';
import { playMicRecording, recordMicTest } from '../../lib/mic-test.ts';
import type { RoomSession } from '../../lib/session.ts';
import { storage } from '../../lib/storage.ts';
import { useStore } from '../../lib/store.ts';
import { Button, cx, Notice, Slider, Toggle } from '../ui.tsx';

const profiles = [
  { id: 'isolation', name: 'Isolamento de voz', about: 'IA local para reduzir ruído, com sensibilidade ajustável.' },
  { id: 'studio', name: 'Estúdio', about: 'Sinal sem supressão, gate, ajuste automático ou cancelamento de eco. Use fones.' },
  { id: 'custom', name: 'Personalizado', about: 'Controle de sensibilidade, VAD, ganho e supressão.' },
] as const;
const position = (db: number) => Math.min(100, Math.max(0, (db + 100) / 100 * 100));

export function InputSensitivity({ session }: { session?: RoomSession }) {
  const settings = useStore(inputSettings, (s) => s);
  const currentMic = useSyncExternalStore(session?.store.subscribe ?? (() => () => {}), () => session?.store.get().mic ?? null);
  const [stats, setStats] = useState<InputStats | null>(null);
  const [recording, setRecording] = useState(false), [capture, setCapture] = useState<Awaited<ReturnType<typeof recordMicTest>> | null>(null);
  const [error, setError] = useState(''), [headphones, setHeadphones] = useState(false);
  const [gain, setGain] = useState(() => storage.get<MicSettings>('shareroom:microfone', DEFAULT_MIC).gain);
  const [device, setDevice] = useState(() => storage.get<MicSettings>('shareroom:microfone', DEFAULT_MIC).deviceId);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const shownGain = currentMic?.gain ?? gain;
  const shownDevice = currentMic ? currentMic.deviceId : device;
  const pipeline = useRef<MicPipeline | null>(null), abort = useRef<AbortController | null>(null), playback = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const [micOn, setMicOn] = useState(session?.store.get().micOn ?? false);
  const stop = () => { abort.current?.abort(); abort.current = null; pipeline.current = null; playback.current?.(); playback.current = null; };
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => {
      const mic = pipeline.current ?? session?.mic;
      setStats(mic?.active ? mic.stats : null);
    }, 50);
    const unsubscribe = session?.store.subscribe(() => {
      const state = session.store.get(); setMicOn(state.micOn);
      if (state.micOn || state.micBusy || state.phase === 'ended') { stop(); setRecording(false); }
    });
    void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
    return () => { mounted.current = false; clearInterval(timer); unsubscribe?.(); stop(); };
  }, [session]);
  const updateMic = (patch: Partial<MicSettings>) => {
    if (session) void session.updateMic(patch);
    else storage.set('shareroom:microfone', { ...DEFAULT_MIC, ...storage.get<Partial<MicSettings>>('shareroom:microfone', {}), ...patch });
  };
  const start = async () => {
    stop(); setError(''); setCapture(null); setRecording(true);
    const controller = new AbortController(); abort.current = controller;
    try {
      session?.prepareMicTest();
      const result = await recordMicTest(controller.signal, (mic) => { pipeline.current = mic; });
      if (mounted.current && !controller.signal.aborted) setCapture(result);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : 'Não foi possível testar o microfone.');
    } finally {
      if (abort.current === controller) { abort.current = null; pipeline.current = null; if (mounted.current) setRecording(false); }
      void navigator.mediaDevices?.enumerateDevices().then((items) => { if (mounted.current) setDevices(items); }).catch(() => {});
    }
  };
  const advanced = (key: keyof InputSettings, label: string, value: number, min: number, max: number, unit: string, step = 1) => (
    <label className="grid gap-2 text-sm"><span>{label} <strong className="float-right text-brand-200">{value}{unit}</strong></span>
      <Slider label={label} value={value} min={min} max={max} step={step} onChange={(next) => setInput({ [key]: next })} />
    </label>
  );
  return (
    <section className="grid gap-4 rounded-2xl border border-brand-400/20 bg-ink-950 p-4 sm:p-5" data-testid="input-sensitivity">
      <h3 className="text-base font-extrabold">Sensibilidade de Entrada</h3>
      <fieldset disabled={recording} className="grid gap-4 disabled:opacity-60">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Perfil de entrada">
          {profiles.map((profile) => <button key={profile.id} type="button" role="radio" aria-checked={settings.profile === profile.id} data-testid={`input-profile-${profile.id}`} onClick={() => setInputProfile(profile.id)} className={cx('rounded-xl border p-3 text-left transition-colors', settings.profile === profile.id ? 'border-brand-300 bg-brand-500/15' : 'border-ink-600 hover:border-brand-400')}>
            <span className="block text-sm font-bold">{profile.name}</span><span className="mt-1 block text-xs text-fog-400">{profile.about}</span>
          </button>)}
        </div>
        <label className="grid gap-2 text-sm">Microfone
          <select aria-label="Microfone de entrada" className="h-10 min-w-0 rounded-xl border border-ink-600 bg-ink-900 px-3" value={shownDevice ?? ''} onChange={(event) => { const id = event.target.value || null; setDevice(id); updateMic({ deviceId: id }); }}>
            <option value="">Padrão do sistema</option>{devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microfone'}</option>)}
          </select>
        </label>
        {settings.profile !== 'studio' && <>
          <div className="flex items-center justify-between gap-3 text-sm"><span>Ativar sensibilidade de entrada</span><Toggle label="Ativar sensibilidade de entrada" on={settings.enabled} onChange={(enabled) => setInput({ enabled })} /></div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Modo de sensibilidade">
            {(['auto', 'manual'] as const).map((mode) => <Button key={mode} aria-pressed={settings.mode === mode} variant={settings.mode === mode ? 'primary' : 'outline'} onClick={() => setInput({ mode, enabled: true })}>{mode === 'auto' ? 'Automático' : 'Manual'}</Button>)}
          </div>
          {advanced('thresholdDb', 'Limiar de entrada', settings.thresholdDb, -80, -10, ' dBFS')}
          <p className="text-xs text-fog-400">{settings.mode === 'auto' ? 'No automático, o limiar efetivo acompanha o ruído e a atividade de voz. O valor manual fica guardado.' : 'Valores mais negativos captam vozes mais baixas e também mais ruído.'} Gate controla quando o áudio passa; a IA reduz o ruído do sinal.</p>
        </>}
        <label className="grid gap-2 text-sm"><span>Ganho de entrada <strong className="float-right">{Math.round(shownGain * 100)}%</strong></span><Slider label="Ganho de entrada" value={Math.round(shownGain * 100)} onChange={(value) => { setGain(value / 100); updateMic({ gain: value / 100 }); }} /></label>
        {settings.profile === 'custom' && <details className="rounded-xl border border-ink-600 p-3" data-testid="input-advanced"><summary className="cursor-pointer text-sm font-bold">Controles avançados</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm">Supressão de ruído<select aria-label="Supressão de ruído da entrada" className="h-10 rounded-xl bg-ink-900 px-2" value={settings.noise} onChange={(e) => setInput({ noise: e.target.value as InputSettings['noise'] })}>{[['legacy','Manter configuração atual'],['off','Desligada'],['browser','Convencional do navegador'],['leve','IA leve'],['equilibrado','IA equilibrada'],['forte','IA forte'],['voz','IA: voz prioritária']].map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <div className="flex items-center justify-between gap-2 text-sm">Detecção de atividade de voz (VAD)<Toggle label="Detecção de atividade de voz" on={settings.vad} onChange={(vad) => setInput({ vad })} /></div>
          {advanced('vadThreshold', 'Confiança do VAD', settings.vadThreshold, 0.1, 0.9, '', 0.05)}
          {advanced('hysteresisDb', 'Histerese', settings.hysteresisDb, 2, 15, ' dB')}
          {advanced('holdMs', 'Manter aberto (hold)', settings.holdMs, 40, 1000, ' ms')}
          {advanced('releaseMs', 'Liberação (release)', settings.releaseMs, 20, 500, ' ms')}
          {advanced('attackMs', 'Abertura suave', settings.attackMs, 1, 20, ' ms')}
          {advanced('preRollMs', 'Pré-abertura (pre-roll)', settings.preRollMs, 0, 80, ' ms')}
        </div></details>}
      </fieldset>
      <div className="grid gap-2" data-testid="input-meter" data-open={stats?.open === true}>
        <div className="flex flex-wrap justify-between gap-2 text-xs"><span>Nível real: <strong>{stats ? stats.rawDb.toFixed(1) : '—'} dBFS</strong></span><span>Limiar efetivo: <strong>{(stats?.thresholdDb ?? settings.thresholdDb).toFixed(1)} dBFS</strong></span></div>
        <div className="relative h-4 overflow-hidden rounded-full bg-ink-700" role="meter" aria-label="Nível do microfone" aria-valuemin={-100} aria-valuemax={0} aria-valuenow={stats?.rawDb ?? -100}>
          <div className="h-full bg-linear-to-r from-brand-500 to-neon-300 transition-[width] duration-75 motion-reduce:transition-none" style={{ width: `${position(stats?.rawDb ?? -100)}%` }} />
          <span className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${position(stats?.thresholdDb ?? settings.thresholdDb)}%` }} />
        </div>
        <p className="text-xs text-fog-400">Sinal processado: {stats ? stats.inputDb.toFixed(1) : '—'} dBFS. O limiar atua sobre esse sinal, após o ganho e a supressão.</p>
        <p className={cx('text-xs font-semibold', stats?.open ? 'text-neon-300' : 'text-fog-400')} role="status">{stats ? stats.open ? recording ? 'A transmissão seria ativada' : micOn ? 'Transmitindo' : 'Microfone da chamada desligado' : 'Abaixo do limiar' : 'Inicie o teste ou ligue o microfone para medir'}</p>
      </div>
      <div className="flex flex-wrap gap-2"><Button onClick={() => void start()} disabled={recording || micOn} data-testid="input-test">Testar microfone</Button>{recording && <Button variant="outline" onClick={() => { stop(); setRecording(false); }}>Encerrar teste</Button>}</div>
      {micOn && <p className="text-xs text-fog-400">Desligue o microfone da chamada para gravar o teste sem enviar sua comparação aos participantes.</p>}
      {recording && <p className="text-sm text-brand-200">Capturando cerca de 3 segundos. Fale normalmente; nada é reproduzido durante a captura.</p>}
      {capture && <div className="grid gap-3 rounded-xl bg-brand-500/10 p-3" data-testid="input-test-result">
        <p className="text-xs text-fog-300">Captura encerrada. Comparação local em volume reduzido. {capture.engine === 'ia' ? 'RNNoise ativo.' : capture.engine ? 'IA indisponível: filtro convencional usado.' : 'Supressão por IA desligada.'}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={headphones} onChange={(e) => { setHeadphones(e.target.checked); if (!e.target.checked) playback.current?.(); }} />Estou usando fones para ouvir o teste</label>
        <div className="flex flex-wrap gap-2">{(['dry', 'wet'] as const).map((kind) => <Button key={kind} variant="outline" disabled={!headphones || micOn} onClick={() => { playback.current?.(); playback.current = playMicRecording(capture[kind], capture.sampleRate); }}>{kind === 'dry' ? 'Ouvir original' : 'Ouvir processado'}</Button>)}<Button variant="quiet" onClick={() => playback.current?.()}>Parar reprodução</Button></div>
      </div>}
      {error && <Notice>{error}</Notice>}
      <p className="text-xs text-fog-500">O VAD é uma estimativa; sem IA, usa atividade acústica. TV e vozes sobrepostas ainda podem acionar a transmissão. A pré-abertura adiciona o atraso configurado ao processamento.</p>
    </section>
  );
}
