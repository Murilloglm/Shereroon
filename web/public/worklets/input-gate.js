/** Audio-thread sensitivity controller. Independent of mute and noise suppression. */
export const GATE_DEFAULTS = { enabled: false, mode: 'auto', thresholdDb: -50, hysteresisDb: 6, holdMs: 180, releaseMs: 100, attackMs: 4, preRollMs: 40, vad: true, vadThreshold: 0.6 };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const dbfs = (power) => Math.max(-100, 10 * Math.log10(Math.max(1e-10, power)));

export class InputGate {
  constructor(rate = 48000, settings = {}) {
    this.rate = rate;
    this.ring = new Float32Array(Math.ceil(rate * 0.121));
    this.settings = { ...GATE_DEFAULTS, ...settings };
    this.stats = { inputDb: -100, thresholdDb: -50, noiseDb: -65, open: false, voice: 0 };
    this.reset();
  }
  configure(settings) { this.settings = { ...GATE_DEFAULTS, ...settings }; }
  reset() {
    this.ring.fill(0); this.cursor = 0; this.gain = 0; this.open = false;
    this.hold = 0; this.candidate = 0; this.noiseDb = -65;
    this.stats = { inputDb: -100, thresholdDb: this.settings.thresholdDb, noiseDb: -65, open: false, voice: 0 };
  }
  /** @param {Float32Array} input @param {Float32Array} output @param {number | null} probability */
  process(input, output, probability = null) {
    const s = this.settings, ms = input.length * 1000 / this.rate;
    let power = 0;
    for (const sample of input) power += sample * sample;
    const level = dbfs(power / Math.max(1, input.length));
    // Without a neural probability, sustained energy is only an acoustic VAD estimate.
    const voice = probability === null ? (level > this.noiseDb + 8 ? 0.7 : 0) : probability;
    if (voice < s.vadThreshold || !this.open) {
      const alpha = level < this.noiseDb ? 1 - Math.exp(-ms / 150) : 1 - Math.exp(-ms / 6000);
      this.noiseDb += (level - this.noiseDb) * alpha;
      this.noiseDb = clamp(this.noiseDb, -90, -20);
    }
    const threshold = s.mode === 'auto' ? clamp(this.noiseDb + 10, -65, -25) : s.thresholdDb;
    const floor = this.open ? threshold - s.hysteresisDb : threshold;
    const voiced = !s.vad || voice >= s.vadThreshold;
    const crosses = level >= floor || (s.mode === 'auto' && probability !== null && voiced && level >= floor - 6);
    this.candidate = crosses && voiced ? this.candidate + ms : 0;
    if (this.candidate >= (s.vad ? 8 : 0.1)) { this.open = true; this.hold = s.holdMs + s.preRollMs; }
    else { this.hold -= ms; if (this.hold <= 0) this.open = false; }
    const target = !s.enabled || this.open ? 1 : 0;
    const step = 1 / Math.max(1, this.rate * (target ? s.attackMs : s.releaseMs) / 1000);
    const delay = s.enabled ? Math.round(this.rate * s.preRollMs / 1000) : 0;
    for (let i = 0; i < input.length; i++) {
      this.ring[this.cursor] = input[i];
      const delayed = this.ring[(this.cursor - delay + this.ring.length) % this.ring.length];
      this.cursor = (this.cursor + 1) % this.ring.length;
      this.gain += clamp(target - this.gain, -step, step);
      output[i] = delayed * (s.enabled ? this.gain : 1);
    }
    this.stats = { inputDb: level, thresholdDb: threshold, noiseDb: this.noiseDb, open: target === 1 || this.gain > 0.001, voice };
    return this.stats;
  }
}
