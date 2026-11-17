// Preferências de áudio nos canais de voz dos grupos, com som de verdade passando pelo LiveKit:
//  - volume por pessoa até 200%: quem fala baixo dobra; quem fala alto é segurado pelo limitador, sem corte;
//  - o volume escolhido fica guardado pela conta e volta na próxima chamada;
//  - o microfone e o "silenciar o que ouço" voltam como estavam ao sair e entrar, e depois de recarregar;
//  - sem permissão do microfone já concedida, nada é aberto sozinho.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, root, startStack, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
const noSound = headless && 'o Chrome sem janela não entrega áudio de verdade';
const RATE = 48_000;
let stack;
const browsers = [];
let ana;
let beto;
let caio;
let invite;

const RAW_MIC = JSON.stringify({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, gain: 1 });

function toneFile(name, amplitude, hz) {
  const samples = RATE * 6;
  const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) out.writeInt16LE(Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * hz * i) / RATE)), 44 + i * 2);
  const folder = resolve(root, 'e2e/.artifacts');
  mkdirSync(folder, { recursive: true });
  const file = resolve(folder, name);
  writeFileSync(file, out);
  return file;
}

/**
 * Escuta o que a página realmente toca: todo nó que se liga à saída de áudio ganha também um medidor.
 * Para cada som recebido guarda o RMS, o pico e a energia da fundamental e do 3º harmônico (o corte seco
 * de uma onda aparece como 3º harmônico forte).
 */
const TAP = () => {
  const connect = AudioNode.prototype.connect;
  window.__taps = [];
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = connect.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode && this instanceof GainNode && !this.__tapped) {
      this.__tapped = true;
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 4096;
      connect.call(this, analyser);
      window.__taps.push(analyser);
    }
    return result;
  };
};

/** Mede o som de cada nó tocado durante `ms`, procurando o tom de `hz`. */
async function listen(page, hz, ms = 1500) {
  return page.evaluate(
    async ([hz, ms]) => {
      const results = window.__taps.map(() => ({ rms: 0, peak: 0, fundamental: 0, third: 0, amp: 0, n: 0 }));
      const end = performance.now() + ms;
      while (performance.now() < end) {
        window.__taps.forEach((analyser, index) => {
          const data = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(data);
          const result = results[index];
          let sum = 0;
          let s1 = 0;
          let c1 = 0;
          let s3 = 0;
          let c3 = 0;
          const rate = analyser.context.sampleRate;
          for (let i = 0; i < data.length; i++) {
            const value = data[i];
            sum += value * value;
            result.peak = Math.max(result.peak, Math.abs(value));
            const t = (2 * Math.PI * hz * i) / rate;
            s1 += value * Math.sin(t);
            c1 += value * Math.cos(t);
            s3 += value * Math.sin(3 * t);
            c3 += value * Math.cos(3 * t);
          }
          result.rms += Math.sqrt(sum / data.length);
          result.fundamental += s1 * s1 + c1 * c1;
          // Amplitude do tom procurado neste trecho (para achar qual som é de quem).
          result.amp += (2 * Math.sqrt(s1 * s1 + c1 * c1)) / data.length;
          result.third += s3 * s3 + c3 * c3;
          result.n += 1;
        });
        await new Promise((done) => setTimeout(done, 90));
      }
      return results
        .filter((result) => result.n > 0)
        .map((result) => ({
          rms: result.rms / result.n,
          amp: result.amp / result.n,
          peak: result.peak,
          // Quanto o 3º harmônico fica abaixo da fundamental, em dB.
          thirdDb: 10 * Math.log10(result.third / Math.max(result.fundamental, 1e-12)),
        }));
    },
    [hz, ms],
  );
}

/** O som de quem fala o tom `hz`: o nó tocado em que esse tom é mais forte. */
async function loudest(page, hz) {
  const all = await listen(page, hz);
  return all.sort((a, b) => b.amp - a.amp)[0] ?? { rms: 0, peak: 0, thirdDb: 0, amp: 0 };
}

async function open(name, options = {}) {
  const browser = await launchChrome({ headless, ...options });
  browsers.push(browser);
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await context.addInitScript((mic) => localStorage.setItem('shareroom:microfone', mic), RAW_MIC);
  await context.addInitScript(TAP);
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.dismiss());
  return page;
}

async function signUp(page, username) {
  await page.getByTestId('auth-tab-criar').click();
  await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-display-name').fill(username[0].toUpperCase() + username.slice(1));
  await page.getByTestId('auth-password').fill('senha-de-teste-1');
  await page.getByTestId('auth-submit').click();
}

const voiceChannel = (page) => page.getByTestId('channel').filter({ hasText: /^Sala de voz$/ });
async function joinVoice(page) {
  await voiceChannel(page).click();
  await page.getByTestId('voice-room').getByTestId('room').waitFor({ timeout: 20_000 });
}
async function leaveVoice(page) {
  await page.getByTestId('voice-bar-leave').click();
  await page.getByTestId('voice-bar').waitFor({ state: 'detached' });
}
const micPressed = async (page) => (await page.getByTestId('user-mic').getAttribute('aria-pressed')) === 'true';

/** Abre o menu da pessoa no canal de voz e põe o volume no máximo (200%) pelo teclado. */
async function setMaxVolume(page, name) {
  await page.getByTestId('participant').filter({ hasText: name }).getByTestId('voice-person-menu').click();
  const slider = page.getByRole('slider', { name: `Volume de ${name}` });
  await slider.focus();
  await page.keyboard.press('End');
  await waitFor(async () => (await page.getByTestId('person-volume-value').textContent()) === '200%', 'o volume chegar a 200%');
  await page.keyboard.press('Escape');
}

before(async () => {
  stack = await startStack();
  ana = await open('ana');
  beto = await open('beto', { fakeMic: true, args: [`--use-file-for-fake-audio-capture=${toneFile('beto-baixo.wav', 0.2, 400)}`] });
  caio = await open('caio', { fakeMic: true, args: [`--use-file-for-fake-audio-capture=${toneFile('caio-alto.wav', 0.6, 600)}`] });
  // Beto e Caio já deram permissão ao microfone neste site (como quem já usou o app antes).
  await beto.context().grantPermissions(['microphone'], { origin: BASE_URL });
  await caio.context().grantPermissions(['microphone'], { origin: BASE_URL });

  await ana.goto(BASE_URL);
  await ana.getByTestId('home-groups').click();
  await signUp(ana, 'ana');
  await ana.getByTestId('rail-create').click();
  await ana.getByTestId('group-name').fill('Preferências');
  await ana.getByTestId('group-create').click();
  await ana.getByTestId('chat').waitFor();
  await ana.getByTestId('group-menu').click();
  await ana.getByTestId('group-invite').click();
  await waitFor(async () => /#\/convite\//.test(await ana.getByTestId('group-invite-link').inputValue()), 'o convite ser gerado');
  invite = await ana.getByTestId('group-invite-link').inputValue();
  await ana.getByRole('dialog', { name: /Convidar para/ }).getByRole('button', { name: 'Fechar' }).first().click();
  for (const [page, name] of [[beto, 'beto'], [caio, 'caio']]) {
    await page.goto(invite);
    await signUp(page, name);
    await page.getByTestId('join-accept').click();
    await page.getByTestId('chat').waitFor();
  }
});

after(async () => {
  for (const browser of browsers) await browser.close();
  await stack?.stop();
});

test('volume por pessoa até 200%: o som baixo dobra e o alto não distorce', { skip: noSound }, async () => {
  await joinVoice(beto);
  await joinVoice(caio);
  await beto.getByTestId('user-mic').click();
  await caio.getByTestId('user-mic').click();
  await joinVoice(ana);
  await waitFor(async () => (await ana.locator('audio').count()) >= 2, 'a Ana receber as duas vozes');
  await ana.waitForTimeout(2000);

  const betoNormal = await loudest(ana, 400);
  const caioNormal = await loudest(ana, 600);
  assert.ok(betoNormal.rms > 0.05 && caioNormal.rms > 0.2, `as duas vozes chegam (Beto ${betoNormal.rms.toFixed(3)}, Caio ${caioNormal.rms.toFixed(3)})`);

  await setMaxVolume(ana, 'Beto');
  await setMaxVolume(ana, 'Caio');
  await ana.waitForTimeout(800);
  const betoBoost = await loudest(ana, 400);
  const caioBoost = await loudest(ana, 600);
  const gainDb = 20 * Math.log10(betoBoost.rms / betoNormal.rms);
  console.log(`  Beto: ${betoNormal.rms.toFixed(3)} → ${betoBoost.rms.toFixed(3)} (+${gainDb.toFixed(1)} dB)`);
  console.log(`  Caio: pico ${caioNormal.peak.toFixed(3)} → ${caioBoost.peak.toFixed(3)}, 3º harmônico ${caioBoost.thirdDb.toFixed(1)} dB abaixo`);
  assert.ok(gainDb > 5 && gainDb < 7, `o som baixo dobra (+6 dB): +${gainDb.toFixed(1)} dB`);
  assert.ok(caioBoost.peak <= 0.95, `o som alto não passa do teto (pico ${caioBoost.peak.toFixed(3)})`);
  // Corte seco (sem limitador) deixaria o 3º harmônico perto de -10 dB; com o limitador fica muito abaixo.
  assert.ok(caioBoost.thirdDb < -30, `sem distorção de corte (3º harmônico ${caioBoost.thirdDb.toFixed(1)} dB)`);

  // As mesmas escolhas aparecem nas configurações de áudio da chamada, com o botão de voltar a 100%.
  await ana.getByTestId('voice-room').getByTestId('dock-settings').click();
  const people = ana.getByTestId('people-volumes');
  await people.waitFor();
  const betoRow = people.getByTestId('person-volume').filter({ hasText: 'Beto' });
  assert.equal(await betoRow.getByTestId('person-volume-value').textContent(), '200%');
  await betoRow.getByTestId('person-volume-reset').click();
  assert.equal(await betoRow.getByTestId('person-volume-value').textContent(), '100%');
  await sliderToMax(betoRow);
  await ana.getByRole('dialog', { name: 'Configurações' }).getByRole('button', { name: 'Fechar' }).click();
});

/** Volta o volume ao máximo pelo teclado (End), dentro de uma linha de volume. */
async function sliderToMax(row) {
  await row.getByRole('slider').focus();
  await row.page().keyboard.press('End');
  await waitFor(async () => (await row.getByTestId('person-volume-value').textContent()) === '200%', 'o volume voltar a 200%');
}

test('o volume escolhido volta na próxima chamada, e o microfone também', { skip: noSound }, async () => {
  // A Ana sai e volta: Beto continua em 200%.
  await leaveVoice(ana);
  await joinVoice(ana);
  await ana.getByTestId('participant').filter({ hasText: 'Beto' }).getByTestId('voice-person-menu').click();
  assert.equal(await ana.getByTestId('person-volume-value').textContent(), '200%');
  await ana.keyboard.press('Escape');

  // O Beto estava com o microfone ligado: sai, volta e continua ligado.
  await leaveVoice(beto);
  await joinVoice(beto);
  await waitFor(() => micPressed(beto), 'o microfone do Beto voltar ligado');
  // Desliga, sai e volta: continua desligado.
  await beto.getByTestId('user-mic').click();
  await waitFor(async () => !(await micPressed(beto)), 'o microfone do Beto desligar');
  await leaveVoice(beto);
  await joinVoice(beto);
  await beto.waitForTimeout(1500);
  assert.equal(await micPressed(beto), false, 'continua desligado');
  // Liga de novo e recarrega a página (como fechar e abrir o app): volta ligado.
  await beto.getByTestId('user-mic').click();
  await waitFor(() => micPressed(beto), 'o microfone ligar');
  await beto.reload();
  await beto.getByTestId('chat').waitFor();
  await joinVoice(beto);
  await waitFor(() => micPressed(beto), 'o microfone voltar ligado depois de recarregar');
});

test('"silenciar o que ouço" fica guardado separado do microfone', { skip: noSound }, async () => {
  await ana.getByTestId('user-deafen').click();
  assert.equal(await ana.getByTestId('user-deafen').getAttribute('aria-pressed'), 'true');
  await leaveVoice(ana);
  await joinVoice(ana);
  assert.equal(await ana.getByTestId('user-deafen').getAttribute('aria-pressed'), 'true', 'continua silenciado ao voltar');
  await ana.waitForTimeout(1500);
  const heard = await loudest(ana, 600);
  assert.ok(heard.rms < 0.01, `silenciada, a Ana não ouve nada (${heard.rms.toFixed(4)})`);
  await ana.getByTestId('user-deafen').click();
  await ana.waitForTimeout(1200);
  assert.ok((await loudest(ana, 600)).rms > 0.2, 'ao voltar a ouvir, o som volta');
});

test('sem permissão do microfone concedida, ele não abre sozinho', { skip: noSound }, async () => {
  // A Dani entra por um aparelho que ainda não deu permissão ao microfone neste site, com a preferência
  // "microfone ligado" guardada de uma chamada anterior.
  // (O navegador da Ana não aceita o microfone sozinho, ao contrário dos que têm o microfone de teste.)
  const fresh = await ana.context().browser().newContext({ viewport: { width: 1300, height: 850 } });
  await fresh.addInitScript(() => {
    localStorage.setItem('shareroom:microfone-ligado', 'true');
    window.__micOpens = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      window.__micOpens += 1;
      return original(constraints);
    };
  });
  const page = await fresh.newPage();
  await page.goto(invite);
  await signUp(page, 'dani');
  await page.getByTestId('join-accept').click();
  await page.getByTestId('chat').waitFor();
  await joinVoice(page);
  await page.waitForTimeout(1500);
  assert.equal(await micPressed(page), false, 'o microfone continua desligado');
  assert.equal(await page.evaluate(() => window.__micOpens), 0, 'nenhum pedido de microfone sem clique');
  await waitFor(async () => (await page.getByRole('status').filter({ hasText: /microfone estava ligado/ }).count()) > 0, 'o aviso de que o microfone estava ligado');
  await fresh.close();
});
