// AudioWorklet do volume individual acima de 100%: reforço suave com limitador de pico (sem cortar a onda).
// O parâmetro "boost" vai de 1 (normal) a 2 (dobro); abaixo de 100% quem atenua é o ganho do LiveKit.
import { BoostLimiter } from './boost-limiter.js';

class BoostProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'boost', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.dsp = new BoostLimiter(sampleRate);
    this.calls = 0;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    this.dsp.setBoost(parameters.boost[0]);
    this.dsp.process(inputs[0] ?? [], output, output[0].length);
    // A cada ~0,5 s conta quanto o limitador precisou segurar (diagnóstico).
    this.calls += 1;
    if (this.calls * output[0].length >= sampleRate / 2) {
      this.calls = 0;
      this.port.postMessage({ type: 'reduction', value: this.dsp.reduction });
    }
    return true;
  }
}

registerProcessor('sr-boost', BoostProcessor);
