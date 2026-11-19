/**
 * Contas e sessões. A senha nunca é guardada: fica só o resultado do scrypt (uma função lenta e que usa
 * bastante memória, de propósito) com um sal aleatório por conta. A sessão é um código aleatório; no banco
 * fica só o SHA-256 dele, então um vazamento do banco não entrega sessões válidas.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { iso, type Db } from '../db/db.ts';
import { ApiError } from '../errors.ts';

export const USERNAME_RULE = /^[A-Za-z0-9_.]{2,24}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;
const SESSION_DAYS = 30;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export interface AuthOptions {
  /** Custo do scrypt como potência de 2 (15 = 32 MB por tentativa). Os testes usam um valor menor. */
  scryptCost?: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  createdAt: string;
  cosmicAdmin?: boolean;
  mfaExempt?: boolean;
  /** Acesso global autorizado por segundo fator ou exceção explícita da conta principal. */
  adminVerified?: boolean;
}

function derive(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { N: 2 ** cost, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string, cost = 15): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, cost);
  return `scrypt$${cost}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !cost || !salt || !key) return false;
  const level = Number(cost);
  if (!Number.isInteger(level) || level < 10 || level > 20) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), level);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const newId = (bytes = 12): string => randomBytes(bytes).toString('base64url');
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const toUser = (row: Record<string, unknown>): User => ({
  id: String(row.id),
  username: String(row.username),
  displayName: String(row.display_name),
  avatar: row.avatar == null ? null : String(row.avatar),
  createdAt: iso(row.created_at),
  cosmicAdmin: row.cosmic_admin === true,
  mfaExempt: row.cosmic_mfa_exempt === true,
  adminVerified: row.cosmic_mfa_exempt === true || (row.admin_verified_until != null && new Date(String(row.admin_verified_until)).getTime() > Date.now()),
});

const GLOBAL_ACCOUNT_FIELDS = `EXISTS (SELECT 1 FROM global_permissions g WHERE g.user_id = u.id) AS cosmic_admin,
  EXISTS (SELECT 1 FROM global_permissions g WHERE g.user_id = u.id AND g.is_primary AND g.mfa_exempt) AS cosmic_mfa_exempt`;

export class Accounts {
  readonly #db: Db;
  readonly #cost: number;
  /** Senha fictícia: quando a conta não existe, o login gasta o mesmo tempo de uma conta real. */
  #decoy: Promise<string> | null = null;

  constructor(db: Db, options: AuthOptions = {}) {
    this.#db = db;
    this.#cost = options.scryptCost ?? 15;
  }

  async register(input: { username: unknown; displayName: unknown; password: unknown }): Promise<{ user: User; token: string }> {
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    if (!USERNAME_RULE.test(username)) {
      throw new ApiError(400, 'usuario_invalido', 'O nome de usuário deve ter de 2 a 24 caracteres: letras sem acento, números, ponto ou sublinhado.');
    }
    const password = this.#checkPassword(input.password);
    const displayName = cleanText(input.displayName, 32) || username;
    const id = newId();
    const hash = await hashPassword(password, this.#cost);
    try {
      await this.#db.query('INSERT INTO users (id, username, username_key, display_name, password_hash) VALUES ($1, $2, $3, $4, $5)', [
        id,
        username,
        username.toLowerCase(),
        displayName,
        hash,
      ]);
    } catch (error) {
      if (/unique|duplicate/i.test(String((error as Error).message))) {
        throw new ApiError(409, 'usuario_em_uso', 'Esse nome de usuário já está em uso. Escolha outro.');
      }
      throw error;
    }
    const user = (await this.byId(id))!;
    return { user, token: await this.#openSession(id) };
  }

  async login(input: { username: unknown; password: unknown }): Promise<{ user: User; token: string }> {
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const [row] = await this.#db.query(`SELECT u.*, ${GLOBAL_ACCOUNT_FIELDS} FROM users u WHERE username_key = $1`, [username]);
    this.#decoy ??= hashPassword('senha que ninguém usa', this.#cost);
    const ok = password.length <= MAX_PASSWORD && (await verifyPassword(password, row ? String(row.password_hash) : await this.#decoy));
    // A mesma resposta para "conta não existe" e "senha errada": não dá para descobrir nomes de usuário por aqui.
    if (!row || !ok) throw new ApiError(401, 'login_invalido', 'Usuário ou senha incorretos.');
    return { user: toUser(row), token: await this.#openSession(String(row.id)) };
  }

  /** Quem é o dono deste código de sessão? Devolve null se não existe ou venceu. */
  async authenticate(token: string | undefined | null): Promise<User | null> {
    if (!token || token.length < 20 || token.length > 200) return null;
    const hash = hashToken(token);
    const [row] = await this.#db.query(
      `SELECT u.*, s.last_seen_at, s.admin_verified_until, ${GLOBAL_ACCOUNT_FIELDS} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hash],
    );
    if (!row) return null;
    // Sessão em uso se renova sozinha; a gravação é espaçada para não escrever no banco a cada requisição.
    if (Date.now() - new Date(String(row.last_seen_at)).getTime() > 10 * 60_000) {
      await this.#db.query(`UPDATE sessions SET last_seen_at = now(), expires_at = now() + interval '${SESSION_DAYS} days' WHERE token_hash = $1`, [hash]);
    }
    return toUser(row);
  }

  async logout(token: string): Promise<void> {
    await this.#db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  }

  /** Encerra todas as sessões da conta (em todos os aparelhos). */
  async logoutEverywhere(userId: string): Promise<void> {
    await this.#db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }

  async changePassword(userId: string, current: unknown, next: unknown): Promise<string> {
    const [row] = await this.#db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (!row || typeof current !== 'string' || !(await verifyPassword(current, String(row.password_hash)))) {
      throw new ApiError(401, 'senha_incorreta', 'A senha atual não confere.');
    }
    const hash = await hashPassword(this.#checkPassword(next), this.#cost);
    await this.#db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
    // Trocar a senha derruba as outras sessões; quem trocou recebe uma nova.
    await this.logoutEverywhere(userId);
    return this.#openSession(userId);
  }

  async updateProfile(userId: string, displayName: unknown): Promise<User> {
    const clean = cleanText(displayName, 32);
    if (!clean) throw new ApiError(400, 'nome_invalido', 'Escolha um nome para aparecer nos grupos.');
    await this.#db.query('UPDATE users SET display_name = $1 WHERE id = $2', [clean, userId]);
    return (await this.byId(userId))!;
  }

  async byId(id: string): Promise<User | null> {
    const [row] = await this.#db.query(`SELECT u.*, ${GLOBAL_ACCOUNT_FIELDS} FROM users u WHERE id = $1`, [id]);
    return row ? toUser(row) : null;
  }

  async purgeExpired(): Promise<void> {
    await this.#db.query('DELETE FROM sessions WHERE expires_at <= now()');
    await this.#db.query("DELETE FROM security_limits WHERE window_until < now() - interval '1 day'");
  }

  #checkPassword(value: unknown): string {
    if (typeof value !== 'string' || value.length < MIN_PASSWORD || value.length > MAX_PASSWORD) {
      throw new ApiError(400, 'senha_invalida', `A senha deve ter de ${MIN_PASSWORD} a ${MAX_PASSWORD} caracteres.`);
    }
    return value;
  }

  async #openSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.#db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [
      hashToken(token),
      userId,
    ]);
    return token;
  }
}

/** Tira caracteres de controle, junta espaços e corta por caractere (não por byte). */
export function cleanText(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string') return '';
  let text = value.normalize('NFC');
  text = multiline
    ? text.replace(/\r\n?/g, '\n').replace(/[^\P{Cc}\n\t]/gu, '').replace(/[\p{Zl}\p{Zp}]/gu, '\n').replace(/\n{4,}/g, '\n\n\n')
    : text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ');
  return Array.from(text.trim()).slice(0, max).join('').trim();
}
