/** Verificação somente leitura. Não aplica migrações, cria contas ou concede permissões. */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { MIGRATIONS } from '../src/db/schema.ts';

const afterDeploy = process.argv.includes('--after-deploy');
const expected = Number(process.argv.find((arg) => arg.startsWith('--expect-schema='))?.split('=')[1] ?? (afterDeploy ? MIGRATIONS.at(-1)!.id : 6));
const url = process.env.DATABASE_URL?.trim();
if (!url || process.env.NODE_ENV !== 'production') throw new Error('Execute com NODE_ENV=production e DATABASE_URL injetada pelo ambiente seguro. Não há fallback para banco local.');
const databaseFingerprint = createHash('sha256').update(new URL(url).hostname.replace('-pooler.', '.')).digest('hex').slice(0, 12);
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '10s'");
  const tables = new Set((await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((row) => String(row.tablename)));
  if (!tables.has('schema_migrations') || !tables.has('users')) throw new Error('Banco sem as tabelas existentes esperadas.');
  const applied = (await client.query('SELECT id, name FROM schema_migrations ORDER BY id')).rows;
  const last = Number(applied.at(-1)?.id ?? 0);
  const pending = MIGRATIONS.filter((migration) => !applied.some((row) => Number(row.id) === migration.id)).map(({ id, name }) => ({ id, name }));
  const missingBaseline = pending.filter((migration) => migration.id <= expected);
  const mg = (await client.query("SELECT id, username FROM users WHERE username_key='mg' AND NOT is_bot")).rows;
  const admins = tables.has('global_permissions') ? (await client.query('SELECT user_id, is_primary, mfa_secret IS NOT NULL AS mfa_enabled FROM global_permissions')).rows : [];
  const proof = (await client.query("SELECT current_setting('transaction_read_only') AS read_only, current_setting('server_version_num') AS postgres_version")).rows[0];
  const tableNames = ['global_permissions', 'admin_audit', 'security_limits', 'promo_codes', 'promo_redemptions', 'shop_settings', 'gifts', 'global_settings'];
  const collisions = last < 7 ? tableNames.filter((name) => tables.has(name)) : [];
  const missingTables = last >= 7 ? tableNames.filter((name) => !tables.has(name)) : [];
  const columns = new Set((await client.query("SELECT table_name || '.' || column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('sessions','user_items','global_permissions')")).rows.map((row) => String(row.name)));
  const addedColumns = ['sessions.admin_verified_until', 'user_items.admin_grant', 'user_items.acquisition_id'];
  const columnCollisions = last < 7 ? addedColumns.filter((name) => columns.has(name)) : [];
  const missingColumns = last >= 7 ? addedColumns.filter((name) => !columns.has(name)) : [];
  if (last >= 8 && !columns.has('global_permissions.mfa_exempt')) missingColumns.push('global_permissions.mfa_exempt');
  if (last < 8 && columns.has('global_permissions.mfa_exempt')) columnCollisions.push('global_permissions.mfa_exempt');
  const ok = last === expected && missingBaseline.length === 0 && collisions.length === 0 && missingTables.length === 0 && columnCollisions.length === 0 && missingColumns.length === 0 && proof.read_only === 'on';
  console.log(JSON.stringify({ ok, databaseFingerprint, mode: afterDeploy ? 'after-deploy' : 'before-deploy', ...proof, applied, pending, expectedSchema: expected, missingBaseline, collisions, missingTables, columnCollisions, missingColumns, mg, admins, bootstrapRequired: admins.length === 0, appSecretConfiguredInThisProcess: Boolean(process.env.APP_SECRET && process.env.APP_SECRET.trim().length >= 16), appSecretProductionValueRead: false, wroteDatabase: false }, null, 2));
  await client.query('ROLLBACK');
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, databaseFingerprint, errorCode: (error as { code?: string }).code ?? 'PREFLIGHT_FAILED', wroteDatabase: false }));
  process.exitCode = 1;
} finally { await client.end(); }
