/**
 * Supressão de ruído por fonte: liga um filtro (lib/denoise.ts) no microfone e em cada aplicativo do mixer
 * que o usuário escolher. Cada fonte é filtrada SOZINHA, antes de entrar na mixagem. Nada é ligado sem um
 * clique do usuário, e em jogos, música e vídeo a escolha nem fica guardada entre visitas.
 */
import { inputSettings, setInput } from './input-settings.ts';
import { audioContext } from './audio.ts';
import { createNoiseFilter, isNoiseLevel, type NoiseCapture, type NoiseEngine, type NoiseFilter, type NoiseLevel, type NoiseStats } from './denoise.ts';
import { MAX_SOLO } from './helper/client.ts';
import { categoryOf, keyOf, SYSTEM_KEY, type AppMixer } from './helper/mixer.ts';
import type { RoomSession } from './session.ts';
import { storage } from './storage.ts';
import { Store } from './store.ts';

export const MIC_KEY = 'mic';
const STORAGE_KEY = 'shareroom:ruido';

export interface NoiseSetting {
  on: boolean;
  level: NoiseLevel;
}

/** `navegador`: no microfone, quando o modelo de IA não carrega, entra a supressão convencional do navegador. */
export type ActiveEngine = NoiseEngine | 'navegador';

export type NoiseAdviceKind = 'voz' | 'chamada' | 'risco' | 'neutro';

export interface NoiseAdvice {
  kind: NoiseAdviceKind;
  text: string;
}

/**
 * O que dizer ao usuário antes de ele ligar o filtro numa fonte. O modelo foi treinado para voz:
 * em jogo, música e vídeo ele pode abafar justamente o que interessa (passos, tiros, instrumentos) e
 * junta os dois canais em um, perdendo a direção do som. Nesses casos (`risco`) o site exige confirmação.
 */
export function noiseAdvice(key: string): NoiseAdvice {
  if (key === MIC_KEY) {
    return {
      kind: 'voz',
      text: 'Indicado para o microfone. Enquanto estiver ligado, a supressão de ruído comum do navegador fica desligada, para a sua voz não ser filtrada duas vezes.',
    };
  }
  const category = categoryOf(key);
  if (category === 'Jogo') {
    return {
      kind: 'risco',
      text: 'Não recomendado em jogos. O filtro só conhece voz: ele pode abafar passos, tiros e efeitos, e junta os dois canais em um, então quem assiste perde a direção do som.',
    };
  }
  if (category === 'Música' || category === 'Vídeo') {
    return {
      kind: 'risco',
      text: 'Não recomendado em música e vídeo. O filtro só conhece voz: ele pode abafar instrumentos, trilha e efeitos, e o som estéreo vira mono.',
    };
  }
  if (category === 'Voz e chamada') {
    return {
      kind: 'chamada',
      text: 'Programas de chamada costumam já filtrar a voz de quem fala neles (no Discord, é o Krisp). O site não tem como ver essa opção: se ela estiver ligada lá, filtrar de novo aqui pode abafar as vozes. Prefira “Leve”, ou use só um dos dois.',
    };
  }
  return {
    kind: 'neutro',
    text: 'O filtro foi feito para voz. Use em programas em que alguém fala; outros sons são tratados como ruído e a saída fica em mono.',
  };
}

export const defaultSetting = (key: string): NoiseSetting => ({
  on: false,
  level: noiseAdvice(key).kind === 'chamada' ? 'leve' : 'equilibrado',
});

/**
 * Lê as escolhas guardadas. Entradas inválidas são descartadas, e fontes de `risco` voltam sempre
 * desligadas: em jogo, música e vídeo o filtro nunca entra sozinho.
 */
export function cleanSettings(raw: unknown): Record<string, NoiseSetting> {
  const out: Record<string, NoiseSetting> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, value] of Object.entries(raw as Record<string, Partial<NoiseSetting> | null>).slice(0, 200)) {
    const key = name.toLowerCase();
    if (key.length > 120 || !value || typeof value !== 'object' || !isNoiseLevel(value.level)) continue;
    out[key] = { on: value.on === true && noiseAdvice(key).kind !== 'risco', level: value.level };
  }
  return out;
}

export interface NoiseState {
  settings: Record<string, NoiseSetting>;
  /** Interruptor geral: enquanto estiver ligado, todo filtro deixa passar o som original. */
  allOff: boolean;
  /** Fontes transmitindo o som original agora, para comparação ao vivo. */
  original: Record<string, boolean>;
  /** Motor em uso em cada fonte que está com filtro no ar. Fonte fora daqui não está sendo filtrada. */
  engines: Record<string, ActiveEngine>;
}

interface Running {
  key: string;
  filter: NoiseFilter;
}

export class NoiseControl {
  readonly store: Store<NoiseState>;
  readonly #session: RoomSession;
  readonly #mixer: AppMixer;
  /** Filtros no ar, por `mic` ou pelo id da fonte no app auxiliar (um programa pode ter mais de um processo). */
  readonly #running = new Map<string, Running>();
  readonly #creating = new Set<string>();
  readonly #unsubscribe: (() => void)[];
  #soloSignature = '';
  /** Microfone usando a supressão do navegador porque o modelo de IA não carregou. */
  #micOnBrowser = false;
  #disposed = false;

  constructor(session: RoomSession, mixer: AppMixer) {
    this.#session = session;
    this.#mixer = mixer;
    this.store = new Store<NoiseState>({
      settings: cleanSettings(storage.get<unknown>(STORAGE_KEY, {})),
      allOff: false,
      original: {},
      engines: {},
    });
    this.#unsubscribe = [session.store.subscribe(() => this.#sync()), mixer.helper.store.subscribe(() => this.#sync()), inputSettings.subscribe(() => this.#sync())];
    this.#sync();
  }

  setting(key: string): NoiseSetting {
    const input = inputSettings.get();
    if (key === MIC_KEY && (input.profile === 'studio' || input.noise !== 'legacy')) {
      return { on: input.profile !== 'studio' && input.noise !== 'off' && input.noise !== 'browser', level: input.noise === 'off' || input.noise === 'legacy' || input.noise === 'browser' ? 'equilibrado' : input.noise };
    }
    return this.store.get().settings[key] ?? defaultSetting(key);
  }

  /** Liga ou desliga o filtro de uma fonte. Só é chamado por um clique do usuário. */
  setOn(key: string, on: boolean): void {
    if (key === MIC_KEY) setInput({ profile: 'custom', noise: on ? this.setting(key).level : 'off' });
    this.#save(key, { on });
    if (!on) this.setOriginal(key, false);
    this.#sync();
  }

  /** Troca a intensidade na hora, sem interromper o áudio. */
  setLevel(key: string, level: NoiseLevel): void {
    if (key === MIC_KEY && inputSettings.get().noise !== 'legacy') setInput({ profile: 'custom', noise: level });
    this.#save(key, { level });
    for (const running of this.#running.values()) if (running.key === key) running.filter.setLevel(level);
  }

  /** Comparação ao vivo: com `true`, a sala recebe o som original desta fonte (mesmo atraso, sem estalo). */
  setOriginal(key: string, on: boolean): void {
    const original = { ...this.store.get().original };
    if (on) original[key] = true;
    else delete original[key];
    this.store.set({ original });
    this.#applyBypass();
  }

  /** Interruptor geral: desliga toda a supressão de uma vez, na hora. As escolhas por fonte ficam guardadas. */
  setAllOff(on: boolean): void {
    this.store.set({ allOff: on });
    this.#applyBypass();
  }

  /** Há um filtro processando esta fonte agora? */
  running(key: string): boolean {
    return key in this.store.get().engines;
  }

  /** Medição mais recente da fonte. Com mais de um processo, vale o de sinal mais forte e a CPU é somada. */
  stats(key: string): NoiseStats | null {
    let best: NoiseStats | null = null;
    let cpuPct = 0;
    for (const running of this.#running.values()) {
      const stats = running.filter.stats;
      if (running.key !== key || !stats) continue;
      cpuPct += stats.cpuPct;
      if (!best || stats.inputDb > best.inputDb) best = stats;
    }
    return best && { ...best, cpuPct };
  }

  /** Custo medido de todos os filtros no ar. */
  usage(): { filters: number; cpuPct: number } {
    let cpuPct = 0;
    for (const running of this.#running.values()) cpuPct += running.filter.stats?.cpuPct ?? 0;
    return { filters: this.#running.size, cpuPct };
  }

  /** Grava o mesmo trecho com e sem filtro, para ouvir e comparar. Só existe na memória desta aba. */
  capture(key: string, seconds: number): Promise<NoiseCapture> | null {
    for (const running of this.#running.values()) if (running.key === key) return running.filter.capture(seconds);
    return null;
  }

  dispose(): void {
    this.#disposed = true;
    for (const stop of this.#unsubscribe) stop();
    for (const id of [...this.#running.keys()]) this.#drop(id);
    void this.#session.setMicFilter(null, null);
  }

  #save(key: string, patch: Partial<NoiseSetting>): void {
    const settings = { ...this.store.get().settings, [key]: { ...this.setting(key), ...patch } };
    this.store.set({ settings });
    storage.set(STORAGE_KEY, settings);
  }

  #bypassed(key: string): boolean {
    const state = this.store.get();
    return state.allOff || state.original[key] === true;
  }

  #applyBypass(): void {
    for (const running of this.#running.values()) running.filter.setBypass(this.#bypassed(running.key));
  }

  #setEngine(key: string, engine: ActiveEngine | null): void {
    const engines = { ...this.store.get().engines };
    if (engine) engines[key] = engine;
    else delete engines[key];
    this.store.set({ engines });
  }

  #drop(id: string): void {
    const running = this.#running.get(id);
    if (!running) return;
    this.#running.delete(id);
    running.filter.dispose();
    if (![...this.#running.values()].some((other) => other.key === running.key)) this.#setEngine(running.key, null);
  }

  /** Confere o que deveria estar filtrado com o que está, e ajusta. Barato: roda a cada mudança de estado. */
  #sync(): void {
    if (this.#disposed) return;
    const settings = this.store.get().settings;
    const soloKeys = Object.entries(settings)
      .filter(([key, setting]) => key !== MIC_KEY && key !== SYSTEM_KEY && setting.on)
      .map(([key]) => key)
      .sort();
    // Só os programas com filtro ligado saem da mixagem do auxiliar em faixa separada.
    if (soloKeys.join('|') !== this.#soloSignature) {
      this.#soloSignature = soloKeys.join('|');
      this.#mixer.setSoloKeys(new Set(soloKeys));
    }
    this.#syncMic();
    this.#syncApps();
  }

  #syncMic(): void {
    const setting = this.setting(MIC_KEY);
    const want = setting.on && this.#session.store.get().micOn;
    this.#running.get(MIC_KEY)?.filter.setLevel(setting.level);
    if (!want) {
      if (this.#running.has(MIC_KEY) || this.#micOnBrowser) {
        this.#drop(MIC_KEY);
        this.#micOnBrowser = false;
        this.#setEngine(MIC_KEY, null);
        void this.#session.setMicFilter(null, null);
      }
      return;
    }
    if (this.#running.has(MIC_KEY) || this.#micOnBrowser || this.#creating.has(MIC_KEY)) return;
    const useBrowser = () => {
      // Sem o modelo de IA, a supressão convencional do próprio navegador é o melhor substituto para voz.
      this.#micOnBrowser = true;
      this.#setEngine(MIC_KEY, 'navegador');
      void this.#session.setMicFilter(null, true);
    };
    this.#create(MIC_KEY, MIC_KEY, (filter) => {
      if (filter.engine !== 'ia') {
        this.#drop(MIC_KEY);
        useBrowser();
        return;
      }
      // O filtro de IA assume: a supressão do navegador sai, para não processar a voz duas vezes.
      void this.#session.setMicFilter(filter.node, false);
    }, useBrowser);
  }

  #syncApps(): void {
    const helper = this.#mixer.helper;
    const solo = helper.soloSources();
    const alive = new Set<string>();
    for (let index = 0; index < MAX_SOLO; index++) {
      const source = solo[index];
      const key = source ? keyOf(source.exe) : '';
      if (!source || source.id === SYSTEM_KEY || !this.setting(key).on) {
        helper.setSoloProcessor(index, null);
        continue;
      }
      alive.add(source.id);
      const running = this.#running.get(source.id);
      helper.setSoloProcessor(index, running?.filter.node ?? null);
      if (!running && !this.#creating.has(source.id)) {
        this.#create(source.id, key, () => this.#syncApps(), () => {
          this.#session.notify('Não foi possível iniciar a supressão de ruído nesta fonte. Ela segue com o som original.');
          this.setOn(key, false);
        });
      }
    }
    for (const id of [...this.#running.keys()]) if (id !== MIC_KEY && !alive.has(id)) this.#drop(id);
  }

  #create(id: string, key: string, attach: (filter: NoiseFilter) => void, failed: () => void): void {
    this.#creating.add(id);
    createNoiseFilter(audioContext(), this.setting(key).level)
      .then((filter) => {
        this.#creating.delete(id);
        if (this.#disposed || !this.setting(key).on) {
          filter.dispose();
          return;
        }
        // A intensidade pode ter mudado enquanto o filtro carregava.
        filter.setLevel(this.setting(key).level);
        filter.setBypass(this.#bypassed(key));
        this.#running.set(id, { key, filter });
        this.#setEngine(key, filter.engine ?? 'convencional');
        attach(filter);
      })
      .catch((error) => {
        this.#creating.delete(id);
        console.error('Supressão de ruído indisponível', error);
        if (!this.#disposed) failed();
      });
  }
}
