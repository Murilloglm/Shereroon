// Reforço de volume (até 2x) com limitador de pico, para ouvir mais alto quem tem microfone baixo sem
// distorcer. Sem dependências: roda dentro do AudioWorklet e também nos testes de unidade.
//
// O sinal reforçado passa por uma linha de atraso curta (antecipação). Enquanto isso o limitador já viu o
// pico que vem e baixa o ganho aos poucos, a tempo de o pico sair abaixo do teto: nada é cortado na onda
// (o corte seco é o que soa como distorção). Abaixo do teto o caminho é transparente: só o atraso de 2 ms.

/** -1 dBFS: margem para o conversor e para a soma com outras vozes. */
export const CEILING = 0.891;

export class BoostLimiter {
  /**
   * @param {number} sampleRate
   * @param {{ lookaheadMs?: number, releaseMs?: number, boostMs?: number }} [options]
   */
  constructor(sampleRate, options = {}) {
    this.lookahead = Math.max(1, Math.round(((options.lookaheadMs ?? 2) / 1000) * sampleRate));
    this.releaseCoef = 1 - Math.exp(-1 / (((options.releaseMs ?? 120) / 1000) * sampleRate));
    // Ataque: chega a ~99% da redução dentro da janela de antecipação.
    this.attackCoef = 1 - Math.exp(-5 / this.lookahead);
    this.boostCoef = 1 - Math.exp(-1 / (((options.boostMs ?? 30) / 1000) * sampleRate));
    this.boost = 1;
    this.target = 1;
    this.env = 1;
    this.delays = [];
    this.at = 0;
    // Janela deslizante do ganho necessário: fila monótona (mínimo da janela em tempo constante).
    // A janela tem lookahead + 1 posições; uma a mais na fila circular separa "cheia" de "vazia".
    this.need = new Float32Array(this.lookahead + 2);
    this.queue = new Int32Array(this.lookahead + 2);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.reduction = 1;
  }

  /** Reforço desejado (1 = normal, 2 = dobro). Muda aos poucos, sem degrau. */
  setBoost(value) {
    this.target = Math.min(4, Math.max(0, Number.isFinite(value) ? value : 1));
  }

  #delayFor(channel) {
    while (this.delays.length <= channel) this.delays.push(new Float32Array(this.lookahead));
    return this.delays[channel];
  }

  /**
   * @param {Float32Array[]} input canais de entrada (pode vir vazio: silêncio)
   * @param {Float32Array[]} output canais de saída
   * @param {number} frames
   */
  process(input, output, frames) {
    const channels = output.length;
    const lookahead = this.lookahead;
    let minEnv = 1;
    for (let i = 0; i < frames; i++) {
      this.boost += (this.target - this.boost) * this.boostCoef;
      // Pico deste instante, já reforçado, em todos os canais (o ganho é o mesmo para todos: não desloca o estéreo).
      let peak = 0;
      for (let channel = 0; channel < channels; channel++) {
        const source = input[channel] ?? input[0];
        const sample = source ? source[i] * this.boost : 0;
        const magnitude = sample < 0 ? -sample : sample;
        if (magnitude > peak) peak = magnitude;
        const delay = this.#delayFor(channel);
        const out = output[channel];
        const delayed = delay[this.at];
        delay[this.at] = sample;
        out[i] = delayed;
      }
      const need = peak > CEILING ? CEILING / peak : 1;
      this.#pushNeed(need, this.count);
      this.count += 1;
      // A janela vai da amostra que sai agora (lookahead atrás) até a que acabou de entrar.
      while (this.queue[this.head] < this.count - 1 - lookahead) this.head = (this.head + 1) % this.queue.length;
      const windowMin = this.need[this.head];

      // Desce rápido (dentro da antecipação) e volta devagar.
      this.env += (windowMin - this.env) * (windowMin < this.env ? this.attackCoef : this.releaseCoef);
      if (this.env < minEnv) minEnv = this.env;
      for (let channel = 0; channel < channels; channel++) {
        let value = output[channel][i] * this.env;
        // Rede de segurança: só age se a antecipação não bastou (não deve acontecer com sinal normal).
        if (value > 1) value = 1;
        else if (value < -1) value = -1;
        output[channel][i] = value;
      }
      this.at = (this.at + 1) % lookahead;
    }
    this.reduction = minEnv;
  }

  #pushNeed(value, index) {
    // Remove do fim quem é maior que o novo valor: nunca será o mínimo enquanto ele estiver na janela.
    const size = this.queue.length;
    while (this.tail !== this.head && this.need[(this.tail - 1 + size) % size] >= value) {
      this.tail = (this.tail - 1 + size) % size;
    }
    this.need[this.tail] = value;
    this.queue[this.tail] = index;
    this.tail = (this.tail + 1) % size;
  }
}
