import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/db.ts';
import { ApiError } from '../errors.ts';
import { cleanText, newId, verifyPassword, type User } from './auth.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** Contador compartilhado pelo PostgreSQL: reinícios e múltiplas instâncias não zeram tentativas. */
export async function securityLimit(db: Db, key: string, limit: number, seconds = 600): Promise<boolean> {
  const rows = await db.query(`INSERT INTO security_limits (key, hits, window_until)
    VALUES ($1,1,now() + $3::integer * interval '1 second')
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN security_limits.window_until <= now() THEN 1 ELSE security_limits.hits + 1 END,
      window_until = CASE WHEN security_limits.window_until <= now() THEN EXCLUDED.window_until ELSE security_limits.window_until END
    WHERE security_limits.window_until <= now() OR security_limits.hits < $2 RETURNING hits`, [digest(key), limit, seconds]);
  return rows.length > 0;
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export function totp(secret: string, step = Math.floor(Date.now() / 30_000)): string {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = hash[19]! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export async function isCosmicAdmin(db: Db, userId: string): Promise<boolean> {
  return (await db.query('SELECT 1 FROM global_permissions WHERE user_id = $1', [userId])).length > 0;
}
export async function unlimitedCosmetics(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.query('SELECT unlimited_cosmetics FROM global_permissions WHERE user_id = $1', [userId]);
  return row?.unlimited_cosmetics === true;
}
export async function adminAudit(db: Db, actor: string, action: string, target = '', reason = '', detail: unknown = {}): Promise<void> {
  await db.query('INSERT INTO admin_audit (actor_id, action, target_id, reason, detail) VALUES ($1, $2, $3, $4, $5::jsonb)', [actor, action, target, reason, JSON.stringify(detail)]);
}
export function requireReason(input: Record<string, unknown>): string {
  const reason = cleanText(input.reason, 300);
  if (input.confirm !== true || reason.length < 5) throw new ApiError(400, 'confirmacao_necessaria', 'Confirme a operação e informe um motivo de pelo menos 5 caracteres.');
  return reason;
}
export function requestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{12,80}$/.test(value)) throw new ApiError(400, 'pedido_invalido', 'Informe uma chave de operação válida.');
  return value;
}
export function integer(value: unknown, min: number, max = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new ApiError(400, 'numero_invalido', `Informe um inteiro entre ${min} e ${max}.`);
  return value;
}

/** Exclusivamente CLI: sem endpoint HTTP e sem vincular privilégio a um nome visível. */
export async function bootstrapAdmin(db: Db, userId: string, password: string): Promise<void> {
  const [user] = await db.query('SELECT password_hash, is_bot FROM users WHERE id = $1', [userId]);
  if (!user || user.is_bot || !(await verifyPassword(password, String(user.password_hash)))) throw new Error('ID ou credencial da conta não confere.');
  await db.tx(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727274007)');
    if ((await tx.query('SELECT 1 FROM global_permissions LIMIT 1')).length) throw new Error('A administração já foi inicializada. Use o painel ou o procedimento de recuperação.');
    await tx.query('INSERT INTO global_permissions (user_id, is_primary) VALUES ($1, true)', [userId]);
    await adminAudit(tx, userId, 'admin.bootstrap', userId, 'Inicialização administrativa por CLI com ID imutável e verificação da senha');
  });
}

/** Procedimento local exclusivo do operador. Não há endpoint que conceda esta exceção. */
export async function setOwnerMfaExemption(db: Db, userId: string, password: string, exempt: boolean, reason: string): Promise<void> {
  const why = cleanText(reason, 300);
  if (why.length < 10) throw new ApiError(400, 'motivo_necessario', 'Informe um motivo de pelo menos 10 caracteres.');
  const [account] = await db.query('SELECT password_hash FROM users WHERE id = $1 AND NOT is_bot', [userId]);
  if (!account || password.length > 128 || !(await verifyPassword(password, String(account.password_hash)))) throw new ApiError(401, 'senha_incorreta', 'ID ou credencial da conta não confere.');
  await db.tx(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727274007)');
    const [owner] = await tx.query('SELECT is_primary FROM global_permissions WHERE user_id = $1 FOR UPDATE', [userId]);
    if (!owner?.is_primary) throw new ApiError(403, 'so_conta_principal', 'A exceção é exclusiva do ID da conta principal já inicializada.');
    await tx.query("UPDATE global_permissions SET mfa_exempt = $2, mfa_secret = NULL, mfa_pending = NULL, mfa_last_step = -1, recovery_hashes = '[]'::jsonb WHERE user_id = $1", [userId, exempt]);
    await tx.query('UPDATE sessions SET admin_verified_until = NULL WHERE user_id = $1', [userId]);
    await adminAudit(tx, userId, exempt ? 'admin.mfa_dispensado' : 'admin.mfa_exigido', userId, why, { ownerOnly: true, mfaExempt: exempt });
  });
}

/** MFA ligado à sessão opaca existente; a prova expira e nunca é uma flag enviada pelo cliente. */
export class CosmicAdmin {
  readonly db: Db;
  readonly #key: Buffer | null;
  constructor(db: Db, secret?: string) {
    this.db = db;
    this.#key = secret ? createHash('sha256').update(`cosmic-admin-mfa:${secret}`).digest() : null;
  }
  async require(user: User): Promise<void> {
    if (!(await isCosmicAdmin(this.db, user.id))) throw new ApiError(403, 'admin_global_necessario', 'Esta área é exclusiva da Administração Cosmic.');
  }
  async requireMfa(user: User, token: string | null): Promise<void> {
    await this.require(user);
    const [session] = await this.db.query(`SELECT 1 FROM sessions s JOIN global_permissions g ON g.user_id = s.user_id
      WHERE s.user_id = $1 AND s.token_hash = $2 AND s.expires_at > now()
        AND ((g.is_primary AND g.mfa_exempt) OR s.admin_verified_until > now())`, [user.id, digest(token ?? '')]);
    if (!session) throw new ApiError(403, 'mfa_necessario', 'Verifique o segundo fator em Administração Cosmic. A confirmação vale por 10 minutos.');
  }
  async status(user: User, token: string | null) {
    await this.require(user);
    const [row] = await this.db.query('SELECT mfa_secret IS NOT NULL AS enrolled, is_primary, mfa_exempt FROM global_permissions WHERE user_id = $1', [user.id]);
    let verified = true;
    try { await this.requireMfa(user, token); } catch { verified = false; }
    return { enrolled: row!.enrolled === true, primary: row!.is_primary === true, mfaExempt: row!.is_primary === true && row!.mfa_exempt === true, verified };
  }
  #seal(value: string): string {
    if (!this.#key) throw new ApiError(503, 'mfa_configuracao', 'Configure uma APP_SECRET persistente no backend para usar MFA.');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  #open(value: string): string {
    if (!this.#key) throw new ApiError(503, 'mfa_configuracao', 'A chave de MFA não está configurada.');
    const data = Buffer.from(value, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', this.#key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
  }
  async enroll(user: User, password: unknown) {
    await this.require(user);
    const [policy] = await this.db.query('SELECT is_primary, mfa_exempt FROM global_permissions WHERE user_id = $1', [user.id]);
    if (policy?.is_primary && policy.mfa_exempt) throw new ApiError(409, 'mfa_dispensado', 'Esta conta principal está dispensada de MFA pelo procedimento administrativo.');
    const [row] = await this.db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (typeof password !== 'string' || password.length > 128 || !(await verifyPassword(password, String(row!.password_hash)))) throw new ApiError(401, 'senha_incorreta', 'A senha atual não confere.');
    const secret = base32(randomBytes(20));
    const updated = await this.db.query('UPDATE global_permissions SET mfa_pending = $2 WHERE user_id = $1 AND mfa_secret IS NULL RETURNING user_id', [user.id, this.#seal(secret)]);
    if (!updated.length) throw new ApiError(409, 'mfa_configurado', 'MFA já configurado. Use um código de recuperação se perdeu o autenticador.');
    return { secret, uri: `otpauth://totp/Cosmic%20Night:${encodeURIComponent(user.username)}?secret=${secret}&issuer=Cosmic%20Night&digits=6&period=30` };
  }
  async verify(user: User, token: string | null, code: unknown) {
    await this.require(user);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new ApiError(400, 'mfa_invalido', 'Informe os 6 dígitos do autenticador.');
    return this.db.tx(async (tx) => {
      const [row] = await tx.query('SELECT * FROM global_permissions WHERE user_id = $1 FOR UPDATE', [user.id]);
      if (!row) throw new ApiError(403, 'admin_global_necessario', 'Privilégio revogado.');
      if (row.is_primary && row.mfa_exempt) throw new ApiError(409, 'mfa_dispensado', 'Esta conta principal está dispensada de MFA.');
      const encrypted = row.mfa_secret ?? row.mfa_pending;
      if (!encrypted) throw new ApiError(400, 'mfa_nao_configurado', 'Configure o autenticador primeiro.');
      const secret = this.#open(String(encrypted));
      const step = Math.floor(Date.now() / 30_000);
      const match = [step - 1, step, step + 1].find((candidate) => timingSafeEqual(Buffer.from(totp(secret, candidate)), Buffer.from(code)));
      if (match === undefined || match <= Number(row.mfa_last_step)) throw new ApiError(401, 'mfa_invalido', 'Código inválido ou já utilizado. Aguarde o próximo código.');
      const recoveryCodes = row.mfa_secret ? [] : Array.from({ length: 10 }, () => newId(18));
      await tx.query('UPDATE global_permissions SET mfa_secret = $2, mfa_pending = NULL, mfa_last_step = $3, recovery_hashes = $4::jsonb WHERE user_id = $1', [user.id, encrypted, match, JSON.stringify(recoveryCodes.length ? recoveryCodes.map(digest) : row.recovery_hashes)]);
      const sessions = await tx.query("UPDATE sessions SET admin_verified_until = now() + interval '10 minutes' WHERE token_hash = $1 AND user_id = $2 AND expires_at > now() RETURNING user_id", [digest(token ?? ''), user.id]);
      if (!sessions.length) throw new ApiError(401, 'sessao_invalida', 'Entre novamente.');
      await adminAudit(tx, user.id, recoveryCodes.length ? 'admin.mfa_ativado' : 'admin.mfa_verificado', user.id);
      return { verified: true, recoveryCodes };
    });
  }
  async recover(user: User, input: Record<string, unknown>) {
    await this.require(user);
    const [account] = await this.db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (typeof input.password !== 'string' || input.password.length > 128 || !(await verifyPassword(input.password, String(account!.password_hash)))) throw new ApiError(401, 'senha_incorreta', 'A senha atual não confere.');
    const code = typeof input.recoveryCode === 'string' ? input.recoveryCode.trim() : '';
    await this.db.tx(async (tx) => {
      const [row] = await tx.query('SELECT recovery_hashes, is_primary, mfa_exempt FROM global_permissions WHERE user_id = $1 FOR UPDATE', [user.id]);
      if (row?.is_primary && row.mfa_exempt) throw new ApiError(409, 'mfa_dispensado', 'Esta conta principal está dispensada de MFA.');
      const hashes = row?.recovery_hashes as string[] | undefined;
      if (!hashes?.includes(digest(code))) throw new ApiError(401, 'recuperacao_invalida', 'Código de recuperação inválido.');
      await tx.query("UPDATE global_permissions SET mfa_secret = NULL, mfa_pending = NULL, recovery_hashes = '[]'::jsonb, mfa_last_step = -1 WHERE user_id = $1", [user.id]);
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      await adminAudit(tx, user.id, 'admin.mfa_recuperado', user.id, 'Senha e código de recuperação; todas as sessões encerradas');
    });
    return { ok: true, loginRequired: true };
  }
}
