/** Ajuste exclusivo do operador, por ID confirmado; não existe rota HTTP equivalente. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectPglite, connectPostgres } from '../src/db/db.ts';
import { setOwnerMfaExemption } from '../src/community/global-admin.ts';

const root = resolve(import.meta.dirname, '../..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const id = process.env.COSMIC_OWNER_USER_ID?.trim();
const password = process.env.COSMIC_OWNER_PASSWORD;
const reason = process.env.COSMIC_OWNER_REASON?.trim();
delete process.env.COSMIC_OWNER_PASSWORD;
const exempt = process.argv.includes('--exempt');
const requireMfa = process.argv.includes('--require');
if (!id || process.env.COSMIC_OWNER_CONFIRM_ID !== id || !password || !reason || exempt === requireMfa) throw new Error('Forneça ID e confirmação idênticos, senha e motivo pelo ambiente seguro; escolha --exempt ou --require.');
const db = process.env.DATABASE_URL?.trim() ? await connectPostgres(process.env.DATABASE_URL.trim()) : process.env.NODE_ENV === 'production' ? null : await connectPglite(process.env.PGLITE_DIR || resolve(root, 'server/.data/pglite'));
if (!db) throw new Error('DATABASE_URL é obrigatória em produção.');
try {
  const [migration] = await db.query('SELECT 1 FROM schema_migrations WHERE id = 8');
  if (!migration) throw new Error('Aplique e valide a migração 8 no backend antes deste procedimento.');
  await setOwnerMfaExemption(db, id, password, exempt, reason);
  console.log(JSON.stringify({ userId: id, mfaExempt: exempt, audited: true }));
} finally { await db.close(); }
