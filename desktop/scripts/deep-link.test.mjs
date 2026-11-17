import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkFromArgv, parseDeepLink } from '../src/deep-link.mjs';

test('convite válido abre a tela do convite', () => {
  assert.deepEqual(parseDeepLink('cosmicnight://convite/Ab12_cd-34'), { kind: 'convite', code: 'Ab12_cd-34' });
  assert.deepEqual(parseDeepLink('cosmicnight://convite/Ab12_cd-34/'), { kind: 'convite', code: 'Ab12_cd-34' });
});

test('qualquer outra coisa é ignorada', () => {
  for (const value of [
    'https://exemplo.com/convite/Ab12cd34',
    'cosmicnight://grupo/Ab12cd34',
    'cosmicnight://convite/curto',
    'cosmicnight://convite/Ab12cd34/extra',
    'cosmicnight://convite/Ab12cd34?x=1',
    'cosmicnight://convite/Ab12cd34#y',
    'cosmicnight://usuario:senha@convite/Ab12cd34',
    'cosmicnight://convite/Ab12%2Fcd34',
    'cosmicnight://convite/<script>',
    `cosmicnight://convite/${'a'.repeat(300)}`,
    'javascript:alert(1)',
    42,
    null,
  ]) {
    assert.equal(parseDeepLink(value), null, String(value));
  }
});

test('o link vem no meio dos argumentos do Windows', () => {
  assert.deepEqual(linkFromArgv(['C:\\CosmicNight.exe', '--allow-file-access', 'cosmicnight://convite/Ab12cd34']), { kind: 'convite', code: 'Ab12cd34' });
  assert.equal(linkFromArgv(['C:\\CosmicNight.exe']), null);
  assert.equal(linkFromArgv(undefined), null);
});
