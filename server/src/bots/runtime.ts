/**
 * Motor dos bots. Roda no backend, então os bots funcionam com o administrador offline.
 *
 * Cada bot instalado é uma CONTA de membro no grupo, com um cargo próprio que tem exatamente as permissões
 * que o bot pede. Tudo o que um bot faz (apagar mensagem, dar cargo, castigar) passa pelos mesmos métodos
 * que as pessoas usam, então vale a mesma hierarquia: um bot não pune quem está acima do cargo dele, não
 * entrega cargo com permissões que não tem e não muda o próprio cargo.
 */
import { GROUP_WIDE, has, P, PERMISSIONS } from '../../../shared/permissions.ts';
import { cleanText, newId, type User } from '../community/auth.ts';
import type { Community, CommunityEvent, MessageMeta, Snapshot } from '../community/core.ts';
import { iso, num, type Db, type Row } from '../db/db.ts';
import { ApiError } from '../errors.ts';
import { RateLimiter } from '../ratelimit.ts';
import type { BotContext, BotData, BotModule, CommandCall, CommandDef, ConfigField, Install, Job } from './types.ts';

/** O que os bots precisam da economia: cobrar pontos de quem pediu uma ação (ver community/economy.ts). */
export interface PointsSpender {
  spend(userId: string, amount: number, reason: string, detail: string, ref: string): Promise<boolean>;
}

const HANDLER_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 5;
const str = (set: bigint): string => set.toString();

function names(set: bigint): string {
  return PERMISSIONS.filter((item) => has(set, 1n << BigInt(item.bit)))
    .map((item) => `“${item.name}”`)
    .join(', ');
}

const toInstall = (row: Row): Install => {
  const json = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : value) as T;
  return {
    groupId: String(row.group_id),
    botId: String(row.bot_id),
    userId: String(row.user_id),
    roleId: String(row.role_id),
    enabled: row.enabled === true,
    config: json<Record<string, unknown>>(row.config) ?? {},
    channels: row.channels === null ? null : json<string[]>(row.channels),
    commandRoles: row.command_roles === null ? null : json<string[]>(row.command_roles),
    displayName: row.display_name === null ? null : String(row.display_name),
    prefix: String(row.prefix),
    lastError: row.last_error === null ? null : String(row.last_error),
    memberList: row.member_list === 'mostrar' || row.member_list === 'ocultar' ? row.member_list : 'categoria',
  };
};

/** Separa argumentos por espaço, respeitando "trechos entre aspas". */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/"([^"]*)"|“([^”]*)”|(\S+)/g)) out.push(match[1] ?? match[2] ?? match[3] ?? '');
  return out;
}

function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} passou de ${HANDLER_TIMEOUT_MS / 1000} segundos e foi interrompido`)), HANDLER_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

export class BotRuntime {
  readonly #economy: PointsSpender | null;
  readonly #db: Db;
  readonly #community: Community;
  readonly #modules = new Map<string, BotModule>();
  readonly #installs = new Map<string, Promise<Install[]>>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #limiter: RateLimiter;
  readonly #now: () => Date;
  #timer: ReturnType<typeof setInterval> | null = null;
  #ticking = false;

  constructor(db: Db, community: Community, modules: readonly BotModule[], options: { now?: () => Date; economy?: PointsSpender } = {}) {
    this.#db = db;
    this.#economy = options.economy ?? null;
    this.#community = community;
    this.#now = options.now ?? (() => new Date());
    this.#limiter = new RateLimiter(() => this.#now().getTime());
    for (const module of modules) this.#modules.set(module.id, module);
    // Um grupo por vez, em ordem: dois eventos do mesmo grupo nunca são tratados ao mesmo tempo.
    community.onEvent((event) => this.#enqueue(event.groupId, () => this.#dispatch(event)));
  }

  /** Começa a executar as tarefas agendadas. */
  start(intervalMs = 5000): void {
    this.#timer ??= setInterval(() => void this.tick().catch((error) => console.error('[bots]', error)), intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Espera a fila de eventos esvaziar (os testes usam para saber que os bots já reagiram). */
  async idle(): Promise<void> {
    for (let round = 0; round < 20; round++) {
      const pending = [...this.#queues.values()];
      if (pending.length === 0) return;
      await Promise.all(pending);
      await new Promise((done) => setTimeout(done, 0));
    }
  }

  #enqueue(groupId: string, work: () => Promise<void>): void {
    const next = (this.#queues.get(groupId) ?? Promise.resolve()).then(work).catch((error) => console.error('[bots]', error));
    this.#queues.set(groupId, next);
    void next.then(() => this.#queues.get(groupId) === next && this.#queues.delete(groupId));
  }

  // --- Biblioteca e instalações ------------------------------------------------------------

  catalog() {
    return [...this.#modules.values()].map((module) => ({
      id: module.id,
      name: module.name,
      about: module.about,
      category: module.category,
      icon: module.icon,
      features: module.features,
      permissions: str(module.permissions),
      fields: module.fields,
      defaultConfig: module.defaultConfig,
      commands: (module.commands ?? []).map((command) => ({ name: command.name, usage: command.usage, about: command.about, permission: command.permission ? str(command.permission) : null })),
    }));
  }

  #module(botId: string): BotModule {
    const module = this.#modules.get(botId);
    if (!module) throw new ApiError(404, 'bot_inexistente', 'Esse bot não existe na biblioteca.');
    return module;
  }

  #installsOf(groupId: string): Promise<Install[]> {
    let pending = this.#installs.get(groupId);
    if (!pending) {
      pending = this.#db.query('SELECT * FROM bot_installs WHERE group_id = $1 ORDER BY installed_at', [groupId]).then((rows) => rows.map(toInstall));
      this.#installs.set(groupId, pending);
      pending.catch(() => this.#installs.delete(groupId));
    }
    return pending;
  }

  async #installOf(groupId: string, botId: string): Promise<Install> {
    const install = (await this.#installsOf(groupId)).find((item) => item.botId === botId);
    if (!install) throw new ApiError(404, 'bot_nao_instalado', 'Esse bot não está instalado neste grupo.');
    return install;
  }

  #need(base: bigint, permission: bigint): void {
    if (!has(base, permission)) throw new ApiError(403, 'sem_permissao', `Você não tem a permissão ${names(permission)}.`);
  }

  async #audit(groupId: string, actor: User, action: string, module: BotModule, detail: Record<string, unknown> = {}): Promise<void> {
    await this.#db.query(
      `INSERT INTO audit_log (group_id, actor_id, actor_name, action, target_kind, target_id, target_name, detail) VALUES ($1, $2, $3, $4, 'bot', $5, $6, $7::jsonb)`,
      [groupId, actor.id, actor.displayName, action, module.id, module.name, JSON.stringify(detail)],
    );
  }

  async install(user: User, groupId: string, botId: unknown): Promise<void> {
    const module = this.#module(String(botId));
    const { snap, base } = await this.#community.access(user, groupId);
    this.#need(base, P.INSTALL_BOTS);
    // Quem instala precisa ter tudo o que o bot vai poder fazer: instalar um bot não é atalho para ganhar poder.
    const missing = module.permissions & ~base;
    if (missing !== 0n) throw new ApiError(403, 'escalonamento', `Este bot pede permissões que você não tem: ${names(missing)}.`);
    if ((await this.#installsOf(groupId)).some((item) => item.botId === module.id)) throw new ApiError(409, 'ja_instalado', 'Esse bot já está instalado neste grupo.');
    const userId = newId();
    const roleId = newId();
    await this.#db.tx(async (tx) => {
      // O nome de usuário tem hífen, que contas de pessoas não podem ter: não há como colidir nem como entrar por senha.
      await tx.query(`INSERT INTO users (id, username, username_key, display_name, password_hash, is_bot) VALUES ($1, $2, $3, $4, '!', true)`, [
        userId,
        `bot-${module.id}`,
        `bot-${module.id}-${groupId}`.toLowerCase(),
        module.name,
      ]);
      await tx.query("INSERT INTO members (group_id, user_id, joined_via) VALUES ($1, $2, 'bot')", [groupId, userId]);
      // O cargo do bot nasce no pé da hierarquia. Para ele agir sobre membros com cargo, alguém precisa subi-lo.
      await tx.query('UPDATE roles SET position = position + 1 WHERE group_id = $1 AND NOT is_everyone', [groupId]);
      await tx.query(`INSERT INTO roles (id, group_id, name, color, position, permissions, bot_id) VALUES ($1, $2, $3, '#a78bfa', 1, $4, $5)`, [
        roleId,
        groupId,
        module.name,
        str(module.permissions),
        module.id,
      ]);
      await tx.query('INSERT INTO member_roles (group_id, user_id, role_id) VALUES ($1, $2, $3)', [groupId, userId, roleId]);
      await tx.query('INSERT INTO bot_installs (group_id, bot_id, user_id, role_id, config, installed_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6)', [
        groupId,
        module.id,
        userId,
        roleId,
        JSON.stringify(module.defaultConfig),
        user.id,
      ]);
    });
    await this.#audit(groupId, user, 'bot.instalado', module, { permissoes: str(module.permissions) });
    this.#installs.delete(groupId);
    this.#community.touch(groupId);
    const ctx = await this.#context(await this.#installOf(groupId, module.id), module);
    await ctx.log('instalado', { por: user.displayName, grupo: snap.group.name });
    if (module.onInstall) await this.#guard(ctx, 'instalação', () => module.onInstall!(ctx));
  }

  async uninstall(user: User, groupId: string, botId: string): Promise<void> {
    const module = this.#module(botId);
    const { base } = await this.#community.access(user, groupId);
    this.#need(base, P.INSTALL_BOTS);
    const install = await this.#installOf(groupId, botId);
    await this.#db.tx(async (tx) => {
      const role = await tx.query('SELECT position FROM roles WHERE id = $1', [install.roleId]);
      await tx.query(`DELETE FROM overrides WHERE (target_kind = 'cargo' AND target_id = $1) OR (target_kind = 'membro' AND target_id = $2)`, [install.roleId, install.userId]);
      await tx.query('DELETE FROM roles WHERE id = $1', [install.roleId]);
      if (role[0]) await tx.query('UPDATE roles SET position = position - 1 WHERE group_id = $1 AND position > $2', [groupId, num(role[0].position)]);
      // Apagar a conta do bot leva junto a participação no grupo e a instalação.
      await tx.query('DELETE FROM users WHERE id = $1 AND is_bot', [install.userId]);
      await tx.query('DELETE FROM bot_data WHERE group_id = $1 AND bot_id = $2', [groupId, botId]);
      await tx.query('DELETE FROM bot_jobs WHERE group_id = $1 AND bot_id = $2', [groupId, botId]);
    });
    await this.#audit(groupId, user, 'bot.removido', module);
    await this.#db.query(`INSERT INTO bot_logs (group_id, bot_id, action, detail) VALUES ($1, $2, 'removido', $3::jsonb)`, [groupId, botId, JSON.stringify({ por: user.displayName })]);
    this.#installs.delete(groupId);
    this.#community.touch(groupId);
  }

  /** Canais em que o bot escreve (campos `posts`), com o que falta para ele conseguir escrever em cada um. */
  #postingChannels(snap: Snapshot, module: BotModule, install: Install, config: Record<string, unknown>) {
    const bot = snap.members.get(install.userId);
    const out: { channelId: string; name: string; missing: bigint }[] = [];
    const seen = new Set<string>();
    for (const field of module.fields) {
      if (field.type !== 'channel' || !field.posts) continue;
      const channelId = String(config[field.key] ?? '');
      const channel = channelId ? snap.channels.get(channelId) : undefined;
      if (!channel || seen.has(channelId)) continue;
      seen.add(channelId);
      const perms = bot ? this.#community.permissionsIn(snap, this.#community.subjectOf(snap, bot), channel) : 0n;
      out.push({ channelId, name: `#${channel.name}`, missing: (P.VIEW_CHANNEL | P.SEND_MESSAGES) & ~perms });
    }
    return out;
  }

  /**
   * Libera o cargo do bot nos canais em que ele escreve, em nome de quem salvou a configuração. Passa pelo mesmo
   * método das regras de canal feitas à mão: exige "Gerenciar cargos" no canal, só libera o que a pessoa tem e
   * fica na auditoria. Se ela não puder, nada muda e o motivo volta para a tela.
   */
  async #letBotWrite(user: User, groupId: string, module: BotModule, install: Install, config: Record<string, unknown>) {
    const liberados: string[] = [];
    const falhas: { canal: string; motivo: string }[] = [];
    const snap = await this.#community.snapshot(groupId);
    for (const { channelId, name, missing } of this.#postingChannels(snap, module, install, config)) {
      if (missing === 0n) continue;
      const rule = (snap.overrides.get(channelId) ?? []).find((item) => item.targetKind === 'cargo' && item.targetId === install.roleId);
      const need = P.VIEW_CHANNEL | P.SEND_MESSAGES;
      try {
        await this.#community.setOverride(user, channelId, 'cargo', install.roleId, { allow: str((rule?.allow ?? 0n) | need), deny: str((rule?.deny ?? 0n) & ~need) });
      } catch (error) {
        falhas.push({ canal: name, motivo: error instanceof Error ? error.message : String(error) });
        continue;
      }
      // Uma regra só para a conta do bot nesse canal ainda pode vetar: confere de novo.
      const after = this.#postingChannels(await this.#community.snapshot(groupId), module, install, config).find((item) => item.channelId === channelId);
      if (after && after.missing !== 0n) falhas.push({ canal: name, motivo: 'uma regra deste canal feita só para a conta do bot ainda impede.' });
      else liberados.push(name);
    }
    if (liberados.length > 0) {
      await this.#db.query(`INSERT INTO bot_logs (group_id, bot_id, action, detail) VALUES ($1, $2, 'canais liberados', $3::jsonb)`, [groupId, module.id, JSON.stringify({ por: user.displayName, canais: liberados })]);
    }
    return { liberados, falhas };
  }

  async update(user: User, groupId: string, botId: string, input: Record<string, unknown>): Promise<{ permissoes: { liberados: string[]; falhas: { canal: string; motivo: string }[] } }> {
    const module = this.#module(botId);
    const { snap, base } = await this.#community.access(user, groupId);
    this.#need(base, P.CONFIGURE_BOTS);
    const install = await this.#installOf(groupId, botId);
    const changes: Record<string, unknown> = {};
    const next = { ...install };

    if (typeof input.enabled === 'boolean' && input.enabled !== install.enabled) {
      next.enabled = input.enabled;
      changes.ativo = [install.enabled, input.enabled];
    }
    if (input.config !== undefined) {
      if (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)) throw new ApiError(400, 'config_invalida', 'Configuração inválida.');
      next.config = sanitizeConfig(module, snap, input.config as Record<string, unknown>, install.config);
      changes.configuracao = Object.keys(input.config as object);
    }
    const idList = (value: unknown, exists: (id: string) => boolean, what: string): string[] | null => {
      if (value === null) return null;
      if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !exists(id))) throw new ApiError(400, 'config_invalida', `Lista de ${what} inválida.`);
      return [...new Set(value as string[])];
    };
    if (input.channels !== undefined) {
      next.channels = idList(input.channels, (id) => snap.channels.has(id), 'canais');
      changes.canais = next.channels === null ? 'todos' : next.channels.map((id) => snap.channels.get(id)!.name);
    }
    if (input.commandRoles !== undefined) {
      next.commandRoles = idList(input.commandRoles, (id) => snap.roles.some((role) => role.id === id), 'cargos');
      changes.cargos = next.commandRoles === null ? 'todos' : next.commandRoles.map((id) => snap.roles.find((role) => role.id === id)!.name);
    }
    if (input.displayName !== undefined) {
      next.displayName = cleanText(input.displayName, 32) || null;
      changes.nome = [install.displayName, next.displayName];
    }
    if (input.prefix !== undefined) {
      if (typeof input.prefix !== 'string' || !/^[^\s/@#]{1,3}$/.test(input.prefix)) throw new ApiError(400, 'prefixo_invalido', 'O prefixo deve ter de 1 a 3 caracteres, sem espaço e sem “/”.');
      next.prefix = input.prefix;
      changes.prefixo = [install.prefix, input.prefix];
    }
    if (input.memberList !== undefined) {
      if (input.memberList !== 'mostrar' && input.memberList !== 'ocultar' && input.memberList !== 'categoria') throw new ApiError(400, 'config_invalida', 'Escolha mostrar, ocultar ou categoria própria.');
      next.memberList = input.memberList;
      changes.lista_de_membros = [install.memberList, input.memberList];
    }
    const none = { permissoes: { liberados: [], falhas: [] } };
    if (Object.keys(changes).length === 0) return none;
    await this.#db.query(
      `UPDATE bot_installs SET enabled = $3, config = $4::jsonb, channels = $5::jsonb, command_roles = $6::jsonb, display_name = $7, prefix = $8, member_list = $9, last_error = CASE WHEN $3 THEN last_error ELSE NULL END
        WHERE group_id = $1 AND bot_id = $2`,
      [groupId, botId, next.enabled, JSON.stringify(next.config), next.channels && JSON.stringify(next.channels), next.commandRoles && JSON.stringify(next.commandRoles), next.displayName, next.prefix, next.memberList],
    );
    // O nome de exibição também vale na lista de membros.
    await this.#db.query('UPDATE users SET display_name = $2 WHERE id = $1 AND is_bot', [install.userId, next.displayName ?? module.name]);
    await this.#audit(groupId, user, 'bot.configurado', module, changes);
    this.#installs.delete(groupId);
    this.#community.touch(groupId);
    await this.#db.query(`INSERT INTO bot_logs (group_id, bot_id, action, detail) VALUES ($1, $2, 'configurado', $3::jsonb)`, [groupId, botId, JSON.stringify({ por: user.displayName, ...changes })]);
    if (input.config === undefined) return none;
    return { permissoes: await this.#letBotWrite(user, groupId, module, next, next.config) };
  }

  /** Bots instalados e o estado de cada um. */
  async list(user: User, groupId: string) {
    const { base } = await this.#community.access(user, groupId);
    if (!has(base, P.INSTALL_BOTS) && !has(base, P.CONFIGURE_BOTS) && !has(base, P.VIEW_BOT_LOGS)) this.#need(base, P.CONFIGURE_BOTS);
    const out = [];
    for (const install of await this.#installsOf(groupId)) {
      const module = this.#modules.get(install.botId);
      if (!module) continue;
      const warnings: string[] = [];
      if (install.enabled) {
        for (const { name, missing } of this.#postingChannels(await this.#community.snapshot(groupId), module, install, install.config)) {
          if (missing === 0n) continue;
          warnings.push(`Não consigo escrever em ${name}: falta ${names(missing)} para o cargo do bot nesse canal. Salve a configuração do bot para liberar (precisa de “Gerenciar cargos”).`);
        }
      }
      if (install.enabled && module.status) {
        const ctx = await this.#context(install, module);
        warnings.push(...((await this.#guard(ctx, 'verificação de estado', () => module.status!(ctx))) ?? []));
      }
      out.push({
        botId: install.botId,
        userId: install.userId,
        roleId: install.roleId,
        enabled: install.enabled,
        config: install.config,
        channels: install.channels,
        commandRoles: install.commandRoles,
        displayName: install.displayName,
        prefix: install.prefix,
        memberList: install.memberList,
        status: !install.enabled
          ? { state: 'desativado', text: 'Desativado. Não reage a nada até ser ligado de novo.' }
          : install.lastError
            ? { state: 'erro', text: `Funcionando, mas a última falha foi: ${install.lastError}` }
            : warnings.length > 0
              ? { state: 'aviso', text: warnings.join(' ') }
              : { state: 'ativo', text: 'Funcionando.' },
      });
    }
    return out;
  }

  async logs(user: User, groupId: string, filter: { bot?: string; before?: string } = {}) {
    const { base } = await this.#community.access(user, groupId);
    this.#need(base, P.VIEW_BOT_LOGS);
    const before = filter.before && /^\d{1,18}$/.test(filter.before) ? filter.before : null;
    const bot = filter.bot && this.#modules.has(filter.bot) ? filter.bot : null;
    const rows = await this.#db.query(
      `SELECT * FROM bot_logs WHERE group_id = $1 AND ($2::text IS NULL OR bot_id = $2) AND ($3::bigint IS NULL OR id < $3::bigint) ORDER BY id DESC LIMIT 50`,
      [groupId, bot, before],
    );
    return rows.map((row) => ({
      id: String(row.id),
      botId: String(row.bot_id),
      botName: this.#modules.get(String(row.bot_id))?.name ?? String(row.bot_id),
      level: String(row.level),
      action: String(row.action),
      detail: (typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail) as Record<string, unknown>,
      createdAt: iso(row.created_at),
    }));
  }

  /** Comandos que esta pessoa pode usar no grupo (para a lista que aparece ao digitar "/"). */
  async commandsFor(user: User, groupId: string, inChannel?: bigint) {
    const { snap, me, subject, base } = await this.#community.access(user, groupId);
    const out: { bot: string; name: string; usage: string; about: string }[] = [];
    for (const install of await this.#installsOf(groupId)) {
      const module = this.#modules.get(install.botId);
      if (!module || !install.enabled) continue;
      if (install.commandRoles && !subject.isOwner && !has(base, P.ADMINISTRATOR) && !install.commandRoles.some((id) => me.roleIds.has(id) || id === snap.everyone.id)) continue;
      for (const command of module.commands ?? []) {
        // Permissões do grupo inteiro valem pelos cargos; as demais, pelo canal (quando se sabe qual é).
        if (command.permission && !has(has(GROUP_WIDE, command.permission) ? base : (inChannel ?? base), command.permission)) continue;
        out.push({ bot: install.displayName ?? module.name, name: command.name, usage: command.usage, about: command.about });
      }
    }
    return out;
  }

  // --- Contexto que cada bot recebe ---------------------------------------------------------

  async #context(install: Install, module: BotModule): Promise<BotContext> {
    const { groupId, botId } = install;
    const bot: User = { id: install.userId, username: `bot-${botId}`, displayName: install.displayName ?? module.name, createdAt: '' };
    const db = this.#db;
    const community = this.#community;
    const log: BotContext['log'] = async (action, detail = {}, level = 'info') => {
      await db.query('INSERT INTO bot_logs (group_id, bot_id, level, action, detail) VALUES ($1, $2, $3, $4, $5::jsonb)', [groupId, botId, level, action, JSON.stringify(detail)]);
    };
    const data: BotData = {
      async get<T>(scope: string, key: string) {
        const [row] = await db.query('SELECT value FROM bot_data WHERE group_id = $1 AND bot_id = $2 AND scope = $3 AND key = $4', [groupId, botId, scope, key]);
        return row ? ((typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as T) : null;
      },
      async set(scope, key, value) {
        await db.query(
          `INSERT INTO bot_data (group_id, bot_id, scope, key, value) VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (group_id, bot_id, scope, key) DO UPDATE SET value = $5::jsonb, updated_at = now()`,
          [groupId, botId, scope, key, JSON.stringify(value)],
        );
      },
      async delete(scope, key) {
        await db.query('DELETE FROM bot_data WHERE group_id = $1 AND bot_id = $2 AND scope = $3 AND key = $4', [groupId, botId, scope, key]);
      },
      async list<T>(scope: string) {
        const rows = await db.query('SELECT key, value FROM bot_data WHERE group_id = $1 AND bot_id = $2 AND scope = $3 ORDER BY updated_at', [groupId, botId, scope]);
        return rows.map((row) => ({ key: String(row.key), value: (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as T }));
      },
      update<T>(scope: string, key: string, change: (current: T | null) => T | null) {
        return db.tx(async (tx) => {
          const [row] = await tx.query('SELECT value FROM bot_data WHERE group_id = $1 AND bot_id = $2 AND scope = $3 AND key = $4 FOR UPDATE', [groupId, botId, scope, key]);
          const next = change(row ? ((typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as T) : null);
          if (next === null) await tx.query('DELETE FROM bot_data WHERE group_id = $1 AND bot_id = $2 AND scope = $3 AND key = $4', [groupId, botId, scope, key]);
          else {
            await tx.query(
              `INSERT INTO bot_data (group_id, bot_id, scope, key, value) VALUES ($1, $2, $3, $4, $5::jsonb)
               ON CONFLICT (group_id, bot_id, scope, key) DO UPDATE SET value = $5::jsonb, updated_at = now()`,
              [groupId, botId, scope, key, JSON.stringify(next)],
            );
          }
          return next;
        });
      },
    };
    const attempt: BotContext['attempt'] = async (what, action) => {
      try {
        await action();
        return true;
      } catch (error) {
        // O backend recusou (hierarquia, falta de permissão no canal...): o bot não insiste, só registra.
        await log('ação recusada', { acao: what, motivo: error instanceof Error ? error.message : String(error) }, 'aviso');
        return false;
      }
    };
    return {
      groupId,
      bot,
      install,
      community,
      db,
      data,
      log,
      attempt,
      snapshot: () => community.snapshot(groupId),
      now: () => this.#now(),
      ...(this.#economy
        ? {
            spendPoints: async (userId: string, amount: number, detail: string, ref: string) => {
              try {
                return (await this.#economy!.spend(userId, amount, 'bot', detail, ref)) ? ('ok' as const) : ('ok' as const);
              } catch (error) {
                return error instanceof ApiError && error.code === 'pontos_insuficientes' ? ('sem-saldo' as const) : ('indisponivel' as const);
              }
            },
          }
        : {}),
      say: async (channelId, content, meta) => {
        // Trava contra enxurrada (um laço entre regras, por exemplo): no máximo 20 mensagens a cada 10 segundos.
        if (!this.#limiter.take(`fala:${groupId}:${botId}`, 20, 10_000)) {
          await log('mensagem descartada', { motivo: 'limite de 20 mensagens em 10 segundos' }, 'aviso');
          return null;
        }
        try {
          return await community.sendMessage(bot, channelId, content, { meta, as: install.displayName ?? undefined });
        } catch (error) {
          await log('mensagem não enviada', { canal: channelId, motivo: error instanceof Error ? error.message : String(error) }, 'aviso');
          return null;
        }
      },
      schedule: async (kind, payload, runAt, everySeconds) => {
        const [row] = await db.query('INSERT INTO bot_jobs (group_id, bot_id, kind, payload, run_at, every_seconds) VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id', [
          groupId,
          botId,
          kind,
          JSON.stringify(payload),
          runAt.toISOString(),
          everySeconds ?? null,
        ]);
        return String(row!.id);
      },
      cancel: async (jobId) => {
        if (/^\d{1,18}$/.test(jobId)) await db.query('DELETE FROM bot_jobs WHERE id = $1::bigint AND group_id = $2 AND bot_id = $3', [jobId, groupId, botId]);
      },
    };
  }

  /** Roda o código de um bot com limite de tempo. Uma falha vira registro e não derruba nada. */
  async #guard<T>(ctx: BotContext, what: string, work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await withTimeout(work(), what);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[bots] ${ctx.install.botId}: ${what}: ${message}`);
      await ctx.log('falha', { em: what, erro: message }, 'erro').catch(() => undefined);
      await this.#db.query('UPDATE bot_installs SET last_error = $3 WHERE group_id = $1 AND bot_id = $2', [ctx.groupId, ctx.install.botId, message.slice(0, 200)]).catch(() => undefined);
      this.#installs.delete(ctx.groupId);
      return undefined;
    }
  }

  // --- Eventos e comandos -------------------------------------------------------------------

  async #dispatch(event: CommunityEvent): Promise<void> {
    const installs = (await this.#installsOf(event.groupId)).filter((install) => install.enabled);
    if (installs.length === 0) return;
    const snap = await this.#community.snapshot(event.groupId).catch(() => null);
    if (!snap) return;
    // O que os bots fazem não volta para os bots: é a primeira trava contra laços.
    if (event.type === 'message' && event.fromBot) return;
    if (event.type !== 'message' && snap.members.get(event.userId)?.bot) return;

    const channelId = event.type === 'message' ? event.channel.id : event.type === 'voice.join' || event.type === 'voice.leave' ? event.channelId : null;
    for (const install of installs) {
      const module = this.#modules.get(install.botId);
      if (!module?.onEvent) continue;
      if (channelId && install.channels && !install.channels.includes(channelId)) continue;
      const ctx = await this.#context(install, module);
      const outcome = await this.#guard(ctx, `evento ${event.type}`, () => module.onEvent!(ctx, event));
      // Mensagem removida por um bot (AutoMod): os outros bots e os comandos não a veem.
      if (outcome === 'apagada') return;
    }
    if (event.type === 'message') await this.#command(event, installs, snap);
  }

  async #command(event: Extract<CommunityEvent, { type: 'message' }>, installs: Install[], snap: Snapshot): Promise<void> {
    const text = event.message.content;
    let target: { install: Install; module: BotModule; command: CommandDef | 'ajuda'; args: string; name: string } | null = null;
    const slash = /^\/([\p{L}0-9_-]{1,32})(?:\s+([\s\S]*))?$/u.exec(text);
    if (slash) {
      const name = slash[1]!.toLowerCase();
      for (const install of installs) {
        const module = this.#modules.get(install.botId);
        const command = name === 'ajuda' ? ('ajuda' as const) : module?.commands?.find((item) => item.name === name);
        if (module && command) {
          target = { install, module, command, args: (slash[2] ?? '').trim(), name };
          break;
        }
      }
    } else {
      // Forma antiga, com o prefixo de cada bot: "!nivel".
      for (const install of installs) {
        if (!text.startsWith(install.prefix)) continue;
        const match = /^([\p{L}0-9_-]{1,32})(?:\s+([\s\S]*))?$/u.exec(text.slice(install.prefix.length));
        const module = this.#modules.get(install.botId);
        const command = match && module?.commands?.find((item) => item.name === match[1]!.toLowerCase());
        if (module && command) {
          target = { install, module, command, args: (match![2] ?? '').trim(), name: command.name };
          break;
        }
      }
    }
    if (!target) return;

    const { install, module, command } = target;
    const member = snap.members.get(event.author.id);
    if (!member) return;
    const ctx = await this.#context(install, module);
    const subject = this.#community.subjectOf(snap, member);
    const perms = this.#community.permissionsIn(snap, subject, event.channel);
    const base = (await this.#community.access(event.author, event.groupId)).base;
    const reply = (content: string, meta: MessageMeta = {}) => ctx.say(event.channel.id, content, { ...meta, replyTo: event.author.id });
    const who = member.nickname ?? member.displayName;

    if (install.channels && !install.channels.includes(event.channel.id)) return void (await reply(`${who}, ${ctx.bot.displayName} não atua neste canal.`));
    if (!has(perms, P.USE_COMMANDS)) return void (await reply(`${who}, você não tem a permissão “Executar comandos” neste canal.`));
    if (install.commandRoles && !subject.isOwner && !has(base, P.ADMINISTRATOR) && !install.commandRoles.some((id) => member.roleIds.has(id) || id === snap.everyone.id)) {
      return void (await reply(`${who}, os comandos de ${ctx.bot.displayName} estão reservados a alguns cargos.`));
    }
    if (!this.#limiter.take(`comando:${event.groupId}:${event.author.id}`, 6, 10_000)) return void (await reply(`${who}, devagar: muitos comandos em pouco tempo.`));

    if (command === 'ajuda') {
      const available = await this.commandsFor(event.author, event.groupId, perms);
      const lines = available.map((item) => `/${item.usage} — ${item.about}`);
      return void (await reply(lines.length > 0 ? `Comandos disponíveis para você:\n${lines.join('\n')}`.slice(0, 3900) : 'Nenhum comando disponível para você neste grupo.'));
    }
    if (command.permission && !has(has(GROUP_WIDE, command.permission) ? base : perms, command.permission)) {
      return void (await reply(`${who}, o comando /${command.name} exige a permissão ${names(command.permission)}.`));
    }
    const call: CommandCall = { name: target.name, args: target.args, argv: splitArgs(target.args), user: event.author, member, channel: event.channel, message: event.message, permissions: perms };
    const result = await this.#guard(ctx, `comando /${command.name}`, () => command.run(ctx, call));
    if (typeof result === 'string') await reply(result);
    else if (result) await reply(result.content, result.meta);
  }

  // --- Tarefas agendadas --------------------------------------------------------------------

  /**
   * Executa as tarefas vencidas. Cada tarefa é "pega" com uma trava no banco (FOR UPDATE SKIP LOCKED), então
   * duas instâncias do backend não executam a mesma ao mesmo tempo. Se o processo cair no meio, a trava vence
   * e a tarefa é tentada de novo: a garantia é "pelo menos uma vez", com no máximo 5 tentativas.
   */
  async tick(now: Date = this.#now()): Promise<number> {
    if (this.#ticking) return 0;
    this.#ticking = true;
    try {
      const at = now.toISOString();
      const rows = await this.#db.query(
        `UPDATE bot_jobs SET locked_until = $1::timestamptz + interval '60 seconds', attempts = attempts + 1
          WHERE id IN (
            SELECT id FROM bot_jobs
             WHERE done_at IS NULL AND run_at <= $1::timestamptz AND (locked_until IS NULL OR locked_until < $1::timestamptz) AND attempts < ${MAX_ATTEMPTS}
             ORDER BY run_at LIMIT 25 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
        [at],
      );
      for (const row of rows) {
        const groupId = String(row.group_id);
        const job: Job = { id: String(row.id), kind: String(row.kind), payload: (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as Record<string, unknown> };
        const install = (await this.#installsOf(groupId)).find((item) => item.botId === String(row.bot_id));
        const module = install && this.#modules.get(install.botId);
        let done = true;
        if (install?.enabled && module?.onJob) {
          const ctx = await this.#context(install, module);
          done = (await this.#guard(ctx, `tarefa ${job.kind}`, async () => (await module.onJob!(ctx, job), true))) === true;
          if (!done && num(row.attempts) >= MAX_ATTEMPTS) {
            await ctx.log('tarefa abandonada', { tarefa: job.kind, tentativas: MAX_ATTEMPTS }, 'erro');
            done = true;
          }
        }
        if (!done) continue;
        const every = row.every_seconds === null ? 0 : num(row.every_seconds);
        if (every > 0) {
          // Repetição: a próxima execução é a primeira data futura, sem acumular as que ficaram para trás.
          const first = new Date(String(row.run_at)).getTime();
          const steps = Math.max(1, Math.ceil((now.getTime() - first + 1) / (every * 1000)));
          await this.#db.query('UPDATE bot_jobs SET run_at = $2, locked_until = NULL, attempts = 0 WHERE id = $1::bigint', [job.id, new Date(first + steps * every * 1000).toISOString()]);
        } else {
          await this.#db.query('UPDATE bot_jobs SET done_at = $2, locked_until = NULL WHERE id = $1::bigint', [job.id, at]);
        }
      }
      return rows.length;
    } finally {
      this.#ticking = false;
    }
  }
}

/** Confere a configuração enviada, campo por campo, contra o que o bot declara. O que não é campo do bot é ignorado. */
export function sanitizeConfig(module: BotModule, snap: Snapshot, input: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...module.defaultConfig, ...current };
  const bad = (field: ConfigField, why: string): never => {
    throw new ApiError(400, 'config_invalida', `“${field.label}”: ${why}.`);
  };
  const channelOk = (field: ConfigField, id: unknown): id is string => typeof id === 'string' && snap.channels.has(id) && (!field.channelKind || snap.channels.get(id)!.kind === field.channelKind);
  const roleOk = (id: unknown): id is string => typeof id === 'string' && snap.roles.some((role) => role.id === id);
  for (const field of module.fields) {
    if (!(field.key in input)) continue;
    const value = input[field.key];
    switch (field.type) {
      case 'toggle':
        out[field.key] = typeof value === 'boolean' ? value : bad(field, 'deve ser ligado ou desligado');
        break;
      case 'text':
        out[field.key] = typeof value === 'string' ? cleanText(value, 200) : bad(field, 'deve ser um texto');
        break;
      case 'longtext':
        out[field.key] = typeof value === 'string' ? cleanText(value, 1500, true) : bad(field, 'deve ser um texto');
        break;
      case 'number': {
        const number = Number(value);
        if (typeof value === 'boolean' || !Number.isFinite(number) || number < (field.min ?? 0) || number > (field.max ?? 1_000_000)) bad(field, `deve ser um número entre ${field.min ?? 0} e ${field.max ?? 1_000_000}`);
        out[field.key] = number;
        break;
      }
      case 'list': {
        if (!Array.isArray(value) || value.length > 300 || value.some((item) => typeof item !== 'string')) bad(field, 'deve ser uma lista de textos (até 300)');
        out[field.key] = [...new Set((value as string[]).map((item) => cleanText(item, 100)).filter(Boolean))];
        break;
      }
      case 'select':
        out[field.key] = field.options?.some((option) => option.value === value) ? value : bad(field, 'opção desconhecida');
        break;
      case 'channel':
        out[field.key] = value === '' || value === null ? '' : channelOk(field, value) ? value : bad(field, 'canal inexistente ou do tipo errado');
        break;
      case 'channels':
        out[field.key] = Array.isArray(value) && value.every((id) => channelOk(field, id)) ? [...new Set(value)] : bad(field, 'lista de canais inválida');
        break;
      case 'role':
        out[field.key] = value === '' || value === null ? '' : roleOk(value) ? value : bad(field, 'cargo inexistente');
        break;
      case 'roles':
        out[field.key] = Array.isArray(value) && value.every(roleOk) ? [...new Set(value)] : bad(field, 'lista de cargos inválida');
        break;
      case 'members':
        out[field.key] = Array.isArray(value) && value.every((id) => typeof id === 'string' && snap.members.has(id)) ? [...new Set(value)] : bad(field, 'lista de membros inválida');
        break;
    }
  }
  return out;
}
