// Fila de áudio entre o app auxiliar e o navegador. Sem dependências: roda dentro do AudioWorklet
// e também nos testes de unidade.
//
// O auxiliar manda um bloco de 10 ms (480 quadros) a cada 10 ms do relógio DELE; o navegador consome
// 128 quadros por vez no relógio da placa de som. Os dois relógios nunca batem exatamente, então a fila
// tenderia a encher ou a esvaziar. A correção é ler um quadro a mais ou a menos de vez em quando e
// reamostrar para o tamanho pedido — uma variação de menos de 1%, inaudível.

export const CHANNELS = 2;
export const BLOCK_FRAMES = 480;
/** Faixa 0 é o mix; as demais são fontes "solo" (entregues separadas para receber filtros). */
export const MAX_STREAMS = 7;
const CAPACITY_FRAMES = 48000;
const HEADER_BYTES = 8;
const STREAM_BYTES = 4 + BLOCK_FRAMES * CHANNELS * 4;

export class TickBuffer {
  /** @param {number} targetFrames quadros mantidos em fila (atraso alvo). 1440 = 30 ms. */
  constructor(targetFrames = 1440) {
    this.target = targetFrames;
    this.rings = Array.from({ length: MAX_STREAMS }, () => new Float32Array(CAPACITY_FRAMES * CHANNELS));
    /** slot do auxiliar atribuído a cada faixa; a faixa 0 é sempre o mix (slot 0). */
    this.slots = new Int32Array(MAX_STREAMS).fill(-1);
    this.slots[0] = 0;
    this.scratch = new Float32Array(0);
    this.reset();
  }

  reset() {
    this.readIndex = 0;
    this.fill = 0;
    this.primed = false;
    this.lastSequence = -1;
    this.underruns = 0;
    this.lostBlocks = 0;
    this.droppedFrames = 0;
    this.fillSum = 0;
    this.fillCount = 0;
  }

  /** Define quais slots do auxiliar saem nas faixas 1..6 (na ordem dada). */
  setSlots(slots) {
    for (let index = 1; index < MAX_STREAMS; index++) {
      const slot = slots[index - 1];
      this.slots[index] = typeof slot === 'number' ? slot : -1;
    }
  }

  /** Recebe uma mensagem binária do auxiliar (um bloco de 10 ms com o mix e as faixas solo). */
  push(buffer) {
    if (buffer.byteLength < HEADER_BYTES + STREAM_BYTES) return false;
    const view = new DataView(buffer);
    const sequence = view.getUint32(0, true);
    const frames = view.getUint16(4, true);
    const count = view.getUint8(6);
    if (frames !== BLOCK_FRAMES || buffer.byteLength < HEADER_BYTES + count * STREAM_BYTES) return false;

    if (this.lastSequence >= 0 && sequence !== (this.lastSequence + 1) >>> 0) this.lostBlocks += 1;
    this.lastSequence = sequence;

    // Fila cheia (o navegador parou de consumir): descarta o mais antigo, nunca acumula atraso.
    if (this.fill + BLOCK_FRAMES > CAPACITY_FRAMES) {
      const drop = this.fill + BLOCK_FRAMES - CAPACITY_FRAMES;
      this.readIndex = (this.readIndex + drop) % CAPACITY_FRAMES;
      this.fill -= drop;
      this.droppedFrames += drop;
    }

    const writeIndex = (this.readIndex + this.fill) % CAPACITY_FRAMES;
    let written = 0;
    let offset = HEADER_BYTES;
    for (let stream = 0; stream < count; stream++) {
      const slot = view.getUint32(offset, true);
      offset += 4;
      const index = slot === 0 ? 0 : this.slots.indexOf(slot, 1);
      if (index >= 0) {
        this.#write(index, writeIndex, new Float32Array(buffer, offset, BLOCK_FRAMES * CHANNELS));
        written |= 1 << index;
      }
      offset += BLOCK_FRAMES * CHANNELS * 4;
    }
    // Faixa que não veio neste bloco recebe silêncio: todas andam juntas, sempre alinhadas.
    for (let index = 0; index < MAX_STREAMS; index++) {
      if ((written & (1 << index)) === 0) this.#write(index, writeIndex, null);
    }
    this.fill += BLOCK_FRAMES;
    return true;
  }

  #write(index, writeIndex, samples) {
    const ring = this.rings[index];
    const start = writeIndex * CHANNELS;
    const total = BLOCK_FRAMES * CHANNELS;
    const first = Math.min(total, ring.length - start);
    if (samples) {
      ring.set(samples.subarray(0, first), start);
      if (first < total) ring.set(samples.subarray(first), 0);
    } else {
      ring.fill(0, start, start + first);
      if (first < total) ring.fill(0, 0, total - first);
    }
  }

  /**
   * Preenche as saídas com `frames` quadros. `outputs[i]` é [esquerdo, direito] (Float32Array) ou null.
   * Devolve false quando ainda não há áudio suficiente (as saídas ficam como estavam: em silêncio).
   */
  pull(outputs, frames) {
    if (!this.primed) {
      if (this.fill < this.target) return false;
      this.primed = true;
    }
    if (this.fill > this.target + BLOCK_FRAMES * 10) {
      // Atraso acumulado demais: volta ao alvo de uma vez.
      const drop = this.fill - this.target;
      this.readIndex = (this.readIndex + drop) % CAPACITY_FRAMES;
      this.fill -= drop;
      this.droppedFrames += drop;
    }

    // Correção proporcional ao desvio: até 2 quadros a mais ou a menos por chamada (±1,5%). A fila oscila
    // naturalmente meio bloco para cada lado (entram 480 quadros de uma vez), então só age fora dessa faixa.
    const error = this.fill - this.target;
    let want = frames;
    if (error > BLOCK_FRAMES / 2) want = frames + (error > BLOCK_FRAMES * 1.5 ? 2 : 1);
    else if (error < -BLOCK_FRAMES / 2) want = frames - (error < -BLOCK_FRAMES * 1.5 ? 2 : 1);
    if (this.fill < want) {
      // Faltou áudio: fica em silêncio e só volta quando a fila encher de novo, sem picotar.
      this.underruns += 1;
      this.primed = false;
      return false;
    }

    this.fillSum += this.fill;
    this.fillCount += 1;
    if (this.scratch.length < (want + 1) * CHANNELS) this.scratch = new Float32Array((frames + 3) * CHANNELS);
    const scratch = this.scratch;
    const step = want === frames ? 1 : (want - 1) / (frames - 1);

    for (let index = 0; index < MAX_STREAMS; index++) {
      const output = outputs[index];
      if (!output || this.slots[index] < 0) continue;
      const ring = this.rings[index];
      let position = this.readIndex * CHANNELS;
      for (let sample = 0; sample < want * CHANNELS; sample++) {
        scratch[sample] = ring[position];
        position += 1;
        if (position === ring.length) position = 0;
      }
      const left = output[0];
      const right = output[1] ?? output[0];
      if (want === frames) {
        for (let frame = 0; frame < frames; frame++) {
          left[frame] = scratch[frame * 2];
          right[frame] = scratch[frame * 2 + 1];
        }
      } else {
        for (let frame = 0; frame < frames; frame++) {
          const at = frame * step;
          let base = Math.floor(at);
          if (base > want - 2) base = want - 2;
          const weight = at - base;
          left[frame] = scratch[base * 2] + (scratch[base * 2 + 2] - scratch[base * 2]) * weight;
          right[frame] = scratch[base * 2 + 1] + (scratch[base * 2 + 3] - scratch[base * 2 + 1]) * weight;
        }
      }
    }
    this.readIndex = (this.readIndex + want) % CAPACITY_FRAMES;
    this.fill -= want;
    return true;
  }

  /** Estatísticas desde a última chamada: atraso médio real da fila, faltas e perdas. */
  takeStats(sampleRate = 48000) {
    const stats = {
      bufferMs: this.fillCount > 0 ? (this.fillSum / this.fillCount / sampleRate) * 1000 : null,
      underruns: this.underruns,
      lostBlocks: this.lostBlocks,
      droppedFrames: this.droppedFrames,
      primed: this.primed,
    };
    this.fillSum = 0;
    this.fillCount = 0;
    this.underruns = 0;
    this.lostBlocks = 0;
    this.droppedFrames = 0;
    return stats;
  }
}
