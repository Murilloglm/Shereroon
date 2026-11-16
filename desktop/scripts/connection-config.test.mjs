import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectionConfig, publicHttpsUrl, runtimeConnection } from '../src/connection-config.mjs';

test('distribuição exige destinos públicos; localhost e rede privada são recusados', () => {
  for (const address of ['', 'http://api.example.com', 'https://localhost', 'https://localhost.', 'https://127.0.0.1', 'https://10.0.0.1',
    'https://172.16.0.1', 'https://192.168.1.3', 'https://169.254.1.1', 'https://100.64.0.1', 'https://[::1]',
    'https://[fc00::1]', 'https://[::ffff:127.0.0.1]', 'https://pc.local', 'https://user:senha@api.example.com',
    'https://api.example.com?token=segredo', 'https://api.example.com/#local']) {
    assert.throws(() => publicHttpsUrl(address, 'Servidor'), /HTTPS pública/);
  }
  assert.equal(publicHttpsUrl('https://share.example.com/', 'Servidor'), 'https://share.example.com');
});

test('config cloud não cai para servidor no computador quando destino falta', () => {
  assert.throws(() => connectionConfig({}), /SHAREROOM_API_URL/);
  assert.throws(() => runtimeConnection({}, {}, true), /SHAREROOM_API_URL/);
  const cloud = connectionConfig({ apiUrl: 'https://share.example.com', siteUrl: 'https://share.example.com' });
  assert.equal(cloud.connectionMode, 'cloud');
  assert.deepEqual(runtimeConnection(cloud, {}, true), cloud);
  assert.throws(() => runtimeConnection(cloud, { SHAREROOM_API_URL: 'https://localhost' }, true), /HTTPS pública/);
});

test('desenvolvimento e pacote explicitamente local mantêm teste no próprio computador', () => {
  const local = connectionConfig({}, { local: true });
  assert.equal(local.connectionMode, 'local');
  assert.equal(local.apiUrl, 'http://localhost:8787');
  assert.deepEqual(runtimeConnection(local, {}, true), local);
  assert.deepEqual(runtimeConnection({}, {}, false), local);
});
