// Convenção de versões do Cosmic Night: 0.3.0 → 0.3.1 → … → 0.3.9 → 0.4.0 → … → 0.9.9 → 1.0.0.
// Continua sendo SemVer válido (X.Y.Z); a regra "cada número vai de 0 a 9" é só da publicação.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { updateMessage } from '../src/update-trust.mjs';
import { checkPublishable, compareVersions, nextReleaseVersion, nextVersion, parseVersion, versionFromTag } from './versioning.mjs';

// O mesmo comparador que o electron-updater usa para decidir se há versão nova.
const semver = createRequire(createRequire(import.meta.url).resolve('electron-updater'))('semver');

test('próxima versão: o último número vai de 0 a 9 e transporta para o anterior', () => {
  assert.equal(nextVersion('0.3.0'), '0.3.1');
  assert.equal(nextVersion('0.3.8'), '0.3.9');
  assert.equal(nextVersion('0.3.9'), '0.4.0');
  assert.equal(nextVersion('0.4.9'), '0.5.0');
  assert.equal(nextVersion('0.9.9'), '1.0.0');
  assert.equal(nextVersion('1.9.9'), '2.0.0');
  assert.equal(nextVersion('9.9.9'), '10.0.0');
});

test('fora da convenção ou inválida: recusa em vez de adivinhar', () => {
  for (const bad of ['0.3.10', '0.10.0', '0.3', '0.3.0.0', 'v0.3.0', '00.3.0', '0.3.0-beta', '', 'abc']) {
    assert.throws(() => nextVersion(bad), /versão/i, bad);
  }
});

test('comparação numérica dos três números, nunca como texto ou decimal', () => {
  assert.equal(compareVersions('0.4.0', '0.3.9'), 1);
  assert.equal(compareVersions('0.3.9', '0.4.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.3.1', '0.3.1'), 0);
  // Como texto, "0.10.0" < "0.9.0"; como número decimal, 0.3.10 < 0.3.9. Os dois estariam errados.
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.3.10', '0.3.9'), 1);
  assert.deepEqual(parseVersion('0.3.1'), [0, 3, 1]);
});

test('o atualizador reconhece cada passo da sequência como versão mais nova (e nunca o contrário)', () => {
  let current = '0.3.0';
  for (let step = 0; step < 80; step++) {
    const next = nextVersion(current);
    assert.equal(compareVersions(next, current), 1);
    assert.equal(semver.gt(next, current), true, `${next} > ${current} para o electron-updater`);
    assert.equal(semver.gt(current, next), false);
    assert.equal(semver.valid(next), next, 'continua SemVer válido');
    current = next;
  }
  assert.equal(current, '1.1.0');
});

test('tags: v0.3.1 e as antigas preview-v0.3.0 viram versões; o resto é ignorado', () => {
  assert.equal(versionFromTag('v0.3.1'), '0.3.1');
  assert.equal(versionFromTag('preview-v0.3.0'), '0.3.0');
  assert.equal(versionFromTag('refs/tags/v1.0.0'), '1.0.0');
  assert.equal(versionFromTag('preview-42'), null);
  assert.equal(versionFromTag('v0.3.1-beta'), null);
});

test('próxima publicação: nunca reutiliza uma versão publicada', () => {
  const published = ['preview-v0.1.0', 'preview-v0.2.0', 'preview-v0.3.0'];
  assert.equal(nextReleaseVersion('0.3.0', published), '0.3.1');
  // Já subiu para 0.3.1 e ainda não publicou: prepara de novo sem pular número.
  assert.equal(nextReleaseVersion('0.3.1', published), '0.3.1');
  assert.equal(nextReleaseVersion('0.3.1', [...published, 'v0.3.1']), '0.3.2');
  // O package.json ficou para trás de uma versão publicada: segue a partir da publicada.
  assert.equal(nextReleaseVersion('0.2.0', published), '0.3.1');
  assert.equal(nextReleaseVersion('0.3.9', ['v0.3.9']), '0.4.0');
});

test('antes de publicar: recusa versão já publicada ou mais antiga que a última', () => {
  const published = ['preview-v0.2.0', 'preview-v0.3.0', 'v0.3.1'];
  assert.deepEqual(checkPublishable('0.3.2', published), { ok: true, tag: 'v0.3.2' });
  assert.match(checkPublishable('0.3.1', published).reason, /já foi publicada/);
  assert.match(checkPublishable('0.3.0', published).reason, /já foi publicada/);
  assert.match(checkPublishable('0.2.5', published).reason, /maior que a última publicada \(0\.3\.1\)/);
  assert.match(checkPublishable('0.3.10', published).reason, /versão/i);
});

test('compatível com a verificação das atualizações: as versões novas cabem na mensagem assinada', () => {
  const sha512 = 'A'.repeat(86) + '==';
  for (const version of ['0.3.1', '0.3.9', '0.4.0', '1.0.0', '10.0.0']) {
    assert.match(updateMessage({ version, file: `CosmicNight-Setup-${version}.exe`, sha512 }).toString('utf8'), new RegExp(`\\n${version.replace(/\./g, '\\.')}\\n`));
  }
});
