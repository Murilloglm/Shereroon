// AudioWorklet da supressão de ruído. Uma instância por fonte (microfone ou aplicativo): cada fonte é
// filtrada sozinha, ANTES de ser misturada com as outras. Tudo roda neste computador.
import { Denoiser, RnnoiseEngine, SpectralEngine } from './denoiser.js';

class DenoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasm, mode } = options?.processorOptions ?? {};
    let engine = null;
    if (wasm) {
      try {
        engine = new RnnoiseEngine(new WebAssembly.Module(wasm));
      } catch (error) {
        this.port.postMessage({ type: 'fallback', reason: String(error) });
      }
    }
    // Sem o modelo de IA (não baixou, ou o navegador recusou): supressão convencional.
    this.denoiser = new Denoiser(engine ?? new SpectralEngine());
    if (mode) this.denoiser.setMode(mode);
    this.denoiser.onCapture = (dry, wet) => this.port.postMessage({ type: 'capture', dry, wet }, [dry.buffer, wet.buffer]);
    this.mono = new Float32Array(128);
    this.filtered = new Float32Array(128);
    this.running = true;
    this.sinceStats = 0;
    this.sinceVad = 0;

    this.port.onmessage = ({ data }) => {
      if (data.type === 'dispose') { this.running = false; this.vadPort?.close(); this.vadPort = null; }
      else if (data.type === 'vad-port') { this.vadPort?.close(); this.vadPort = data.port; }
      else if (data.type === 'mode') this.denoiser.setMode(data.mode);
      else if (data.type === 'bypass') this.denoiser.setBypass(data.on);
      else if (data.type === 'capture') this.denoiser.startCapture(data.seconds);
    };
    this.port.postMessage({ type: 'ready', engine: this.denoiser.engine.name, delay: this.denoiser.delay });
  }

  process(inputs, outputs) {
    if (!this.running) return false;
    const input = inputs[0];
    const output = outputs[0];
    const frames = output[0].length;
    if (this.mono.length !== frames) {
      this.mono = new Float32Array(frames);
      this.filtered = new Float32Array(frames);
    }
    // O modelo trabalha em mono (é um filtro de voz): estéreo é somado e a saída vai igual para os dois lados.
    if (!input || input.length === 0) {
      this.mono.fill(0);
    } else if (input.length === 1) {
      this.mono.set(input[0]);
    } else {
      const left = input[0];
      const right = input[1];
      for (let i = 0; i < frames; i++) this.mono[i] = (left[i] + right[i]) * 0.5;
    }
    this.denoiser.process(this.mono, this.filtered, frames);
    this.sinceVad += frames;
    if (this.vadPort && this.denoiser.engine.name === 'ia' && this.sinceVad >= 480) {
      this.sinceVad = 0; this.vadPort.postMessage(this.denoiser.lastVoice ?? 0);
    }
    for (const channel of output) channel.set(this.filtered);

    this.sinceStats += frames;
    if (this.sinceStats >= sampleRate / 4) {
      this.sinceStats = 0;
      const stats = this.denoiser.takeStats();
      if (stats) this.port.postMessage({ type: 'stats', stats });
    }
    return true;
  }
}

registerProcessor('sr-denoise', DenoiseProcessor);
