// Configurações → Atualizações, com uma ponte de aplicativo de mentira (o fluxo real, com instaladores
// assinados, é coberto por desktop/scripts/update-real.mjs). Confere: versão instalada, procurar manualmente,
// novidades, "Baixar atualização" só quando pedem, barra de progresso, "Reiniciar e atualizar" pedindo
// confirmação durante uma chamada (diálogo do app, não nativo), "Instalar depois", recusa por assinatura com
// "Limpar", e a cópia antiga sem canal mostrando o motivo e o link de download.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BASE_URL, launchChrome, startStack, waitFor } from './harness.mjs';

const headless = process.env.E2E_HEADLESS === '1';
let stack;
let browser;
let page;
const nativeDialogs = [];

/** Ponte falsa: o teste dirige o estado por window.__upd. */
function FAKE_BRIDGE({ apiUrl, supported }) {
  const listeners = new Set();
  const calls = [];
  let status = supported
    ? { supported: true, currentVersion: '0.2.0', autoCheck: true, state: 'atualizado', version: null, notes: '', percent: null, message: null, messageKind: null, installOnQuit: false, lastCheck: Date.now() }
    : { supported: false, currentVersion: '0.1.0', state: 'indisponivel', reason: 'Esta cópia veio de um instalador sem canal de atualização.', message: null };
  let activity = { inRoom: false, sharing: false };
  const emit = (patch) => {
    status = { ...status, ...patch };
    for (const listener of listeners) listener(status);
    return status;
  };
  window.__upd = { calls, emit, setActivity: (next) => (activity = next), status: () => status };
  window.shareroomDesktop = {
    config: { apiUrl, siteUrl: '', helperPort: null, version: status.currentVersion, packaged: true },
    listSources: async () => [],
    chooseSource: async () => false,
    setState: () => {},
    onCommand: () => () => {},
    update: {
      status: async () => status,
      check: async () => {
        calls.push('check');
        return emit({ state: 'disponivel', version: '0.3.0', releaseName: 'Cosmic Night 0.3.0', notes: 'Novidades\n\n• Chat de voz\n• Corrige eco', size: 120 * 1024 * 1024, lastCheck: Date.now() });
      },
      download: async () => {
        calls.push('download');
        return emit({ state: 'baixando', percent: 0, transferred: 0, total: 120 * 1024 * 1024, bytesPerSecond: 0 });
      },
      restart: async (confirmed) => {
        calls.push(confirmed ? 'restart:confirmado' : 'restart');
        if (!confirmed && (activity.inRoom || activity.sharing)) return { ok: false, needsConfirm: activity.sharing ? 'transmissao' : 'chamada' };
        emit({ state: 'instalando' });
        return { ok: true };
      },
      later: async () => {
        calls.push('later');
        return emit({ installOnQuit: true, message: 'A atualização será instalada quando você fechar o Cosmic Night.', messageKind: 'info' });
      },
      setAutoCheck: async (on) => {
        calls.push(`auto:${on}`);
        return emit({ autoCheck: on });
      },
      dismiss: async () => {
        calls.push('dismiss');
        return emit({ state: 'disponivel', message: null, messageKind: null });
      },
      onStatus: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

async function newAccount(context, username) {
  const tab = await context.newPage();
  tab.on('dialog', (native) => {
    nativeDialogs.push(native.message());
    void native.dismiss();
  });
  await tab.goto(BASE_URL);
  await tab.getByTestId('home-groups').click();
  await tab.getByTestId('auth-tab-criar').click();
  await tab.getByTestId('auth-username').fill(username);
  await tab.getByTestId('auth-display-name').fill(username);
  await tab.getByTestId('auth-password').fill('senha-de-teste-1');
  await tab.getByTestId('auth-submit').click();
  await tab.getByTestId('account-settings-open').waitFor();
  return tab;
}

const updates = () => page.getByTestId('app-update');
const stateIs = (state) => waitFor(async () => (await updates().getAttribute('data-state')) === state, `estado ${state}`);

before(async () => {
  stack = await startStack();
  browser = await launchChrome({ headless });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(FAKE_BRIDGE, { apiUrl: BASE_URL, supported: true });
  page = await newAccount(context, 'upd');
  await page.getByTestId('account-settings-open').click();
  await updates().waitFor();
});

after(async () => {
  await browser?.close();
  await stack?.stop();
});

test('mostra a versão instalada, procura e mostra as novidades sem baixar sozinho', async () => {
  assert.equal(await page.getByTestId('update-current').textContent(), '0.2.0');
  assert.match(await page.getByTestId('update-headline').textContent(), /mais recente/);
  await page.getByTestId('update-check').click();
  await stateIs('disponivel');
  assert.match(await page.getByTestId('update-headline').textContent(), /0\.3\.0 disponível/);
  const notes = await page.getByTestId('update-notes').textContent();
  assert.match(notes, /Cosmic Night 0\.3\.0/);
  assert.match(notes, /Chat de voz/);
  assert.match(notes, /120 MB/);
  assert.deepEqual(await page.evaluate(() => window.__upd.calls), ['check'], 'nada é baixado sem clicar');
});

test('baixar mostra a barra de progresso e termina pronta para instalar', async () => {
  await page.getByTestId('update-download').click();
  await stateIs('baixando');
  await page.evaluate(() => window.__upd.emit({ percent: 42, transferred: 50 * 1024 * 1024, bytesPerSecond: 5 * 1024 * 1024 }));
  const bar = page.getByTestId('update-progress');
  await waitFor(async () => (await bar.getAttribute('aria-valuenow')) === '42', 'progresso 42%');
  assert.match(await updates().textContent(), /42% · 50 MB de 120 MB · 5,0 MB\/s/);
  await page.evaluate(() => window.__upd.emit({ state: 'conferindo', percent: 100 }));
  await waitFor(async () => /Conferindo a assinatura/.test(await page.getByTestId('update-headline').textContent()), 'conferindo');
  await page.evaluate(() => window.__upd.emit({ state: 'pronta' }));
  await page.getByTestId('update-restart').waitFor();
  await page.getByTestId('update-later').waitFor();
});

test('em chamada, reiniciar pede confirmação no diálogo do app; cancelar não reinicia', async () => {
  await page.evaluate(() => window.__upd.setActivity({ inRoom: true, sharing: true }));
  await page.getByTestId('update-restart').click();
  const dialog = page.getByTestId('dialog');
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /transmitindo/);
  await page.getByTestId('dialog-cancel').click();
  await waitFor(async () => (await dialog.count()) === 0, 'o diálogo fechar');
  assert.equal(await updates().getAttribute('data-state'), 'pronta');

  await page.getByTestId('update-restart').click();
  await dialog.waitFor();
  await page.getByTestId('dialog-confirm').click();
  await stateIs('instalando');
  assert.deepEqual((await page.evaluate(() => window.__upd.calls)).filter((call) => call.startsWith('restart')), ['restart', 'restart', 'restart:confirmado']);
  assert.deepEqual(nativeDialogs, [], 'nenhuma janela nativa');
});

test('instalar depois, procurar automaticamente e recusa por assinatura com "Limpar"', async () => {
  await page.evaluate(() => window.__upd.emit({ state: 'pronta', installOnQuit: false }));
  await page.getByTestId('update-later').click();
  await waitFor(async () => /quando você fechar/.test(await page.getByTestId('update-headline').textContent()), 'instalar ao fechar');
  assert.match(await page.getByTestId('update-message').textContent(), /quando você fechar/);
  assert.equal(await page.getByTestId('update-later').count(), 0);

  const toggle = page.getByRole('switch', { name: 'Procurar atualizações automaticamente' });
  await toggle.click();
  await waitFor(async () => (await page.evaluate(() => window.__upd.status().autoCheck)) === false, 'desligar a busca automática');

  await page.evaluate(() => window.__upd.emit({ state: 'recusada', installOnQuit: false, message: 'A assinatura da atualização não confere. O arquivo foi descartado e nada foi instalado.', messageKind: 'erro' }));
  const message = page.getByTestId('update-message');
  await waitFor(async () => /assinatura/.test(await message.textContent()), 'mensagem de recusa');
  assert.equal(await message.getAttribute('role'), 'alert');
  assert.equal(await page.getByTestId('update-restart').count(), 0, 'recusada não pode ser instalada');
  await page.getByTestId('update-dismiss').click();
  await stateIs('disponivel');
  assert.equal(await page.getByTestId('update-message').count(), 0);
});

test('cópia antiga sem canal: explica o motivo e aponta a página de downloads', async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript(FAKE_BRIDGE, { apiUrl: BASE_URL, supported: false });
  const old = await newAccount(context, 'antigo');
  await old.getByTestId('account-settings-open').click();
  await old.getByTestId('update-reason').waitFor();
  assert.match(await old.getByTestId('update-reason').textContent(), /sem canal de atualização/);
  assert.equal(await old.getByTestId('update-reason').locator('a').getAttribute('href'), 'https://murilloglm.github.io/Shereroon/');
  assert.equal(await old.getByTestId('update-check').count(), 0);
  await context.close();
});
