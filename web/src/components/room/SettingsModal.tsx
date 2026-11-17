import { useEffect, useState } from 'react';
import { desktop } from '../../lib/desktop.ts';
import { codecHint, type CodecHint } from '../../lib/capture.ts';
import { formatBitrate } from '../../lib/format.ts';
import { presetBitrateKbps, TOP_TARGET, type Codec, type CodecChoice, type ContentKind, type Target } from '../../lib/quality.ts';
import { MIC_KEY, type NoiseControl } from '../../lib/noise-control.ts';
import type { RoomSession } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { Button, cx, LevelMeter, Modal, Notice, Slider, Toggle } from '../ui.tsx';
import { NoiseButton } from './NoiseModal.tsx';
import { PersonVolume } from './PersonVolume.tsx';
import { AutostartSettings } from '../AutostartSettings.tsx';
import { UpdateSettings } from '../UpdateSettings.tsx';

const CODEC_INFO: Record<Codec, { name: string; about: string }> = {
  h264: { name: 'H.264', about: 'O mais compatível. Costuma usar a placa de vídeo para codificar e decodificar, inclusive em celulares.' },
  vp9: { name: 'VP9', about: 'A mesma imagem com cerca de 25% menos banda. Em geral codifica por software (usa mais CPU).' },
  av1: { name: 'AV1', about: 'O mais eficiente. Só vale a pena com placa de vídeo recente; por software é pesado em alta taxa de quadros.' },
  vp8: { name: 'VP8', about: 'Compatibilidade com navegadores antigos. Menos eficiente.' },
};

const CONTENT: { value: ContentKind; name: string; about: string }[] = [
  { value: 'movimento', name: 'Jogo ou vídeo', about: 'Trata a tela como vídeo em movimento. É o que permite 60, 90 e 120 FPS.' },
  { value: 'texto', name: 'Texto e código', about: 'Favorece letras nítidas em tela quase parada. Não é indicado acima de 30 FPS.' },
];

function hintText(hint: CodecHint | null | undefined, target: Target): string {
  const where = `${target.height}p a ${target.fps} FPS`;
  if (hint === undefined) return 'Consultando o navegador…';
  if (hint === null) return 'O navegador não informou a capacidade deste codec.';
  if (!hint.supported) return `Este navegador diz que não codifica ${where} com este codec.`;
  if (hint.powerEfficient) return `Neste PC: acelerado por hardware${hint.smooth ? ' e fluido' : ', mas talvez sem fluidez'} em ${where}.`;
  return `Neste PC: por software${hint.smooth ? ', fluido' : ' e provavelmente pesado'} em ${where}.`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-b border-ink-700 py-5 first:pt-1 last:border-b-0">
      <h3 className="text-base font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

function Option({ title, about, children }: { title: string; about?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {about && <p className="text-[13px] leading-snug text-fog-400">{about}</p>}
      </div>
      {children}
    </div>
  );
}

/** Atualizações e inicialização do aplicativo de Windows. */
function AppSection() {
  if (!desktop) return null;
  return (
    <>
      <Section title="Atualizações">
        <UpdateSettings />
      </Section>
      {desktop.autostart && (
        <Section title="Inicialização">
          <AutostartSettings />
        </Section>
      )}
    </>
  );
}

const selectClass =
  'h-10 w-full rounded-xl border border-ink-600 bg-ink-900/70 px-3 text-sm text-fog-100 focus:border-brand-400 focus:outline-none';

export function SettingsModal({ session, noise, onClose }: { session: RoomSession; noise: NoiseControl; onClose: () => void }) {
  const micAi = useStore(noise.store, (state) => state.settings[MIC_KEY]?.on === true);
  const quality = useStore(session.store, (state) => state.quality);
  const codecs = useStore(session.store, (state) => state.codecs);
  const share = useStore(session.store, (state) => state.share);
  const mic = useStore(session.store, (state) => state.mic);
  const micOn = useStore(session.store, (state) => state.micOn);
  const devices = useStore(session.store, (state) => state.devices);
  const outputDeviceId = useStore(session.store, (state) => state.outputDeviceId);
  const outputVolume = useStore(session.store, (state) => state.outputVolume);

  const manual = quality.mode === 'manual';
  const height = manual ? quality.resolution : TOP_TARGET.height;
  const fps = manual ? quality.fps : TOP_TARGET.fps;
  const [hints, setHints] = useState<Partial<Record<Codec, CodecHint | null>>>({});

  useEffect(() => {
    let alive = true;
    const target = { height, fps };
    void Promise.all(
      codecs.map(async (codec) => [codec, await codecHint(codec, target, presetBitrateKbps(target, codec))] as const),
    ).then((entries) => alive && setHints(Object.fromEntries(entries)));
    return () => {
      alive = false;
    };
  }, [codecs, height, fps]);

  const target: Target = { height, fps };
  const activeCodec: Codec = quality.codec !== 'auto' && codecs.includes(quality.codec) ? quality.codec : codecs.includes('h264') ? 'h264' : (codecs[0] ?? 'vp8');
  const recommended = presetBitrateKbps(target, activeCodec);
  const layered = activeCodec === 'vp9' || activeCodec === 'av1';
  const canPickOutput = 'setSinkId' in HTMLMediaElement.prototype;

  return (
    <Modal title="Configurações" onClose={onClose} wide>
      <Section title="Vídeo da transmissão">
        <div className="grid gap-2" role="radiogroup" aria-label="Codec de vídeo">
          {(['auto', ...codecs] as CodecChoice[]).map((choice) => {
            const selected = quality.codec === choice;
            return (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`codec-${choice}`}
                onClick={() => void session.updateQuality({ codec: choice })}
                className={cx(
                  'rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                  selected ? 'border-brand-400 bg-brand-500/15' : 'border-ink-600 bg-ink-800 hover:border-ink-500',
                )}
              >
                <span className="text-sm font-bold">
                  {choice === 'auto' ? `Automático (${CODEC_INFO[activeCodec].name})` : CODEC_INFO[choice].name}
                </span>
                <span className="mt-0.5 block text-[13px] leading-snug text-fog-400">
                  {choice === 'auto'
                    ? 'Escolhe H.264, que tem aceleração por hardware em praticamente todo aparelho.'
                    : `${CODEC_INFO[choice].about} ${hintText(hints[choice], target)}`}
                </span>
              </button>
            );
          })}
        </div>
        {share.active && (
          <Notice>Trocar o codec com a transmissão no ar republica o vídeo: quem assiste vê uma pausa de cerca de 1 segundo.</Notice>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold">O que você vai mostrar</p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de conteúdo">
            {CONTENT.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={quality.content === option.value}
                onClick={() => void session.updateQuality({ content: option.value })}
                className={cx(
                  'rounded-xl border px-3 py-2.5 text-left transition-colors',
                  quality.content === option.value ? 'border-brand-400 bg-brand-500/15' : 'border-ink-600 bg-ink-800 hover:border-ink-500',
                )}
              >
                <span className="text-sm font-bold">{option.name}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-fog-400">{option.about}</span>
              </button>
            ))}
          </div>
        </div>

        <Option
          title="Teto de bitrate manual"
          about={
            manual
              ? `Recomendado para ${height}p a ${fps} FPS em ${CODEC_INFO[activeCodec].name}: ${formatBitrate(recommended)}.`
              : 'Disponível no modo Manual. No automático o teto acompanha o alvo atual.'
          }
        >
          <Toggle
            on={manual && quality.bitrateKbps !== null}
            disabled={!manual}
            label="Teto de bitrate manual"
            onChange={(on) => void session.updateQuality({ bitrateKbps: on ? recommended : null })}
          />
        </Option>
        {manual && quality.bitrateKbps !== null && (
          <div className="flex items-center gap-4">
            <Slider
              label="Teto de bitrate"
              min={500}
              max={40000}
              step={250}
              value={quality.bitrateKbps}
              onChange={(value) => void session.updateQuality({ bitrateKbps: value })}
            />
            <span className="w-24 text-right text-sm font-bold">{formatBitrate(quality.bitrateKbps)}</span>
          </div>
        )}

        <Option
          title="Camada leve para celular e internet fraca"
          about={
            layered
              ? 'Com VP9/AV1 isso já acontece: o servidor entrega menos quadros a quem não aguenta a taxa cheia.'
              : 'Envia também uma versão em meia resolução a 30 FPS. Custa um pouco mais de CPU e de banda de envio.'
          }
        >
          <Toggle
            on={quality.lightLayer && !layered}
            disabled={layered}
            label="Camada leve"
            onChange={(on) => void session.updateQuality({ lightLayer: on })}
          />
        </Option>
      </Section>

      <Section title="Microfone">
        <label className="grid gap-1.5 text-sm font-semibold">
          Aparelho
          <select
            className={selectClass}
            value={mic.deviceId ?? ''}
            onChange={(event) => void session.updateMic({ deviceId: event.target.value || null })}
          >
            <option value="">Padrão do sistema</option>
            {devices.inputs
              .filter((device) => device.deviceId !== 'default' && device.deviceId !== 'communications')
              .map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Microfone sem nome'}
                </option>
              ))}
          </select>
        </label>
        <div className="flex items-center gap-4">
          <span className="w-28 text-sm font-semibold">Volume de envio</span>
          <LevelMeter read={() => (micOn ? session.mic.meter.read() : 0)} />
          <Slider label="Volume de envio do microfone" value={Math.round(mic.gain * 100)} onChange={(value) => void session.updateMic({ gain: value / 100 })} />
          <span className="w-12 text-right text-sm font-bold">{Math.round(mic.gain * 100)}%</span>
        </div>
        <Option title="Prevenção de eco" about="Evita que o som da sala volte pelo seu microfone. Deixe ligado se usa caixas de som.">
          <Toggle on={mic.echoCancellation} label="Prevenção de eco" onChange={(on) => void session.updateMic({ echoCancellation: on })} />
        </Option>
        <Option
          title="Supressão de Ruído IA"
          about="Modelo de rede neural que roda neste computador e tira ventilador, chiado e ruído de fundo da sua voz. Toque no botão para ligar, ajustar e comparar."
        >
          <NoiseButton control={noise} sourceKey={MIC_KEY} name="Microfone" />
        </Option>
        <Option
          title="Supressão de ruído do navegador"
          about={micAi ? 'Em pausa enquanto a Supressão de Ruído IA estiver ligada no microfone, para a voz não ser filtrada duas vezes.' : 'Filtro convencional contra chiado e ventilador.'}
        >
          <Toggle
            on={mic.noiseSuppression && !micAi}
            disabled={micAi}
            label="Supressão de ruído do navegador"
            onChange={(on) => void session.updateMic({ noiseSuppression: on })}
          />
        </Option>
        <Option title="Ajuste automático de volume" about="Nivela sua voz quando você fala mais baixo ou mais alto.">
          <Toggle on={mic.autoGainControl} label="Ajuste automático de volume" onChange={(on) => void session.updateMic({ autoGainControl: on })} />
        </Option>
      </Section>

      <Section title="Som que você escuta">
        {canPickOutput ? (
          <label className="grid gap-1.5 text-sm font-semibold">
            Saída de áudio
            <select className={selectClass} value={outputDeviceId ?? ''} onChange={(event) => void session.setOutputDevice(event.target.value || 'default')}>
              <option value="">Padrão do sistema</option>
              {devices.outputs
                .filter((device) => device.deviceId !== 'default' && device.deviceId !== 'communications')
                .map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || 'Saída sem nome'}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <Notice>Este navegador não permite escolher a saída de áudio; ele usa a padrão do sistema.</Notice>
        )}
        <div className="flex items-center gap-4">
          <span className="w-28 text-sm font-semibold">Volume geral</span>
          <Slider label="Volume geral da sala" value={Math.round(outputVolume * 100)} onChange={(value) => session.setOutputVolume(value / 100)} />
          <span className="w-12 text-right text-sm font-bold">{Math.round(outputVolume * 100)}%</span>
        </div>
        <PeopleVolumes session={session} />
      </Section>

      <AppSection />
    </Modal>
  );
}

/** Volume de cada pessoa da chamada (0% a 200%), só para quem ouve. Fica guardado por conta nos canais de voz. */
function PeopleVolumes({ session }: { session: RoomSession }) {
  // A lista do estado é estável; filtrar aqui (e não no seletor) evita uma lista nova a cada leitura.
  const participants = useStore(session.store, (state) => state.participants);
  const people = participants.filter((person) => !person.isLocal);
  if (people.length === 0) return null;
  return (
    <div className="grid gap-3 rounded-xl border border-ink-700 bg-ink-800/40 p-3" data-testid="people-volumes">
      <p className="text-sm font-extrabold">Volume das pessoas</p>
      {people.map((person) => (
        <PersonVolume key={person.identity} session={session} volumeKey={`voz:${person.identity}`} name={person.name} />
      ))}
    </div>
  );
}
