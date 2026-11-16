import {
  AudioLines,
  ChevronDown,
  CircleCheck,
  Download,
  Ellipsis,
  Info,
  LoaderCircle,
  Mic,
  Monitor,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Volume2,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { HelperApp, HelperPhase, HelperSource } from '../../lib/helper/client.ts';
import { categoryOf, displayName, isVoiceApp, keyOf, SYSTEM_KEY, type AppMixer } from '../../lib/helper/mixer.ts';
import { desktop } from '../../lib/desktop.ts';
import { MIC_KEY, type NoiseControl } from '../../lib/noise-control.ts';
import type { RoomSession } from '../../lib/session.ts';
import { useStore } from '../../lib/store.ts';
import { Button, Card, cx, IconButton, LevelMeter, Menu, MenuItem, MenuLabel, Notice, Slider, Toggle } from '../ui.tsx';
import { NoiseButton } from './NoiseModal.tsx';

const DOWNLOAD_URL = (import.meta.env.VITE_HELPER_DOWNLOAD_URL ?? '').trim();
const isWindows = /Windows/i.test(navigator.userAgent);

const selectClass =
  'h-9 min-w-0 rounded-lg border border-ink-600 bg-ink-900/70 px-2.5 text-sm text-fog-100 focus:border-brand-400 focus:outline-none';

/** Tela mostrada enquanto o app auxiliar não está conectado: diz o que é e o que fazer. */
function Setup({ phase, onRetry }: { phase: HelperPhase; onRetry: () => void }) {
  if (desktop) {
    // No aplicativo o componente de áudio já vem junto: não há o que instalar nem autorizar.
    const starting = phase === 'conectando' || phase === 'parado';
    return (
      <div className="grid gap-3" data-testid="mixer-setup">
        {desktop.config.helperPort == null ? (
          <Notice tone="aviso">Esta cópia do aplicativo veio sem o componente de áudio. A captura por aplicativo existe só no Windows 10 e 11.</Notice>
        ) : starting ? (
          <p className="flex items-center gap-3 text-fog-300">
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            Iniciando o componente de áudio…
          </p>
        ) : (
          <>
            <Notice tone="aviso">O componente de áudio do aplicativo não respondeu. Tente de novo; se continuar, feche e abra o ShareRoom.</Notice>
            <Button variant="outline" onClick={onRetry} className="w-fit" data-testid="mixer-retry">
              <RefreshCw className="size-4" aria-hidden="true" />
              Tentar de novo
            </Button>
          </>
        )}
      </div>
    );
  }
  if (!isWindows) {
    return (
      <Notice tone="aviso">
        A captura por aplicativo usa um recurso do Windows 10/11 e precisa do app auxiliar ShareRoom Áudio. Neste
        aparelho, use “Áudio pelo navegador” no botão Áudio do Sistema.
      </Notice>
    );
  }
  if (phase === 'conectando') {
    return (
      <div className="grid gap-2">
        <p className="flex items-center gap-3 text-fog-300">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          Procurando o ShareRoom Áudio neste computador…
        </p>
        <p className="text-[13px] leading-snug text-fog-500">
          Se o navegador perguntar se este site pode acessar apps ou dispositivos da sua rede local, permita: é assim
          que o site fala com o auxiliar, e essa conversa não sai do seu computador.
        </p>
      </div>
    );
  }
  if (phase === 'autorizando') {
    return (
      <Notice tone="aviso" data-testid="mixer-authorizing">
        O ShareRoom Áudio abriu uma janela no seu computador perguntando se este site pode usá-lo. Responda “Sim” lá
        para continuar.
      </Notice>
    );
  }
  return (
    <div className="grid gap-4" data-testid="mixer-setup">
      {phase === 'negado' && (
        <Notice tone="aviso">Você recusou este site no ShareRoom Áudio. Para mudar de ideia, tente de novo e responda “Sim”.</Notice>
      )}
      {phase === 'substituido' && <Notice tone="aviso">O mixer está em uso em outra aba do ShareRoom neste computador.</Notice>}
      {(phase === 'ausente' || phase === 'parado') && (
        <>
          <Notice tone="aviso">
            Escolher o áudio app por app exige o ShareRoom Áudio, um programa pequeno para Windows 10/11. O navegador
            sozinho só oferece o som da aba, da janela ou do sistema inteiro.
          </Notice>
          <ol className="grid gap-2.5 text-sm text-fog-300">
            <li>
              <b className="text-fog-100">1.</b> Abra o <b className="text-fog-100">ShareRoomAudio.exe</b>. Ele fica na bandeja do
              sistema, perto do relógio.
              {DOWNLOAD_URL && (
                <a
                  href={DOWNLOAD_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-flex items-center gap-1 font-bold text-brand-300 underline-offset-2 hover:underline"
                >
                  <Download className="size-4" aria-hidden="true" />
                  Baixar
                </a>
              )}
            </li>
            <li>
              <b className="text-fog-100">2.</b> Na primeira vez ele pergunta se este site pode usá-lo. Responda “Sim”.
            </li>
            <li>
              <b className="text-fog-100">3.</b> Se o navegador perguntar se o site pode acessar apps neste dispositivo, permita:
              a conversa com o auxiliar acontece só dentro do seu computador.
            </li>
          </ol>
        </>
      )}
      <Button variant="outline" onClick={onRetry} className="w-fit" data-testid="mixer-retry">
        <RefreshCw className="size-4" aria-hidden="true" />
        Tentar conectar
      </Button>
    </div>
  );
}

function AppIcon({ png, name }: { png: string | null | undefined; name: string }) {
  if (png) return <img src={`data:image/png;base64,${png}`} alt="" className="size-9 shrink-0 rounded-lg" />;
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink-700 text-sm font-extrabold text-brand-200" aria-hidden="true">
      {Array.from(name)[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

function SourceRow({
  icon,
  name,
  detail,
  tone,
  enabled,
  volume,
  disabled,
  readLevel,
  onToggle,
  onVolume,
  testId,
  extra,
}: {
  icon: ReactNode;
  name: string;
  detail: string;
  tone?: 'aviso';
  enabled: boolean;
  volume: number;
  disabled?: boolean;
  readLevel: () => number;
  onToggle: (enabled: boolean) => void;
  onVolume: (volume: number) => void;
  testId: string;
  /** Controle extra da linha (o botão de supressão de ruído). */
  extra?: ReactNode;
}) {
  const percent = Math.round(volume * 100);
  return (
    <li
      data-testid={testId}
      data-enabled={enabled}
      className={cx(
        'flex items-center gap-3 rounded-xl border px-2.5 py-2 transition-[background,border-color,box-shadow] duration-150',
        enabled ? 'border-brand-400 bg-brand-500/10 shadow-glow' : 'border-transparent hover:bg-ink-800',
      )}
    >
      {icon}
      <div className="w-36 min-w-0 shrink-0 xl:w-44">
        <p className="truncate font-bold" title={name}>
          {name}
        </p>
        <p className={cx('truncate text-[13px]', tone === 'aviso' ? 'text-warn-400' : 'text-fog-400')} title={detail}>
          {detail}
        </p>
      </div>
      <LevelMeter read={readLevel} className="shrink-0" />
      <Slider label={`Volume de transmissão de ${name}`} value={percent} disabled={disabled} onChange={(value) => onVolume(value / 100)} className="min-w-16 flex-1" />
      <span className="w-11 shrink-0 text-right text-sm font-bold">{percent}%</span>
      {extra ?? <span className="size-9 shrink-0" aria-hidden="true" />}
      <Toggle on={enabled} disabled={disabled} label={`Transmitir o áudio de ${name}`} onChange={onToggle} />
    </li>
  );
}

function detailFor(app: HelperApp, source: HelperSource | undefined, apps: HelperApp[], hostAlso: boolean): { text: string; tone?: 'aviso' } {
  if (app.browserHost) return { text: 'Navegador desta sala — bloqueado para não dar eco', tone: 'aviso' };
  // Outra instância do mesmo navegador (outro perfil, por exemplo): dá para transmitir; a da sala fica sempre de fora.
  if (hostAlso && source?.state !== 'error') return { text: source?.state === 'capturing' ? 'Outra janela do navegador • transmitindo' : 'Outra janela do navegador; a desta sala fica de fora' };
  if (source?.state === 'error') return { text: source.error ?? 'O Windows recusou a captura', tone: 'aviso' };
  if (source?.state === 'covered') {
    const parent = source.coveredBy === SYSTEM_KEY ? 'Sistema' : displayName(apps.find((item) => item.id === source.coveredBy)?.name ?? 'outra fonte');
    return { text: `Já incluído em ${parent}` };
  }
  const category = categoryOf(app.exe);
  if (source?.state === 'capturing') return { text: `${category} • transmitindo` };
  return { text: app.playing ? `${category} • tocando agora` : category };
}

export function MixerPanel({
  session,
  mixer,
  noise,
  onClose,
  className,
}: {
  session: RoomSession;
  mixer: AppMixer;
  noise: NoiseControl;
  onClose: () => void;
  className?: string;
}) {
  const phase = useStore(mixer.helper.store, (state) => state.phase);
  const apps = useStore(mixer.helper.store, (state) => state.apps);
  const sources = useStore(mixer.helper.store, (state) => state.sources);
  const icons = useStore(mixer.helper.store, (state) => state.icons);
  const queue = useStore(mixer.helper.store, (state) => state.queue);
  const desired = useStore(mixer.store, (state) => state.desired);
  const profiles = useStore(mixer.store, (state) => state.profiles);
  const activeProfile = useStore(mixer.store, (state) => state.activeProfile);
  const pinned = useStore(mixer.store, (state) => state.pinned);
  const audioSource = useStore(session.store, (state) => state.audioSource);
  const sharing = useStore(session.store, (state) => state.share.active);
  const mic = useStore(session.store, (state) => state.mic);
  const micOn = useStore(session.store, (state) => state.micOn);
  const devices = useStore(session.store, (state) => state.devices);
  const outputDeviceId = useStore(session.store, (state) => state.outputDeviceId);
  const outputVolume = useStore(session.store, (state) => state.outputVolume);

  const connected = phase === 'conectado';
  const anyEnabled = Object.values(desired).some((entry) => entry.enabled);
  const live = connected && audioSource === 'apps' && anyEnabled;

  // Uma linha por programa (duas janelas do mesmo programa seguem a mesma escolha).
  const rows = new Map<string, HelperApp[]>();
  for (const app of apps) {
    const key = keyOf(app.exe);
    if (!app.hasSession && !pinned.includes(key) && !desired[key]?.enabled) continue;
    rows.set(key, [...(rows.get(key) ?? []), app]);
  }
  const addable = apps.filter((app) => !app.hasSession && !rows.has(keyOf(app.exe)));
  const levelOf = (ids: string[]) => () => {
    let peak = 0;
    for (const source of sources) {
      if (ids.includes(source.id)) peak = Math.max(peak, mixer.helper.levels.bySlot.get(source.slot) ?? 0);
    }
    return peak;
  };

  const system = desired[SYSTEM_KEY] ?? { enabled: false, volume: 1 };
  const systemSource = sources.find((source) => source.id === SYSTEM_KEY);
  const voiceOn = [...rows.keys()].some((key) => desired[key]?.enabled && isVoiceApp(key));
  const voiceOff = [...rows.entries()].find(([key]) => !desired[key]?.enabled && isVoiceApp(key));
  const helperMs = Math.max(0, ...mixer.helper.levels.bufferMs.values());

  const saveProfile = () => {
    const name = window.prompt('Nome do perfil de áudio (por exemplo: “Jogar com call”):', activeProfile ?? '');
    if (name?.trim()) mixer.saveProfile(name);
  };

  return (
    <Card className={cx('flex min-h-0 flex-col border-brand-400/60 shadow-glow', className)} data-testid="mixer-panel" data-phase={phase}>
      <header className="flex items-start gap-3 px-5 pt-4 pb-3">
        <AudioLines className="mt-1 size-7 shrink-0 text-brand-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-extrabold">Mixer de Áudio Avançado</h2>
          <p className="text-sm text-fog-400">Controle e compartilhe somente o áudio dos apps que você escolher.</p>
        </div>
        {connected && (
          <span
            data-testid="mixer-status"
            data-live={live}
            className={cx(
              'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-bold',
              live ? 'border-ok-400/60 bg-ok-400/10 text-ok-400' : 'border-ink-600 bg-ink-800 text-fog-300',
            )}
          >
            <CircleCheck className="size-4" aria-hidden="true" />
            {live ? 'Captura seletiva ativa' : 'Auxiliar conectado'}
          </span>
        )}
        <IconButton label="Fechar o mixer" onClick={onClose}>
          <X className="size-5" />
        </IconButton>
      </header>

      <div className="grid min-h-0 gap-4 overflow-y-auto px-5 pb-5">
        {!connected && <Setup phase={phase} onRetry={() => mixer.open()} />}

        {connected && (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="text-sm font-bold" htmlFor="sr-perfil">
                Perfil de áudio
              </label>
              <select
                id="sr-perfil"
                data-testid="mixer-profile"
                className={cx(selectClass, 'h-10 min-w-40 flex-1')}
                value={activeProfile ?? ''}
                onChange={(event) => event.target.value && mixer.applyProfile(event.target.value)}
              >
                <option value="">{profiles.length === 0 ? 'Nenhum perfil salvo' : 'Escolher perfil…'}</option>
                {profiles.map((profile) => (
                  <option key={profile.name} value={profile.name}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" className="h-10" onClick={saveProfile} data-testid="mixer-save-profile">
                <Save className="size-4" aria-hidden="true" />
                Salvar perfil
              </Button>
              <Menu
                side="bottom"
                align="end"
                trigger={({ toggle }) => (
                  <Button size="sm" className="h-10 px-2.5" aria-label="Mais opções do mixer" onClick={toggle}>
                    <Ellipsis className="size-5" />
                  </Button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem
                      onClick={() => {
                        close();
                        mixer.disableAll();
                      }}
                    >
                      Desligar todas as fontes
                    </MenuItem>
                    <MenuItem
                      disabled={!activeProfile}
                      onClick={() => {
                        close();
                        if (activeProfile && window.confirm(`Excluir o perfil “${activeProfile}”?`)) mixer.deleteProfile(activeProfile);
                      }}
                    >
                      Excluir o perfil atual
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>

            <section>
              <h3 className="mb-2 flex items-center gap-2 text-[15px] font-extrabold">
                <SlidersHorizontal className="size-4 text-brand-300" aria-hidden="true" />
                Fontes de áudio por aplicativo
                <span title="Só o que estiver ligado aqui é transmitido. O volume vale para a transmissão; o que você escuta no PC não muda.">
                  <Info className="size-4 text-fog-500" aria-hidden="true" />
                </span>
              </h3>
              <ul className="grid gap-1" data-testid="mixer-sources">
                {[...rows.entries()].map(([key, group]) => {
                  // O navegador desta sala nunca é capturado. Se houver outra instância do mesmo programa, a linha vale para ela.
                  const app = group.find((item) => !item.browserHost) ?? group[0]!;
                  const ids = group.filter((item) => !item.browserHost).map((item) => item.id);
                  const source = sources.find((item) => ids.includes(item.id));
                  const entry = desired[key] ?? { enabled: false, volume: 1 };
                  const detail = detailFor(app, source, apps, group.some((item) => item.browserHost));
                  return (
                    <SourceRow
                      key={key}
                      testId={`mixer-row-${key}`}
                      icon={<AppIcon png={icons[key]} name={app.name} />}
                      name={displayName(app.name)}
                      detail={detail.text}
                      tone={detail.tone}
                      enabled={entry.enabled && !app.browserHost}
                      volume={entry.volume}
                      disabled={app.browserHost}
                      readLevel={levelOf(ids)}
                      onToggle={(enabled) => mixer.setEnabled(key, enabled)}
                      onVolume={(volume) => mixer.setVolume(key, volume)}
                      extra={<NoiseButton control={noise} sourceKey={key} name={displayName(app.name)} disabled={app.browserHost} />}
                    />
                  );
                })}
                {rows.size === 0 && (
                  <li className="rounded-xl border border-dashed border-ink-600 px-3 py-4 text-sm text-fog-400">
                    Nenhum aplicativo com áudio detectado. Abra o jogo ou o programa e ele aparece aqui; ou use “Adicionar
                    áudio”.
                  </li>
                )}
                <SourceRow
                  testId="mixer-row-system"
                  icon={
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink-700 text-brand-200">
                      <Monitor className="size-5" aria-hidden="true" />
                    </span>
                  }
                  name="Sistema"
                  detail={
                    systemSource?.state === 'error'
                      ? (systemSource.error ?? 'O Windows recusou a captura')
                      : system.enabled
                        ? desktop ? 'Todos os sons do PC, menos o próprio ShareRoom' : 'Todos os sons do PC, menos este navegador'
                        : 'Sons do Windows e outros apps'
                  }
                  tone={systemSource?.state === 'error' ? 'aviso' : undefined}
                  enabled={system.enabled}
                  volume={system.volume}
                  readLevel={levelOf([SYSTEM_KEY])}
                  onToggle={(enabled) => mixer.setEnabled(SYSTEM_KEY, enabled)}
                  onVolume={(volume) => mixer.setVolume(SYSTEM_KEY, volume)}
                />
              </ul>
            </section>

            <div className="flex flex-wrap items-stretch gap-2.5">
              <Menu
                side="top"
                trigger={({ toggle, open }) => (
                  <Button variant="outline" onClick={toggle} aria-expanded={open} data-testid="mixer-add">
                    <Plus className="size-4" aria-hidden="true" />
                    Adicionar áudio
                    <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} />
                  </Button>
                )}
              >
                {(close) => (
                  <>
                    <MenuLabel>Programas abertos que ainda não tocaram nada</MenuLabel>
                    <div className="max-h-64 overflow-y-auto">
                      {addable.map((app) => (
                        <MenuItem
                          key={app.id}
                          hint={categoryOf(app.exe)}
                          onClick={() => {
                            close();
                            mixer.pin(app.exe);
                          }}
                        >
                          {displayName(app.name)}
                        </MenuItem>
                      ))}
                    </div>
                    {addable.length === 0 && <p className="px-2.5 py-2 text-sm text-fog-400">Todos os programas abertos já estão na lista.</p>}
                  </>
                )}
              </Menu>
              <p className="flex min-w-48 flex-1 items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-800/70 px-3 py-2 text-sm text-fog-300">
                {voiceOn ? (
                  <>
                    <TriangleAlert className="size-4 shrink-0 text-warn-400" aria-hidden="true" />
                    Se quem está na sala também está nessa chamada, vai se ouvir de volta com atraso.
                  </>
                ) : (
                  <>
                    <Info className="size-4 shrink-0 text-brand-300" aria-hidden="true" />
                    {voiceOff
                      ? `Você pode ativar o ${displayName(voiceOff[1][0]!.name)} durante a transmissão sem reiniciar.`
                      : 'Ligar, desligar e ajustar fontes não interrompe a transmissão.'}
                  </>
                )}
              </p>
            </div>

            {system.enabled && rows.size > 0 && (
              <Notice>Com “Sistema” ligado, os aplicativos já estão incluídos nele; os volumes individuais deixam de valer.</Notice>
            )}
            {anyEnabled && !sharing && <Notice>As fontes estão prontas. O áudio começa a ser transmitido quando você compartilhar a tela.</Notice>}
          </>
        )}

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[15px] font-extrabold">
            <SlidersHorizontal className="size-4 rotate-90 text-brand-300" aria-hidden="true" />
            Roteamento e controles de áudio
          </h3>
          <div className="grid gap-3 xl:grid-cols-[1fr_15rem]">
            <div className="grid gap-1 rounded-xl border border-ink-600 bg-ink-800/50 p-2.5">
              <div className="flex items-center gap-3 px-1 py-1">
                <Mic className="size-5 shrink-0 text-brand-300" aria-hidden="true" />
                <div className="w-36 min-w-0 shrink-0 xl:w-40">
                  <p className="font-bold">Microfone</p>
                  <select
                    aria-label="Microfone"
                    className="w-full truncate bg-transparent text-[13px] text-fog-400 outline-none"
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
                </div>
                <LevelMeter read={() => (micOn ? session.mic.meter.read() : 0)} className="shrink-0" />
                <Slider label="Volume de envio do microfone" value={Math.round(mic.gain * 100)} onChange={(value) => void session.updateMic({ gain: value / 100 })} className="min-w-16 flex-1" />
                <span className="w-11 shrink-0 text-right text-sm font-bold">{Math.round(mic.gain * 100)}%</span>
                <NoiseButton control={noise} sourceKey={MIC_KEY} name="Microfone" />
              </div>
              <div className="flex items-center gap-3 px-1 py-1">
                <Volume2 className="size-5 shrink-0 text-brand-300" aria-hidden="true" />
                <div className="w-36 min-w-0 shrink-0 xl:w-40">
                  <p className="font-bold">Saída do sistema</p>
                  <select
                    aria-label="Saída de áudio"
                    className="w-full truncate bg-transparent text-[13px] text-fog-400 outline-none"
                    value={outputDeviceId ?? ''}
                    onChange={(event) => void session.setOutputDevice(event.target.value || 'default')}
                  >
                    <option value="">Padrão do sistema</option>
                    {devices.outputs
                      .filter((device) => device.deviceId !== 'default' && device.deviceId !== 'communications')
                      .map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || 'Saída sem nome'}
                        </option>
                      ))}
                  </select>
                </div>
                <span className="w-[48px] shrink-0 text-center text-[11px] leading-tight text-fog-500">o que você ouve</span>
                <Slider label="Volume do que você escuta da sala" value={Math.round(outputVolume * 100)} onChange={(value) => session.setOutputVolume(value / 100)} className="min-w-16 flex-1" />
                <span className="w-11 shrink-0 text-right text-sm font-bold">{Math.round(outputVolume * 100)}%</span>
                <span className="size-9 shrink-0" aria-hidden="true" />
              </div>
            </div>
            <div className="rounded-xl border border-ink-600 bg-ink-800/50 p-3">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="size-5 shrink-0 text-brand-300" aria-hidden="true" />
                <p className="flex-1 font-bold">Prevenção de eco</p>
                <Toggle on={mic.echoCancellation} label="Prevenção de eco" onChange={(on) => void session.updateMic({ echoCancellation: on })} />
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-fog-400">
                Evita que o áudio compartilhado volte para o seu microfone. O navegador desta sala nunca é capturado pelo
                mixer.
              </p>
            </div>
          </div>
        </section>

        {connected && anyEnabled && (
          <p className="text-xs leading-snug text-fog-500" data-testid="mixer-latency">
            Atraso medido do áudio dos aplicativos: {helperMs > 0 ? `${Math.round(helperMs + 10)} ms no auxiliar` : 'medindo'}
            {queue?.bufferMs != null && ` + ${Math.round(queue.bufferMs)} ms na fila do navegador`}
            {queue && queue.underruns + queue.lostBlocks > 0 && ` (${queue.underruns + queue.lostBlocks} falha(s) no último segundo)`}.
          </p>
        )}
      </div>
    </Card>
  );
}
