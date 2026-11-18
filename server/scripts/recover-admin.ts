/** Recuperação de emergência exclusiva do operador do banco, fora da aplicação web. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPassword } from '../src/community/auth.ts';
import { adminAudit } from '../src/community/global-admin.ts';
import { connectPglite, connectPostgres } from '../src/db/db.ts';

const root = resolve(import.meta.dirname, '../..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const id = process.env.COSMIC_RECOVERY_USER_ID?.trim();
const nextPassword = process.env.COSMIC_RECOVERY_NEW_PASSWORD;
const reason = process.env.COSMIC_RECOVERY_REASON?.trim();
delete process.env.COSMIC_RECOVERY_NEW_PASSWORD;
if (!id || process.env.COSMIC_RECOVERY_CONFIRM_ID !== id || !nextPassword || nextPassword.length < 12 || nextPassword.length > 128 || !reason || reason.length < 10) throw new Error('Forneça o ID, confirmação idêntica do ID, nova senha de 12 a 128 caracteres e motivo de recuperação. Consulte docs/cosmic-admin.md.');
const db = process.env.DATABASE_URL?.trim() ? await connectPostgres(process.env.DATABASE_URL.trim()) : process.env.NODE_ENV === 'production' ? null : await connectPglite(process.env.PGLITE_DIR || resolve(root, 'server/.data/pglite'));
if (!db) throw new Error('DATABASE_URL é obrigatória em produção.');
try {
  const hash = await hashPassword(nextPassword);
  await db.tx(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727274007)');
    const [admin] = await tx.query('SELECT user_id FROM global_permissions WHERE user_id = $1 AND is_primary FOR UPDATE', [id]);
    if (!admin) throw new Error('O ID não corresponde à conta principal já registrada.');
    await tx.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hash]);
    await tx.query("UPDATE global_permissions SET mfa_secret = NULL, mfa_pending = NULL, recovery_hashes = '[]'::jsonb, mfa_last_step = -1 WHERE user_id = $1", [id]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await adminAudit(tx, id, 'admin.recuperacao_emergencial', id, reason, { sessionsRevoked: true, passwordRotated: true, mfaReset: true });
  });
  console.log(`Conta principal recuperada: ${id}. Entre e cadastre um novo autenticador.`);
} finally { await db.close(); }
