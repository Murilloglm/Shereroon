// Confiança nas atualizações. Antes de qualquer instalador novo rodar, o aplicativo confere duas coisas:
//   1. o SHA-512 do arquivo baixado é o mesmo publicado no latest.yml (o electron-updater já faz isso ao baixar,
//      e conferimos de novo aqui, inclusive logo antes de instalar);
//   2. o latest.yml traz uma assinatura Ed25519 de (versão, nome do arquivo, SHA-512) feita pelo GitHub Actions
//      com a chave privada guardada nos Secrets do repositório. A chave pública vai dentro do aplicativo.
// Sem assinatura válida, nada é instalado: o arquivo é apagado e a pessoa vê o motivo.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Campo extra no latest.yml com a assinatura (o electron-updater repassa campos desconhecidos). */
export const SIGNATURE_FIELD = 'cosmicSignature';
const FORMAT = 'cosmicnight-update/1';

const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SAFE_FILE = /^[\w.-]+\.exe$/;
const SAFE_SHA512 = /^[A-Za-z0-9+/]{86}==$/;

/** O texto assinado. Só aceita valores bem formados, para nunca assinar ou aceitar algo ambíguo. */
export function updateMessage({ version, file, sha512 }) {
  if (!SAFE_VERSION.test(String(version))) throw new Error('versão inválida no manifesto da atualização');
  if (!SAFE_FILE.test(String(file))) throw new Error('nome de arquivo inválido no manifesto da atualização');
  if (!SAFE_SHA512.test(String(sha512))) throw new Error('SHA-512 inválido no manifesto da atualização');
  return Buffer.from(`${FORMAT}\n${version}\n${file}\n${sha512}`, 'utf8');
}

/** O instalador principal descrito no latest.yml. */
export function mainFile(info) {
  const fromList = Array.isArray(info?.files) ? info.files.find((entry) => typeof entry?.url === 'string' && /\.exe$/i.test(entry.url)) : null;
  const url = fromList?.url ?? info?.path;
  const sha512 = fromList?.sha512 ?? info?.sha512;
  return { file: typeof url === 'string' ? url : '', sha512: typeof sha512 === 'string' ? sha512 : '' };
}

export function signUpdate(privateKeyPem, entry) {
  return sign(null, updateMessage(entry), createPrivateKey(privateKeyPem)).toString('base64');
}

/** Confere a assinatura com qualquer uma das chaves públicas conhecidas (permite trocar a chave sem quebrar). */
export function signatureMatches(entry, signature, publicKeys) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  let message;
  try {
    message = updateMessage(entry);
  } catch {
    return false;
  }
  const bytes = Buffer.from(signature, 'base64');
  return publicKeys.some((key) => {
    try {
      const publicKey = createPublicKey(key);
      return publicKey.asymmetricKeyType === 'ed25519' && verify(null, message, publicKey, bytes);
    } catch {
      return false;
    }
  });
}

export async function sha512File(path) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('base64');
}

/**
 * Decide se o arquivo baixado pode ser instalado. Devolve { ok: true } ou { ok: false, reason } com um motivo
 * curto ('sem-chave', 'sem-assinatura', 'manifesto', 'arquivo', 'hash', 'assinatura').
 */
export async function verifyDownload(info, downloadedFile, publicKeys) {
  if (!Array.isArray(publicKeys) || publicKeys.length === 0) return { ok: false, reason: 'sem-chave' };
  const signature = info?.[SIGNATURE_FIELD];
  if (typeof signature !== 'string' || !signature) return { ok: false, reason: 'sem-assinatura' };
  const { file, sha512 } = mainFile(info);
  const entry = { version: info?.version, file, sha512 };
  try {
    updateMessage(entry);
  } catch {
    return { ok: false, reason: 'manifesto' };
  }
  // O electron-updater guarda o download com o nome do arquivo publicado: tem de ser o mesmo assinado.
  if (typeof downloadedFile !== 'string' || basename(downloadedFile).toLowerCase() !== file.toLowerCase()) return { ok: false, reason: 'arquivo' };
  let actual;
  try {
    actual = await sha512File(downloadedFile);
  } catch {
    return { ok: false, reason: 'arquivo' };
  }
  if (actual !== sha512) return { ok: false, reason: 'hash' };
  if (!signatureMatches(entry, signature, publicKeys)) return { ok: false, reason: 'assinatura' };
  return { ok: true };
}

/** Chaves públicas embutidas no aplicativo. Arquivo ausente ou estragado = nenhuma chave = nada é instalado. */
export function readPublicKeys(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const keys = Array.isArray(parsed?.keys) ? parsed.keys.filter((key) => typeof key === 'string' && key.includes('BEGIN PUBLIC KEY')) : [];
    return keys.filter((key) => {
      try {
        return createPublicKey(key).asymmetricKeyType === 'ed25519';
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Novidades da versão em texto simples (o GitHub manda HTML). Nada de HTML chega à interface. */
export function notesToText(notes) {
  const html = Array.isArray(notes) ? notes.map((entry) => (typeof entry?.note === 'string' ? entry.note : '')).join('\n') : typeof notes === 'string' ? notes : '';
  const text = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|pre|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === '#') {
        const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) && value > 31 && value < 0x110000 ? String.fromCodePoint(value) : '';
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > 4000 ? `${text.slice(0, 3999)}…` : text;
}

/** Mensagem compreensível para os erros do electron-updater (sem despejar pilha técnica na tela). */
export function friendlyUpdateError(error) {
  const text = String(error?.message ?? error ?? '');
  const code = String(error?.code ?? '');
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|ERR_NETWORK_CHANGED|ERR_CONNECTION_(REFUSED|RESET|TIMED_OUT|CLOSED|FAILED|ABORTED)|ERR_EMPTY_RESPONSE|ERR_ADDRESS_UNREACHABLE|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_IO_SUSPENDED|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_TIMED_OUT|ERR_PROXY/i.test(text + code)) {
    return { kind: 'offline', message: 'Sem conexão com o servidor de atualizações. Vamos tentar de novo mais tarde.' };
  }
  if (/ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_NO_PUBLISHED_VERSIONS|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|HttpError: 404/i.test(text + code)) {
    return { kind: 'sem-versao', message: 'Ainda não há uma versão publicada com atualização automática.' };
  }
  if (/sha512 checksum mismatch|ERR_CHECKSUM_MISMATCH|ERR_UPDATER_INVALID_SIGNATURE/i.test(text + code)) {
    return { kind: 'integridade', message: 'O arquivo baixado não bateu com o publicado e foi descartado. Tente baixar de novo.' };
  }
  if (/ENOSPC/i.test(text + code)) return { kind: 'disco', message: 'Falta espaço em disco para baixar a atualização.' };
  if (/HttpError: (403|429)|rate limit/i.test(text)) return { kind: 'limite', message: 'O GitHub limitou as consultas por agora. Vamos tentar de novo mais tarde.' };
  return { kind: 'erro', message: 'Não foi possível concluir a atualização agora. Vamos tentar de novo mais tarde.' };
}

/** Motivo de recusa em português. */
export const REJECTION_TEXT = {
  'sem-chave': 'Este aplicativo não tem a chave para conferir atualizações, então não instala nenhuma sozinho.',
  'sem-assinatura': 'A versão publicada não veio assinada pelo Cosmic Night e foi recusada.',
  manifesto: 'As informações da versão publicada estão malformadas e foram recusadas.',
  arquivo: 'O arquivo baixado não é o que foi publicado e foi descartado.',
  hash: 'O arquivo baixado não bateu com o publicado e foi descartado.',
  assinatura: 'A assinatura da atualização não confere. O arquivo foi descartado e nada foi instalado.',
};
