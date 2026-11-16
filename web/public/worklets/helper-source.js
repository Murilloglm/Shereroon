// AudioWorklet que transforma os blocos vindos do app auxiliar em áudio do navegador.
// Saída 0 = mix dos aplicativos; saídas 1 a 6 = fontes "solo" (para receber filtros antes da mixagem).
// Os blocos chegam por uma porta ligada direto ao Worker da conexão, sem passar pela thread principal.
import { MAX_STREAMS, TickBuffer } from './tick-buffer.js';

class HelperSource extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.buffer = new TickBuffer(options?.processorOptions?.targetFrames ?? 1440);
    this.calls = 0;
    this.port.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'port') {
        this.feed = message.port;
        this.feed.onmessage = (tick) => this.buffer.push(tick.data);
      } else if (message.type === 'slots') {
        this.buffer.setSlots(message.slots);
      } else if (message.type === 'reset') {
        this.buffer.reset();
      }
    };
  }

  process(_inputs, outputs) {
    const frames = outputs[0][0].length;
    this.buffer.pull(outputs.slice(0, MAX_STREAMS), frames);
    // Uma vez por segundo, conta para a página como a fila está (atraso real, faltas, perdas).
    this.calls += 1;
    if (this.calls * frames >= sampleRate) {
      this.calls = 0;
      this.port.postMessage({ type: 'stats', ...this.buffer.takeStats(sampleRate) });
    }
    return true;
  }
}

registerProcessor('sr-helper-source', HelperSource);
