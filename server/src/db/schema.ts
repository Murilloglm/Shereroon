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
  {
    id: 3,
    name: 'chat: anexos, respostas, menções, reações, não lidas e notificações',
    sql: `
      ALTER TABLE messages ADD COLUMN reply_to BIGINT REFERENCES messages(id) ON DELETE SET NULL;
      -- Contas mencionadas na mensagem (ids), para contar menções pendentes.
      ALTER TABLE messages ADD COLUMN mentions JSONB NOT NULL DEFAULT '[]'::jsonb;

      -- Arquivos enviados no chat. O conteúdo fica no próprio banco: sobrevive a reinícios da hospedagem e só
      -- sai pelo backend, que confere a permissão de ver o canal a cada leitura.
      CREATE TABLE files (
        id TEXT PRIMARY KEY,
        seq BIGSERIAL,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        -- Nulo enquanto o arquivo foi enviado mas a mensagem ainda não: some sozinho se nunca for anexado.
        message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX files_message ON files(message_id);
      CREATE INDEX files_group ON files(group_id);

      CREATE TABLE reactions (
        seq BIGSERIAL,
        message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (message_id, emoji, user_id)
      );

      -- Até onde cada pessoa leu cada canal.
      CREATE TABLE read_states (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        last_read_id BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, channel_id)
      );
      -- Quem já era membro começa com tudo lido: o histórico antigo não vira uma pilha de não lidas.
      INSERT INTO read_states (user_id, channel_id, last_read_id)
        SELECT m.user_id, c.id, (SELECT coalesce(max(id), 0) FROM messages)
          FROM members m JOIN channels c ON c.group_id = m.group_id WHERE c.kind = 'texto';

      -- Nível de notificação por pessoa: do grupo (channel_id vazio) e de cada canal.
      CREATE TABLE notify_settings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL DEFAULT '',
        level TEXT NOT NULL CHECK (level IN ('tudo', 'mencoes', 'nada')),
        PRIMARY KEY (user_id, group_id, channel_id)
      );

      -- Permissão nova "Adicionar reações" (bit 36): entra no @everyone dos grupos que já existem.
      UPDATE roles SET permissions = permissions | 68719476736 WHERE is_everyone;
    `,
  },
  {
    id: 4,
    name: 'perfis, amizades, mensagens privadas, notas pessoais, entrada no grupo, bots na lista, chat de voz e emojis',
    sql: `
      -- Perfil. avatar: 'padrao:<n>' ou 'arquivo:<id>'; banner: 'cor:#rrggbb' ou 'arquivo:<id>'.
      ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN status_text TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN avatar TEXT;
      ALTER TABLE users ADD COLUMN banner TEXT;
      -- Quem vê bio, status e servidores em comum: qualquer conta que encontrar o perfil, quem divide um
      -- grupo, ou só amigos. Nome e foto aparecem sempre (são necessários para as conversas funcionarem).
      ALTER TABLE users ADD COLUMN profile_privacy TEXT NOT NULL DEFAULT 'membros' CHECK (profile_privacy IN ('todos', 'membros', 'amigos'));
      -- Quem pode mandar mensagem privada: amigos, ou também quem divide um grupo.
      ALTER TABLE users ADD COLUMN dm_privacy TEXT NOT NULL DEFAULT 'membros' CHECK (dm_privacy IN ('amigos', 'membros'));

      CREATE TABLE user_media (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('avatar', 'banner')),
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        animated BOOLEAN NOT NULL DEFAULT false,
        data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX user_media_user ON user_media(user_id);

      -- Amizade: um registro por par, com o menor id primeiro.
      CREATE TABLE friendships (
        user_low TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_high TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pendente', 'amigos')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        accepted_at TIMESTAMPTZ,
        PRIMARY KEY (user_low, user_high),
        CHECK (user_low < user_high)
      );
      CREATE INDEX friendships_high ON friendships(user_high);

      CREATE TABLE user_blocks (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, blocked_id)
      );
      CREATE INDEX user_blocks_blocked ON user_blocks(blocked_id);

      -- Nota e apelido que só quem escreveu vê.
      CREATE TABLE user_notes (
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note TEXT NOT NULL DEFAULT '',
        nickname TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (owner_id, target_id)
      );

      -- Mensagens privadas: uma conversa por par. Nenhuma rota de grupo lê estas tabelas.
      CREATE TABLE dm_channels (
        id TEXT PRIMARY KEY,
        user_low TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_high TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_message_id BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_low, user_high),
        CHECK (user_low < user_high)
      );
      CREATE INDEX dm_channels_high ON dm_channels(user_high);

      CREATE TABLE dm_messages (
        id BIGSERIAL PRIMARY KEY,
        dm_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
        author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        reply_to BIGINT REFERENCES dm_messages(id) ON DELETE SET NULL,
        -- Cartões especiais (convite para grupo).
        meta JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        edited_at TIMESTAMPTZ
      );
      CREATE INDEX dm_messages_dm ON dm_messages(dm_id, id DESC);

      CREATE TABLE dm_files (
        id TEXT PRIMARY KEY,
        dm_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
        uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        message_id BIGINT REFERENCES dm_messages(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX dm_files_message ON dm_files(message_id);
      CREATE INDEX dm_files_dm ON dm_files(dm_id);

      CREATE TABLE dm_reactions (
        message_id BIGINT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (message_id, emoji, user_id)
      );

      CREATE TABLE dm_states (
        dm_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_id BIGINT NOT NULL DEFAULT 0,
        notify TEXT NOT NULL DEFAULT 'tudo' CHECK (notify IN ('tudo', 'nada')),
        PRIMARY KEY (dm_id, user_id)
      );

      -- Como cada membro entrou. Só existe para quem entrar daqui em diante: o passado não é inventado.
      ALTER TABLE members ADD COLUMN joined_via TEXT;
      ALTER TABLE members ADD COLUMN invited_by TEXT REFERENCES users(id) ON DELETE SET NULL;

      -- Bots na lista de membros (só aparência: as permissões e o registro de ações continuam valendo).
      ALTER TABLE bot_installs ADD COLUMN member_list TEXT NOT NULL DEFAULT 'categoria' CHECK (member_list IN ('mostrar', 'ocultar', 'categoria'));

      -- Chat dos canais de voz: temporário apaga as mensagens quando o canal esvazia.
      ALTER TABLE channels ADD COLUMN temporary_chat BOOLEAN NOT NULL DEFAULT false;
      INSERT INTO read_states (user_id, channel_id, last_read_id)
        SELECT m.user_id, c.id, (SELECT coalesce(max(id), 0) FROM messages)
          FROM members m JOIN channels c ON c.group_id = m.group_id WHERE c.kind = 'voz'
        ON CONFLICT DO NOTHING;

      -- Emojis próprios de cada grupo (estáticos ou animados).
      CREATE TABLE group_emojis (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        animated BOOLEAN NOT NULL DEFAULT false,
        size INTEGER NOT NULL,
        data BYTEA NOT NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (group_id, name)
      );
    `,
  },
  {
    id: 5,
    name: 'atividades: jogos vinculados, atividade atual e recentes, privacidade das atividades',
    sql: `
      -- Quem vê o que a conta está jogando: só amigos (padrão), também quem divide um grupo, ou ninguém.
      ALTER TABLE users ADD COLUMN activity_privacy TEXT NOT NULL DEFAULT 'amigos' CHECK (activity_privacy IN ('amigos', 'membros', 'ninguem'));

      -- Jogos que a pessoa vinculou: à mão (só o nome) ou com o executável detectado pelo aplicativo de Windows.
      CREATE TABLE user_games (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        -- Nome do executável em minúsculas (sem pasta), para reconhecer o jogo aberto; null se foi adicionado à mão.
        exe TEXT,
        -- Ícone pequeno (data:image/png) tirado do próprio executável, opcional.
        icon TEXT,
        show_on_profile BOOLEAN NOT NULL DEFAULT true,
        -- Não mostrar atividade deste jogo.
        hidden BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, name_key)
      );
      CREATE INDEX user_games_user ON user_games(user_id);

      -- O que a pessoa jogou: a atividade atual é a que não terminou e foi renovada há pouco (o aplicativo renova
      -- enquanto o jogo está aberto); as terminadas viram "atividades recentes".
      CREATE TABLE user_activities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_name TEXT NOT NULL,
        game_id TEXT REFERENCES user_games(id) ON DELETE SET NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ
      );
      CREATE INDEX user_activities_user ON user_activities(user_id, started_at DESC);
    `,
  },
  {
    id: 6,
    name: 'cosmic points, loja, inventário e itens equipados',
    sql: `
      -- Saldo de Cosmic Points (gratuitos, sem dinheiro real). Nunca fica negativo.
      ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0);

      -- Cada ganho e cada gasto. "ref" é a chave de idempotência: a mesma recompensa (ou compra) não conta duas vezes,
      -- nem com dois pedidos ao mesmo tempo. "day" é o dia no horário de Brasília, para os limites diários.
      CREATE TABLE points_ledger (
        id TEXT PRIMARY KEY,
        -- Ordem de lançamento (para o histórico, mesmo com horários iguais).
        seq BIGINT GENERATED ALWAYS AS IDENTITY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        ref TEXT NOT NULL,
        day TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, ref)
      );
      CREATE INDEX points_ledger_user ON points_ledger(user_id, created_at DESC);
      CREATE INDEX points_ledger_day ON points_ledger(user_id, day);

      -- Itens adquiridos (o catálogo fica no código: shared/cosmetics.ts).
      CREATE TABLE user_items (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        price INTEGER NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, item_id)
      );

      -- O que está equipado em cada espaço (decoração, moldura, fundo, cor do nome).
      CREATE TABLE user_equipped (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slot TEXT NOT NULL,
        item_id TEXT NOT NULL,
        variant TEXT NOT NULL,
        PRIMARY KEY (user_id, slot)
      );
    `,
  },
  {
    id: 7,
    name: 'administração global, MFA, códigos promocionais e presentes',
    sql: `
      CREATE TABLE global_permissions (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
        role TEXT NOT NULL DEFAULT 'cosmic_admin' CHECK (role = 'cosmic_admin'),
        unlimited_cosmetics BOOLEAN NOT NULL DEFAULT true,
        is_primary BOOLEAN NOT NULL DEFAULT false,
        mfa_secret TEXT,
        mfa_pending TEXT,
        mfa_last_step BIGINT NOT NULL DEFAULT -1,
        recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX one_primary_admin ON global_permissions(is_primary) WHERE is_primary;
      ALTER TABLE sessions ADD COLUMN admin_verified_until TIMESTAMPTZ;
      CREATE TABLE admin_audit (
        id BIGSERIAL PRIMARY KEY,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        target_id TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX admin_audit_recent ON admin_audit(id DESC);
      CREATE TABLE security_limits (
        key TEXT PRIMARY KEY,
        hits INTEGER NOT NULL,
        window_until TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE promo_codes (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        code_key TEXT NOT NULL UNIQUE,
        reward_kind TEXT NOT NULL DEFAULT 'points' CHECK (reward_kind IN ('points', 'cosmetic')),
        points INTEGER NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 1000000),
        item_id TEXT,
        expires_at TIMESTAMPTZ,
        max_uses INTEGER CHECK (max_uses > 0),
        per_user INTEGER NOT NULL DEFAULT 1 CHECK (per_user BETWEEN 1 AND 100),
        uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
        active BOOLEAN NOT NULL DEFAULT true,
        revoked_at TIMESTAMPTZ,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK ((reward_kind = 'points' AND points > 0 AND item_id IS NULL) OR
               (reward_kind = 'cosmetic' AND points = 0 AND item_id IS NOT NULL))
      );
      CREATE TABLE promo_redemptions (
        id TEXT PRIMARY KEY,
        code_id TEXT NOT NULL REFERENCES promo_codes(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        request_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal > 0),
        reward JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, request_id),
        UNIQUE (code_id, user_id, ordinal)
      );
      CREATE INDEX promo_redemptions_code ON promo_redemptions(code_id, created_at DESC);
      CREATE TABLE shop_settings (
        item_id TEXT PRIMARY KEY,
        price INTEGER CHECK (price BETWEEN 0 AND 1000000),
        active BOOLEAN NOT NULL DEFAULT true,
        transferable BOOLEAN NOT NULL DEFAULT false
      );
      CREATE TABLE gifts (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL REFERENCES users(id),
        recipient_id TEXT NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('purchase', 'transfer')),
        message TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL CHECK (price >= 0),
        request_id TEXT NOT NULL,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (sender_id, request_id),
        CHECK (sender_id <> recipient_id)
      );
      CREATE INDEX gifts_recipient ON gifts(recipient_id, created_at DESC);
      CREATE TABLE global_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO global_settings (key, value) VALUES ('promotions_enabled', 'true'), ('gifts_enabled', 'true');
      -- Unidades administrativas nunca transferem itens de teste para a economia real.
      ALTER TABLE user_items ADD COLUMN admin_grant BOOLEAN NOT NULL DEFAULT false;
      -- Uma aquisição pode ser transferida e depois comprada outra vez; refs novas identificam cada compra.
      ALTER TABLE user_items ADD COLUMN acquisition_id TEXT;
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
