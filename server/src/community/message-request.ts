import { createHash } from 'node:crypto';
import { ApiError } from '../errors.ts';

export function messageRequest(value: unknown, payload: unknown): { clientId: string | null; hash: string | null } {
  if (value === undefined) return { clientId: null, hash: null };
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(value)) throw new ApiError(400, 'id_invalido', 'Identificador de mensagem inválido.');
  return { clientId: value, hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

export function checkMessageRequest(stored: unknown, expected: string | null): void {
  // A 0.3.4 gravava client_id sem hash. Esses retries continuam devolvendo a confirmação original.
  if (stored === null || stored === undefined) return;
  if (stored !== expected) throw new ApiError(409, 'id_reutilizado', 'Este identificador já foi usado para outra mensagem.');
}
