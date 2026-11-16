import type { Db } from './db.ts';

/**
 * Migrações, em ordem. Cada uma roda uma única vez, dentro de uma transação. Nunca edite uma migração já
 * publicada: acrescente outra no fim.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'contas, grupos, cargos, canais, mensagens e auditoria',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      CREATE TABLE groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT,
        is_public BOOLEAN NOT NULL DEFAULT false,
        owner_id TEXT NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT,
        position INTEGER NOT NULL,
        permissions BIGINT NOT NULL DEFAULT 0,
        is_everyone BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX roles_group ON roles(group_id);
      CREATE UNIQUE INDEX roles_one_everyone ON roles(group_id) WHERE is_everyone;

      CREATE TABLE members (
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        nickname TEXT,
        timeout_until TIMESTAMPTZ,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (group_id, user_id)
      );
      CREATE INDEX members_user ON members(user_id);

      CREATE TABLE member_roles (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, user_id, role_id),
        FOREIGN KEY (group_id, user_id) REFERENCES members(group_id, user_id) ON DELETE CASCADE
      );

      CREATE TABLE channels (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('categoria', 'texto', 'voz')),
        name TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT '',
        parent_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
        position INTEGER NOT NULL DEFAULT 0,
        user_limit INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX channels_group ON channels(group_id);

      CREATE TABLE overrides (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('cargo', 'membro')),
        target_id TEXT NOT NULL,
        allow BIGINT NOT NULL DEFAULT 0,
        deny BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (channel_id, target_kind, target_id)
      );

      CREATE TABLE messages (
        id BIGSERIAL PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        author_name TEXT,
        content TEXT NOT NULL,
        mention_everyone BOOLEAN NOT NULL DEFAULT false,
        pinned BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        edited_at TIMESTAMPTZ
      );
      CREATE INDEX messages_channel ON messages(channel_id, id DESC);

      CREATE TABLE invites (
        code TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        max_uses INTEGER NOT NULL DEFAULT 0,
        uses INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX invites_group ON invites(group_id);

      CREATE TABLE bans (
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        banned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (group_id, user_id)
      );

      CREATE TABLE voice_blocks (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (channel_id, user_id)
      );

      CREATE TABLE audit_log (
        id BIGSERIAL PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        target_kind TEXT NOT NULL DEFAULT '',
        target_id TEXT NOT NULL DEFAULT '',
        target_name TEXT NOT NULL DEFAULT '',
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX audit_group ON audit_log(group_id, id DESC);
    `,
  },
  {
    id: 2,
    name: 'bots: instalações, registros, dados e tarefas agendadas',
    sql: `
      -- Um bot instalado é um membro do grupo (conta marcada como bot, sem senha válida) com um cargo próprio.
      ALTER TABLE users ADD COLUMN is_bot BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE roles ADD COLUMN bot_id TEXT;
      -- Botões e outros complementos das mensagens de bots.
      ALTER TABLE messages ADD COLUMN meta JSONB;

      CREATE TABLE bot_installs (
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        bot_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        channels JSONB,
        command_roles JSONB,
        display_name TEXT,
        prefix TEXT NOT NULL DEFAULT '!',
        last_error TEXT,
        installed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (group_id, bot_id)
      );

      CREATE TABLE bot_logs (
        id BIGSERIAL PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        bot_id TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        action TEXT NOT NULL,
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX bot_logs_group ON bot_logs(group_id, id DESC);

      -- Estado de cada bot em cada grupo (advertências, XP, enquetes...), por assunto e chave.
      CREATE TABLE bot_data (
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        bot_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (group_id, bot_id, scope, key)
      );

      -- Fila de tarefas agendadas. Uma tarefa é "pega" por uma instância por vez (locked_until).
      CREATE TABLE bot_jobs (
        id BIGSERIAL PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        bot_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        run_at TIMESTAMPTZ NOT NULL,
        every_seconds INTEGER,
        locked_until TIMESTAMPTZ,
        attempts INTEGER NOT NULL DEFAULT 0,
        done_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX bot_jobs_due ON bot_jobs(run_at) WHERE done_at IS NULL;
    `,
  },
];

/** Aplica o que ainda não foi aplicado. Seguro para rodar a cada inicialização. */
export async function migrate(db: Db): Promise<number[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    await db.tx(async (tx) => {
      // Duas instâncias subindo juntas não aplicam a mesma migração duas vezes.
      await tx.query('SELECT pg_advisory_xact_lock(727274001)');
      const done = await tx.query('SELECT 1 FROM schema_migrations WHERE id = $1', [migration.id]);
      if (done.length > 0) return;
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [migration.id, migration.name]);
      applied.push(migration.id);
    });
  }
  return applied;
}
