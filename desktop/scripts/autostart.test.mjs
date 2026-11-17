import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanAutostart, HIDDEN_FLAG, loginItemFor, readAutostart, writeAutostart } from '../src/autostart.mjs';

test('começa desligado e guarda a escolha entre aberturas', () => {
  const folder = mkdtempSync(join(tmpdir(), 'cn-inicio-'));
  try {
    assert.deepEqual(readAutostart(folder), { enabled: false, minimized: false });
    writeAutostart(folder, { enabled: true, minimized: true });
    assert.deepEqual(readAutostart(folder), { enabled: true, minimized: true });
    writeFileSync(join(folder, 'inicializacao.json'), 'lixo');
    assert.deepEqual(readAutostart(folder), { enabled: false, minimized: false }, 'arquivo estragado volta ao padrão desligado');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('só aceita booleanos vindos da interface', () => {
  const current = { enabled: false, minimized: false };
  assert.deepEqual(cleanAutostart({ enabled: true }, current), { enabled: true, minimized: false });
  assert.deepEqual(cleanAutostart({ enabled: 'sim', minimized: 1 }, current), current);
  assert.deepEqual(cleanAutostart(null, current), current);
});

test('registro no Windows: o próprio executável, escondido só se pedido', () => {
  assert.deepEqual(loginItemFor({ enabled: true, minimized: true }, 'C:\\App\\CosmicNight.exe'), { openAtLogin: true, path: 'C:\\App\\CosmicNight.exe', args: [HIDDEN_FLAG] });
  assert.deepEqual(loginItemFor({ enabled: false, minimized: true }, 'C:\\App\\CosmicNight.exe').openAtLogin, false);
  assert.deepEqual(loginItemFor({ enabled: true, minimized: false }, 'x').args, []);
});
