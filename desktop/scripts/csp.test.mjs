// Política de segurança da página do aplicativo: código só de dentro do app; imagens também do backend
// configurado (fotos de perfil, banners e emojis do grupo vêm de lá), e de mais nenhum outro lugar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentSecurityPolicy } from '../src/csp.mjs';

const directive = (csp, name) => csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));

test('imagens: o próprio app, data:, blob: e a origem do backend configurado', () => {
  const csp = contentSecurityPolicy('https://shareroom-api-y1r7.onrender.com');
  assert.equal(directive(csp, 'img-src'), "img-src 'self' data: blob: https://shareroom-api-y1r7.onrender.com");
});

test('a origem vale sem caminho, consulta ou barra no fim', () => {
  assert.equal(directive(contentSecurityPolicy('https://api.exemplo.com/base/'), 'img-src'), "img-src 'self' data: blob: https://api.exemplo.com");
  assert.equal(directive(contentSecurityPolicy('http://localhost:8787'), 'img-src'), "img-src 'self' data: blob: http://localhost:8787");
});

test('sem backend válido, as imagens ficam só no próprio app', () => {
  for (const value of [undefined, '', 'nada', 'javascript:alert(1)', "https://a.com'; script-src *"]) {
    assert.equal(directive(contentSecurityPolicy(value), 'img-src'), "img-src 'self' data: blob:", String(value));
  }
});

test('o resto da política não muda: scripts só do app, nada de objetos nem formulários', () => {
  const csp = contentSecurityPolicy('https://shareroom-api-y1r7.onrender.com');
  assert.equal(directive(csp, 'script-src'), "script-src 'self' 'wasm-unsafe-eval'");
  assert.equal(directive(csp, 'default-src'), "default-src 'self'");
  assert.equal(directive(csp, 'object-src'), "object-src 'none'");
  assert.equal(directive(csp, 'form-action'), "form-action 'none'");
  assert.ok(!directive(csp, 'script-src').includes('onrender'));
});
