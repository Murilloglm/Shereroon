import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { connectPglite } from '../src/db/db.ts';
import { MIGRATIONS } from '../src/db/schema.ts';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../..');
const prefix = resolve(tmpdir(), 'cosmic-bootstrap-cli-');
let folder: string | undefined;
const testPassword = 'senha-temporaria-exclusiva-de-teste';

afterEach(async () => {
  if (folder && resolve(folder).startsWith(prefix)) await rm(folder, { recursive: true, force: true });
  folder = undefined;
}, 30_000);

async function prepareLegacy() {
  folder = await mkdtemp(prefix);
  const dataDir = resolve(folder, 'db');
  const db = await connectPglite(dataDir);
  try {
    await db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const migration of MIGRATIONS.filter((entry) => entry.id <= 6)) {
      await db.exec(migration.sql);
      await db.query('INSERT INTO schema_migrations (id,name) VALUES ($1,$2)', [migration.id, migration.name]);
    }
  } finally { await db.close(); }
  return dataDir;
}
function cli(dataDir: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return exec(process.execPath, ['server/scripts/bootstrap-admin.ts', ...args], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'development', PGLITE_DIR: dataDir, COSMIC_BOOTSTRAP_USER_ID: '', COSMIC_BOOTSTRAP_PASSWORD: testPassword, ...env },
    timeout: 20_000,
  });
}

describe('procedimento de inicialização administrativa por CLI', () => {
  it('consultar Mg não aplica a migração 7 nem altera o banco existente', async () => {
    const path = await prepareLegacy();
    const output = await cli(path, ['--lookup', 'Mg']);
    expect(output.stdout.trim()).toBe('[]');
    const db = await connectPglite(path);
    try {
      expect((await db.query('SELECT max(id) AS id FROM schema_migrations'))[0]!.id).toBe(6);
      expect((await db.query("SELECT to_regclass('public.global_permissions') AS name"))[0]!.name).toBeNull();
    } finally { await db.close(); }
  }, 30_000);
  it('cria Mg uma única vez, registra o ID e exige configurar MFA; não imprime senha nem deixa sessão aberta', async () => {
    const path = await prepareLegacy();
    const output = await cli(path, ['--create-mg']);
    expect(output.stdout).toContain('ID imutável:');
    expect(output.stdout).not.toContain(testPassword);
    expect(output.stderr).not.toContain(testPassword);
    const db = await connectPglite(path);
    try {
      const [row] = await db.query("SELECT u.username, u.password_hash, gp.is_primary, gp.mfa_secret FROM users u JOIN global_permissions gp ON gp.user_id=u.id WHERE u.username_key='mg'");
      expect(row).toMatchObject({ username: 'Mg', is_primary: true, mfa_secret: null });
      expect(row!.password_hash).not.toBe(testPassword);
      expect(await db.query('SELECT * FROM sessions')).toEqual([]);
      expect((await db.query("SELECT count(*)::integer AS count FROM admin_audit WHERE action='admin.bootstrap'"))[0]!.count).toBe(1);
    } finally { await db.close(); }
    await expect(cli(path, ['--create-mg'])).rejects.toThrow('A administração já foi inicializada');
  }, 30_000);
  it('produção sem DATABASE_URL falha antes de abrir ou migrar um banco local', async () => {
    const path = await prepareLegacy();
    await expect(cli(path, ['--create-mg'], { NODE_ENV: 'production' })).rejects.toThrow('DATABASE_URL é obrigatória em produção');
    const db = await connectPglite(path);
    try {
      expect((await db.query('SELECT max(id) AS id FROM schema_migrations'))[0]!.id).toBe(6);
      expect(await db.query("SELECT id FROM users WHERE username_key='mg'")).toEqual([]);
    } finally { await db.close(); }
  }, 30_000);
});
