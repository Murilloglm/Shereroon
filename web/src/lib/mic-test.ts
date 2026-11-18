import { audioContext, resumeAudio } from './audio.ts';
import { createNoiseFilter, type NoiseFilter } from './denoise.ts';
import { effectiveMic, inputSettings } from './input-settings.ts';
import { DEFAULT_MIC, MicPipeline, type MicSettings } from './mic.ts';
import { storage } from './storage.ts';

export async function recordMicTest(signal: AbortSignal, onPipeline: (pipeline: MicPipeline) => void) {
  const context = audioContext();
  const pipeline = new MicPipeline(context);
  let filter: NoiseFilter | null = null;
  const stop = () => { pipeline.dispose(); filter?.dispose(); };
  const check = () => { if (signal.aborted) throw new DOMException('Teste encerrado.', 'AbortError'); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    check(); await resumeAudio(); check();
    const input = inputSettings.get();
    const saved = { ...DEFAULT_MIC, ...storage.get<Partial<MicSettings>>('shareroom:microfone', {}) };
    const legacy = storage.get<{ mic?: { on: boolean; level: 'leve' | 'equilibrado' | 'forte' | 'voz' } }>('shareroom:ruido', {});
    const noise = input.profile === 'studio' ? 'off' : input.noise === 'legacy' ? legacy.mic?.on ? legacy.mic.level : 'off' : input.noise;
    if (noise !== 'off' && noise !== 'browser') {
      filter = await createNoiseFilter(context, noise); check();
      await pipeline.setProcessor({ input: filter.node, output: filter.node });
    }
    await pipeline.start({ ...effectiveMic(saved, input), ...(filter ? { noiseSuppression: false, autoGainControl: false } : {}) }); check();
    pipeline.configureInput(input);
    onPipeline(pipeline);
    // Allow capture and adaptive estimates to settle before retaining the comparison.
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Teste encerrado.', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 350);
      signal.addEventListener('abort', abort, { once: true });
    }); check();
    const capture = await pipeline.capture(3); check();
    return { ...capture, sampleRate: context.sampleRate, engine: filter?.engine ?? null };
  } finally {
    signal.removeEventListener('abort', stop); stop();
  }
}

/** Playback only of a completed capture; never connects live microphone to speakers. */
export function playMicRecording(samples: Float32Array<ArrayBuffer>, rate: number): () => void {
  const context = audioContext(), source = context.createBufferSource(), gain = context.createGain();
  const buffer = context.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples, 0); source.buffer = buffer;
  gain.gain.value = 0.2; source.connect(gain); gain.connect(context.destination);
  source.onended = () => { source.disconnect(); gain.disconnect(); };
  source.start();
  return () => { try { source.stop(); } catch { /* already ended */ } source.disconnect(); gain.disconnect(); };
}
