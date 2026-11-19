import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

describe('migrações de produção a partir da 0.3.2', () => {
  it('aplica as migrações 7 e 8 e preserva conta, saldo, histórico, inventário, equipamento e sessão', async () => {
    await legacyDatabase();
    const userBefore = await db.query("SELECT * FROM users WHERE id='legacy'");
    const ledgerBefore = await db.query('SELECT * FROM points_ledger');
    expect(await migrate(db)).toEqual([7, 8, 9, 10]);
    expect(await db.query("SELECT * FROM users WHERE id='legacy'")).toEqual(userBefore);
    expect(await db.query('SELECT * FROM points_ledger')).toEqual(ledgerBefore);
    expect((await db.query('SELECT * FROM user_items'))[0]).toMatchObject({ user_id: 'legacy', item_id: 'anel-aurora', price: 150, admin_grant: false, acquisition_id: null });
    expect((await db.query('SELECT * FROM user_equipped'))[0]).toMatchObject({ user_id: 'legacy', item_id: 'anel-aurora', variant: 'neon' });
    expect((await db.query('SELECT * FROM sessions'))[0]).toMatchObject({ token_hash: 'legacy-session', admin_verified_until: null });
    expect(await db.query('SELECT * FROM global_permissions')).toEqual([]);
    expect(await migrate(db)).toEqual([]);
  });
  it('a migração 8 não dispensa MFA nem altera os fatores e sessões já existentes', async () => {
    await legacyDatabase();
    const seven = MIGRATIONS.find((entry) => entry.id === 7)!;
    await db.exec(seven.sql);
    await db.query('INSERT INTO schema_migrations (id,name) VALUES ($1,$2)', [seven.id, seven.name]);
    await db.query("INSERT INTO global_permissions (user_id,is_primary,mfa_secret,recovery_hashes) VALUES ('legacy',true,'segredo-cifrado-existente','[\"hash-existente\"]'::jsonb)");
    await db.query("UPDATE sessions SET admin_verified_until=now()+interval '5 minutes' WHERE user_id='legacy'");
    const [before] = await db.query('SELECT * FROM global_permissions');
    const sessions = await db.query('SELECT * FROM sessions');
    expect(await migrate(db)).toEqual([8, 9, 10]);
    expect((await db.query('SELECT * FROM global_permissions'))[0]).toEqual({ ...before, mfa_exempt: false });
    expect(await db.query('SELECT * FROM sessions')).toEqual(sessions);
    expect(await db.query('SELECT * FROM admin_audit')).toEqual([]);
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

it('atualiza a 0.3.4 com a migração 10 sem alterar migrações publicadas ou mensagens confirmadas', async () => {
  const published = JSON.parse(readFileSync(new URL('./fixtures/schema-v034.json', import.meta.url), 'utf8'));
  const currentPublished = MIGRATIONS.filter(migration => migration.id <= 9);
  expect(currentPublished.map(({ id, name, sql }) => ({ id, name, sha256: createHash('sha256').update(sql).digest('hex') }))).toEqual(published);
  await legacyDatabase();
  for (const migration of currentPublished.filter(migration => migration.id > 6)) {
    await db.exec(migration.sql);
    await db.query('INSERT INTO schema_migrations (id,name) VALUES ($1,$2)', [migration.id, migration.name]);
  }
  await db.query("INSERT INTO groups (id,name,owner_id) VALUES ('old-group','Existente','legacy')");
  await db.query("INSERT INTO channels (id,name,kind,group_id) VALUES ('old-channel','geral','texto','old-group')");
  await db.query("INSERT INTO messages (channel_id,author_id,content,client_id) VALUES ('old-channel','legacy','Confirmada antes do upgrade','client-original-034')");
  const messagesBefore = await db.query('SELECT * FROM messages');
  const before = await db.query('SELECT * FROM users');
  expect(await migrate(db)).toEqual([10]);
  expect(await db.query('SELECT * FROM users')).toEqual(before);
  expect(await db.query('SELECT * FROM messages')).toEqual(messagesBefore.map(message => ({ ...message, client_hash: null })));
  expect(await migrate(db)).toEqual([]);
}, 30_000);
