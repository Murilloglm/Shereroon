// Assinatura das atualizações (Ed25519).
//
//   node scripts/update-signing.mjs gerar <arquivo-da-chave-privada>
//     Cria um par de chaves. A privada vai SÓ para o arquivo indicado (fora do repositório) e depois para o
//     secret COSMIC_UPDATE_SIGNING_KEY do GitHub Actions; a pública entra em update-keys.json.
//     Nunca imprime a chave privada e nunca sobrescreve um arquivo existente.
//
//   node scripts/update-signing.mjs assinar <pasta-da-release>
//     No GitHub Actions: lê a chave privada de COSMIC_UPDATE_SIGNING_KEY, assina (versão, instalador, SHA-512)
//     do latest.yml e grava o campo cosmicSignature. Antes de gravar, confere que a assinatura bate com uma das
//     chaves públicas embutidas no aplicativo; se não bater, falha (uma release que ninguém aceitaria).
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublicKeys, SIGNATURE_FIELD, signatureMatches, signUpdate } from '../src/update-trust.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const KEYS_FILE = resolve(here, '../update-keys.json');

/** Lê do latest.yml só o necessário (versão, instalador e SHA-512 dele). */
export function readManifest(text) {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1];
  const path = /^path:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1];
  const sha512 = /^sha512:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1];
  // O primeiro arquivo da lista é o instalador; tem de ser o mesmo de "path".
  const firstUrl = /^files:\s*\n\s*-\s*url:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1];
  const firstSha = /^files:\s*\n\s*-\s*url:[^\n]*\n\s*sha512:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1];
  if (!version || !path || !sha512) throw new Error('latest.yml sem version, path ou sha512.');
  if (firstUrl && (firstUrl !== path || firstSha !== sha512)) throw new Error('latest.yml com instalador ambíguo (files[0] diferente de path).');
  return { version, file: path, sha512 };
}

export function signManifestText(text, privateKeyPem, publicKeys) {
  const entry = readManifest(text);
  const signature = signUpdate(privateKeyPem, entry);
  if (!signatureMatches(entry, signature, publicKeys)) {
    throw new Error('A chave privada do secret não corresponde a nenhuma chave pública de update-keys.json. O aplicativo recusaria esta atualização.');
  }
  const cleaned = text.replace(new RegExp(`^${SIGNATURE_FIELD}:.*\\n?`, 'm'), '');
  return { text: `${cleaned.replace(/\n*$/, '\n')}${SIGNATURE_FIELD}: ${signature}\n`, entry };
}

export function generateKeys(privatePath, keysFile = KEYS_FILE) {
  if (existsSync(privatePath)) throw new Error(`Já existe ${privatePath}. Não sobrescrevo chaves.`);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const current = existsSync(keysFile) ? readPublicKeys(keysFile) : [];
  writeFileSync(keysFile, `${JSON.stringify({ keys: [...current, publicPem] }, null, 2)}\n`);
  return publicPem;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, target] = process.argv.slice(2);
  if (command === 'gerar' && target) {
    generateKeys(resolve(target));
    console.log(`Chave privada gravada em ${resolve(target)} (guarde uma cópia segura; ela não é impressa).`);
    console.log(`Chave pública adicionada a ${KEYS_FILE}.`);
  } else if (command === 'assinar' && target) {
    const secret = process.env.COSMIC_UPDATE_SIGNING_KEY ?? '';
    if (!secret.includes('PRIVATE KEY')) throw new Error('Defina o secret COSMIC_UPDATE_SIGNING_KEY (chave privada Ed25519 em PEM).');
    const privateKey = createPrivateKey(secret);
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('COSMIC_UPDATE_SIGNING_KEY precisa ser uma chave Ed25519.');
    const publicKeys = readPublicKeys(process.env.SHAREROOM_UPDATE_KEYS || KEYS_FILE);
    if (publicKeys.length === 0) throw new Error('update-keys.json não tem nenhuma chave pública Ed25519.');
    const manifest = resolve(target, 'latest.yml');
    const { text, entry } = signManifestText(readFileSync(manifest, 'utf8'), secret, publicKeys);
    writeFileSync(manifest, text);
    console.log(`latest.yml assinado: ${entry.file} ${entry.version} (chave pública ${createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-8).toString('hex')}…).`);
  } else {
    console.error('Uso: update-signing.mjs gerar <arquivo-privado> | assinar <pasta-da-release>');
    process.exitCode = 2;
  }
}
