import { AppWindow, LoaderCircle, Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SYSTEM_KEY, type AppMixer } from '../../lib/helper/mixer.ts';
import { desktop } from '../../lib/desktop.ts';
import { finishPick, pickerStore, refreshSources } from '../../lib/source-picker.ts';
import { storage } from '../../lib/storage.ts';
import { useStore } from '../../lib/store.ts';
import { Button, cx, Modal, Toggle } from '../ui.tsx';

const AUDIO_KEY = 'shareroom:app-som-do-computador';

/** Seletor de tela ou janela do aplicativo de Windows. Só existe dentro do aplicativo. */
export function SourcePicker({ mixer }: { mixer: AppMixer }) {
  const open = useStore(pickerStore, (state) => state.open);
  return open ? <Picker mixer={mixer} /> : null;
}

function Picker({ mixer }: { mixer: AppMixer }) {
  const sources = useStore(pickerStore, (state) => state.sources);
  const loading = useStore(pickerStore, (state) => state.loading);
  const tab = useStore(pickerStore, (state) => state.tab);
  const systemOn = useStore(mixer.store, (state) => state.desired[SYSTEM_KEY]?.enabled === true);
  const hasAudio = desktop?.config.helperPort != null;
  const [selected, setSelected] = useState<string | null>(null);
  // A caixa de som começa como você deixou da última vez; na primeira, desmarcada.
  const [audio, setAudio] = useState(() => hasAudio && (systemOn || storage.get<boolean>(AUDIO_KEY, false) === true));

  useEffect(() => {
    const timer = setInterval(() => void refreshSources(), 2000);
    return () => clearInterval(timer);
  }, []);

  const shown = sources.filter((source) => source.kind === tab);
  const chosen = shown.find((source) => source.id === selected) ?? null;

  const confirm = (id: string) => {
    if (hasAudio) {
      storage.set(AUDIO_KEY, audio);
      if (audio) void mixer.enableSystem();
      else if (systemOn) mixer.setEnabled(SYSTEM_KEY, false);
    }
    finishPick(id);
  };

  return (
    <Modal title="O que você quer compartilhar?" onClose={() => finishPick(null)} wide>
      <div className="grid gap-4" data-testid="source-picker">
        <div className="grid grid-cols-2 gap-2" role="tablist">
          {(
            [
              ['window', 'Janelas', AppWindow],
              ['screen', 'Telas inteiras', Monitor],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              data-testid={`picker-tab-${value}`}
              onClick={() => {
                pickerStore.set({ tab: value });
                setSelected(null);
              }}
              className={cx(
                'flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold transition-[background,border-color] duration-150',
                tab === value ? 'border-brand-300 bg-brand-500/25 text-white' : 'border-ink-600 bg-ink-800 text-fog-300 hover:border-ink-500',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
              <span className="text-fog-400">({sources.filter((source) => source.kind === value).length})</span>
            </button>
          ))}
        </div>

        <p className="text-[13px] leading-snug text-fog-400">
          {tab === 'window'
            ? 'Só a janela escolhida é transmitida. Para jogos, deixe o jogo em “janela sem bordas” e escolha a janela dele.'
            : 'Tudo o que aparecer nesse monitor é transmitido, inclusive notificações e outras janelas.'}
        </p>

        {loading && shown.length === 0 ? (
          <p className="flex items-center gap-2.5 py-10 text-fog-300">
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            Procurando telas e janelas…
          </p>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-600 px-4 py-8 text-sm text-fog-400">
            {tab === 'window' ? 'Nenhuma janela aberta para compartilhar. Janelas minimizadas não aparecem.' : 'O sistema não informou nenhum monitor.'}
          </p>
        ) : (
          <ul className="grid max-h-[46dvh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
            {shown.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  data-testid="picker-source"
                  data-kind={source.kind}
                  aria-pressed={selected === source.id}
                  onClick={() => setSelected(source.id)}
                  onDoubleClick={() => confirm(source.id)}
                  className={cx(
                    'grid w-full gap-2 rounded-xl border p-2 text-left transition-[background,border-color,box-shadow] duration-150',
                    selected === source.id ? 'border-brand-300 bg-brand-500/15 shadow-glow' : 'border-ink-600 bg-ink-800/60 hover:border-ink-500',
                  )}
                >
                  <span className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-ink-950">
                    {source.thumbnail ? (
                      <img src={source.thumbnail} alt="" className="size-full object-contain" />
                    ) : (
                      <Monitor className="size-8 text-fog-500" aria-hidden="true" />
                    )}
                  </span>
                  <span className="flex min-w-0 items-center gap-2 px-0.5">
                    {source.icon && <img src={source.icon} alt="" className="size-4 shrink-0" />}
                    <span className="truncate text-sm font-semibold" title={source.name}>
                      {source.name}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {hasAudio && (
          <div className="flex items-center gap-4 rounded-xl border border-ink-600 bg-ink-800/50 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Transmitir também o som do computador</p>
              <p className="text-[13px] leading-snug text-fog-400">
                Tudo o que toca no PC, menos o próprio Cosmic Night, então as vozes da sala não voltam como eco. Para escolher
                aplicativo por aplicativo, use o mixer.
              </p>
            </div>
            <Toggle on={audio} label="Transmitir o som do computador" onChange={setAudio} />
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5">
          <p className="mr-auto text-xs leading-snug text-fog-500">Nada é capturado antes de você confirmar.</p>
          <Button onClick={() => finishPick(null)} data-testid="picker-cancel">
            Cancelar
          </Button>
          <Button variant="primary" disabled={!chosen} onClick={() => chosen && confirm(chosen.id)} data-testid="picker-confirm">
            Compartilhar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
