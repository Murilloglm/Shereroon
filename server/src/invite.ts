import { concat, equalBytes, fromBase64Url, fromUtf8, randomBytes, toBase64Url, utf8 } from './bytes.ts';
import { Signer, stretchPassword } from './signer.ts';

/**
 * O convite É a sala: um código assinado que carrega id, nome, lotação e (se
 * houver) a marca da senha. O backend não guarda nada, então os links continuam
 * valendo mesmo que o servidor reinicie ou "durma" (hospedagens gratuitas).
 *
 * Layout binário (depois vira base64url):
 *   [0]      versão (1)
 *   [1..9]   id da sala (9 bytes aleatórios)
 *   [10]     flags (bit 0 = tem senha)
 *   [11]     lotação máxima
 *   [..10]   marca da senha (10 bytes) — só se tiver senha
 *   [1]      tamanho do nome em bytes
 *   [..n]    nome em UTF-8
 *   [..16]   HMAC-SHA256 truncado de tudo que vem antes
 */

const VERSION = 1;
const ID_BYTES = 9;
const PASSWORD_TAG_BYTES = 10;
const SIGNATURE_BYTES = 16;
const SECRET_BYTES = 18;
export const MAX_NAME_CHARS = 32;
export const MAX_PASSWORD_CHARS = 64;
export const MIN_CAPACITY = 2;
export const MAX_CAPACITY = 50;
export const DEFAULT_CAPACITY = 10;

export interface RoomDescriptor {
  id: Uint8Array;
  name: string;
  capacity: number;
  passwordTag: Uint8Array | null;
}

export function newRoomId(): Uint8Array {
  return randomBytes(ID_BYTES);
}

/** Nome da sala dentro do LiveKit. */
export function sfuRoomName(id: Uint8Array): string {
  return `sr-${toBase64Url(id)}`;
}

export async function passwordTag(signer: Signer, id: Uint8Array, password: string): Promise<Uint8Array> {
  const stretched = await stretchPassword(password, id);
  return (await signer.mac('senha', id, stretched)).slice(0, PASSWORD_TAG_BYTES);
}

export async function checkPassword(signer: Signer, room: RoomDescriptor, password: string): Promise<boolean> {
  if (!room.passwordTag) return true;
  return equalBytes(await passwordTag(signer, room.id, password), room.passwordTag);
}

/** Chave do dono: quem cria a sala recebe e guarda no próprio navegador. */
export async function hostKey(signer: Signer, id: Uint8Array): Promise<string> {
  return toBase64Url((await signer.mac('dono', id)).slice(0, SECRET_BYTES));
}

export async function isHostKey(signer: Signer, id: Uint8Array, candidate: unknown): Promise<boolean> {
  if (typeof candidate !== 'string' || candidate.length > 64) return false;
  return equalBytes(utf8(await hostKey(signer, id)), utf8(candidate));
}

/** Prova de que uma identidade foi emitida por este servidor para esta sala. */
export async function sessionProof(signer: Signer, id: Uint8Array, identity: string): Promise<string> {
  return toBase64Url((await signer.mac('sessao', id, utf8(identity))).slice(0, SECRET_BYTES));
}

export async function isSessionProof(
  signer: Signer,
  id: Uint8Array,
  identity: unknown,
  proof: unknown,
): Promise<boolean> {
  if (typeof identity !== 'string' || typeof proof !== 'string') return false;
  if (identity.length > 64 || proof.length > 64) return false;
  return equalBytes(utf8(await sessionProof(signer, id, identity)), utf8(proof));
}

export async function encodeInvite(signer: Signer, room: RoomDescriptor): Promise<string> {
  const name = utf8(room.name);
  if (room.id.length !== ID_BYTES) throw new Error('id de sala inválido');
  if (name.length > 255) throw new Error('nome de sala grande demais');
  if (!Number.isInteger(room.capacity) || room.capacity < MIN_CAPACITY || room.capacity > MAX_CAPACITY) {
    throw new Error('lotação inválida');
  }
  const body = concat(
    new Uint8Array([VERSION]),
    room.id,
    new Uint8Array([room.passwordTag ? 1 : 0, room.capacity]),
    room.passwordTag ?? new Uint8Array(0),
    new Uint8Array([name.length]),
    name,
  );
  const signature = (await signer.mac('convite', body)).slice(0, SIGNATURE_BYTES);
  return toBase64Url(concat(body, signature));
}

/** Retorna null para qualquer código malformado, adulterado ou assinado com outra chave. */
export async function decodeInvite(signer: Signer, code: unknown): Promise<RoomDescriptor | null> {
  if (typeof code !== 'string' || code.length < 20 || code.length > 512) return null;
  const bytes = fromBase64Url(code);
  if (!bytes || bytes.length < 1 + ID_BYTES + 2 + 1 + SIGNATURE_BYTES) return null;

  const body = bytes.slice(0, bytes.length - SIGNATURE_BYTES);
  const signature = bytes.slice(bytes.length - SIGNATURE_BYTES);
  const expected = (await signer.mac('convite', body)).slice(0, SIGNATURE_BYTES);
  if (!equalBytes(signature, expected)) return null;

  // A assinatura bateu, então o conteúdo foi montado por encodeInvite. Ainda assim, lê com cuidado.
  if (body[0] !== VERSION) return null;
  let offset = 1;
  const id = body.slice(offset, offset + ID_BYTES);
  offset += ID_BYTES;
  const hasPassword = (body[offset]! & 1) === 1;
  const capacity = body[offset + 1]!;
  offset += 2;
  let tag: Uint8Array | null = null;
  if (hasPassword) {
    tag = body.slice(offset, offset + PASSWORD_TAG_BYTES);
    offset += PASSWORD_TAG_BYTES;
  }
  const nameLength = body[offset];
  offset += 1;
  if (nameLength === undefined || offset + nameLength !== body.length) return null;
  try {
    return { id, name: fromUtf8(body.slice(offset)), capacity, passwordTag: tag };
  } catch {
    return null;
  }
}
