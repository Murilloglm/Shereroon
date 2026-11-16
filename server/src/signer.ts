import { concat, utf8 } from './bytes.ts';

/**
 * Assinaturas HMAC-SHA256 com separação de domínio. Usa só WebCrypto, então roda
 * igual em Node e em runtimes de borda (Cloudflare Workers).
 */
export class Signer {
  readonly #key: Promise<CryptoKey>;

  constructor(secret: string) {
    this.#key = crypto.subtle.importKey('raw', utf8(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }

  /** MAC de `label` + partes. Cada parte leva o tamanho na frente, então não há ambiguidade de concatenação. */
  async mac(label: string, ...parts: Uint8Array[]): Promise<Uint8Array> {
    const framed: Uint8Array[] = [utf8(label), new Uint8Array([0])];
    for (const part of parts) {
      framed.push(new Uint8Array([part.length >>> 8, part.length & 0xff]), part);
    }
    const signature = await crypto.subtle.sign('HMAC', await this.#key, concat(...framed) as BufferSource);
    return new Uint8Array(signature);
  }
}

/** PBKDF2-SHA256. 100 mil iterações é o teto aceito pelo WebCrypto dos Workers. */
export async function stretchPassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', utf8(password) as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 100_000 },
    material,
    256,
  );
  return new Uint8Array(bits);
}
