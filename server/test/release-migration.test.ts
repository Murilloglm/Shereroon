import { afterEach, describe, expect, it } from 'vitest';
import { connectPglite, type Db } from '../src/db/db.ts';
import { MIGRATIONS, migrate } from '../src/db/schema.ts';

let db: Db;
afterEach(async () => { await db?.close(); });

async function legacyDatabase() {
  db = await connectPglite();
  await db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const migration of MIGRATIONS.filter((entry) => entry.id <= 6)) {
    await db.tx(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO schema_migrations (id,name) VALUES ($1,$2)', [migration.id, migration.name]);
    });
  }
  await db.query("INSERT INTO users (id,username,username_key,display_name,password_hash,points) VALUES ('legacy','legacy','legacy','Conta existente','hash-existente',500)");
  await db.query("INSERT INTO user_items (user_id,item_id,price) VALUES ('legacy','anel-aurora',150)");
  await db.query("INSERT INTO user_equipped (user_id,slot,item_id,variant) VALUES ('legacy','decoracao','anel-aurora','neon')");
  await db.query("INSERT INTO points_ledger (id,user_id,delta,reason,ref,day) VALUES ('entry','legacy',500,'teste','legacy-ref','2026-11-17')");
  await db.query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ('legacy-session','legacy',now()+interval '1 day')");
}

describe('migração de produção da 0.3.2 para 0.3.3', () => {
  it('aplica somente a migração 7 e preserva conta, saldo, histórico, inventário, equipamento e sessão', async () => {
    await legacyDatabase();
    const userBefore = await db.query("SELECT * FROM users WHERE id='legacy'");
    const ledgerBefore = await db.query('SELECT * FROM points_ledger');
    expect(await migrate(db)).toEqual([7]);
    expect(await db.query("SELECT * FROM users WHERE id='legacy'")).toEqual(userBefore);
    expect(await db.query('SELECT * FROM points_ledger')).toEqual(ledgerBefore);
    expect((await db.query('SELECT * FROM user_items'))[0]).toMatchObject({ user_id: 'legacy', item_id: 'anel-aurora', price: 150, admin_grant: false, acquisition_id: null });
    expect((await db.query('SELECT * FROM user_equipped'))[0]).toMatchObject({ user_id: 'legacy', item_id: 'anel-aurora', variant: 'neon' });
    expect((await db.query('SELECT * FROM sessions'))[0]).toMatchObject({ token_hash: 'legacy-session', admin_verified_until: null });
    expect(await db.query('SELECT * FROM global_permissions')).toEqual([]);
    expect(await migrate(db)).toEqual([]);
  });
  it('reverte a migração inteira em caso de colisão, sem conceder permissões ou alterar saldo', async () => {
    await legacyDatabase();
    await db.exec('CREATE TABLE gifts (id TEXT PRIMARY KEY)');
    await expect(migrate(db)).rejects.toThrow();
    expect(await db.query('SELECT id FROM schema_migrations WHERE id=7')).toEqual([]);
    expect((await db.query("SELECT to_regclass('public.global_permissions') AS name"))[0]!.name).toBeNull();
    expect((await db.query("SELECT points FROM users WHERE id='legacy'"))[0]!.points).toBe(500);
    expect((await db.query('SELECT item_id FROM user_items'))[0]!.item_id).toBe('anel-aurora');
  });
});
