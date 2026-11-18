import { InputGate, dbfs } from './input-gate.js';

class InputProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.gate = new InputGate(sampleRate, options.processorOptions);
    this.running = true;
    this.zero = new Float32Array(128); this.frames = 0; this.voice = null; this.voiceAt = -Infinity;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'dispose') { this.running = false; this.capture = null; this.vadPort?.close(); }
      if (data.type === 'settings') {
        const before = this.gate.settings;
        this.gate.configure(data.settings);
        if (before.enabled !== data.settings.enabled || before.preRollMs !== data.settings.preRollMs) this.gate.reset();
      }
      if (data.type === 'reset') this.gate.reset();
      if (data.type === 'vad-port') {
        this.vadPort?.close(); this.vadPort = data.port;
        if (!data.port) { this.voice = null; return; }
        data.port.onmessage = ({ data: probability }) => { this.voice = probability; this.voiceAt = currentFrame; };
      }
      if (data.type === 'capture') {
        const size = Math.round(Math.min(5, Math.max(0.1, data.seconds)) * sampleRate);
        this.capture = { dry: new Float32Array(size), wet: new Float32Array(size), cursor: 0 };
      }
      if (data.type === 'cancel') this.capture = null;
    };
  }
  process(inputs, outputs) {
    if (!this.running) return false;
    const output = outputs[0][0], input = inputs[0]?.[0] ?? this.zero;
    const raw = inputs[1]?.[0] ?? input;
    const probability = currentFrame - this.voiceAt < sampleRate * 0.2 ? this.voice : null;
    const stats = this.gate.process(input, output, probability);
    this.frames += output.length;
    if (this.frames >= sampleRate / 20) {
      this.frames = 0;
      let power = 0; for (const value of raw) power += value * value;
      this.port.postMessage({ type: 'stats', stats: { ...stats, rawDb: dbfs(power / raw.length) } });
    }
    if (this.capture) {
      const c = this.capture, size = Math.min(output.length, c.wet.length - c.cursor);
      c.dry.set(raw.subarray(0, size), c.cursor); c.wet.set(output.subarray(0, size), c.cursor); c.cursor += size;
      if (c.cursor === c.wet.length) {
        this.port.postMessage({ type: 'capture', dry: c.dry, wet: c.wet }, [c.dry.buffer, c.wet.buffer]);
        this.capture = null;
      }
    }
    return true;
  }
}
registerProcessor('cosmic-input', InputProcessor);
