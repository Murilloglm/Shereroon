import type { User } from '../community/auth.ts';
import type { Channel, Community, CommunityEvent, Member, Message, MessageMeta, Snapshot } from '../community/core.ts';
import type { Db } from '../db/db.ts';

/** Tipos de campo que a Central de Bots sabe desenhar. É com eles que cada bot ganha uma tela de configuração sem código próprio. */
export type FieldType = 'toggle' | 'text' | 'longtext' | 'number' | 'list' | 'select' | 'channel' | 'channels' | 'role' | 'roles' | 'members';

export interface ConfigField {
  key: string;
  type: FieldType;
  label: string;
  about?: string;
  /** Título do bloco em que o campo aparece. */
  section?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  placeholder?: string;
  /** Para campos de canal: que tipo de canal pode ser escolhido. */
  channelKind?: 'texto' | 'voz' | 'categoria';
}

export interface Install {
  groupId: string;
  botId: string;
  /** Conta do bot neste grupo. É com ela que o bot age, sujeita às permissões e à hierarquia como qualquer membro. */
  userId: string;
  roleId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Canais em que o bot atua (null = todos os que ele puder ver). */
  channels: string[] | null;
  /** Cargos que podem usar os comandos do bot (null = qualquer um com "Executar comandos"). */
  commandRoles: string[] | null;
  displayName: string | null;
  prefix: string;
  lastError: string | null;
  /** Como aparece na lista de membros (só aparência: permissões e registros não mudam). */
  memberList: 'mostrar' | 'ocultar' | 'categoria';
}

export interface BotData {
  get<T>(scope: string, key: string): Promise<T | null>;
  set(scope: string, key: string, value: unknown): Promise<void>;
  delete(scope: string, key: string): Promise<void>;
  list<T>(scope: string): Promise<{ key: string; value: T }[]>;
  /** Lê, transforma e grava dentro de uma transação: duas alterações simultâneas não se atropelam. */
  update<T>(scope: string, key: string, change: (current: T | null) => T | null): Promise<T | null>;
}

export interface BotContext {
  groupId: string;
  /** Conta do bot neste grupo. */
  bot: User;
  install: Install;
  community: Community;
  db: Db;
  data: BotData;
  snapshot(): Promise<Snapshot>;
  now(): Date;
  /** Envia uma mensagem como o bot. Devolve null (e registra) se o bot não puder escrever naquele canal. */
  say(channelId: string, content: string, meta?: MessageMeta): Promise<Message | null>;
  /** Registro de ações do bot, visível em Central de Bots → Logs. */
  log(action: string, detail?: Record<string, unknown>, level?: 'info' | 'aviso' | 'erro'): Promise<void>;
  /** Agenda uma tarefa. Com `everySeconds`, ela se repete. Devolve o identificador. */
  schedule(kind: string, payload: Record<string, unknown>, runAt: Date, everySeconds?: number): Promise<string>;
  cancel(jobId: string): Promise<void>;
  /** Tenta uma ação que depende das permissões do bot; se o backend recusar, registra o motivo e devolve false. */
  attempt(what: string, action: () => Promise<unknown>): Promise<boolean>;
}

export interface CommandCall {
  name: string;
  /** Tudo o que veio depois do nome do comando. */
  args: string;
  argv: string[];
  user: User;
  member: Member;
  channel: Channel;
  message: Message;
  /** Permissões de quem chamou, neste canal. */
  permissions: bigint;
}

export type Reply = string | { content: string; meta?: MessageMeta } | void;

export interface CommandDef {
  name: string;
  usage: string;
  about: string;
  /** Permissão exigida além de "Executar comandos". */
  permission?: bigint;
  run(ctx: BotContext, call: CommandCall): Promise<Reply>;
}

export interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface BotModule {
  id: string;
  name: string;
  about: string;
  category: 'Moderação' | 'Comunidade' | 'Utilidades' | 'Diversão' | 'Voz' | 'Automação';
  /** Nome de um ícone da biblioteca usada na interface. */
  icon: string;
  features: string[];
  /** O que o bot pode fazer no grupo. É o cargo dele: nada além disso. */
  permissions: bigint;
  defaultConfig: Record<string, unknown>;
  fields: ConfigField[];
  commands?: CommandDef[];
  /** Recebe os eventos do grupo. Para mensagens, devolver 'apagada' avisa que a mensagem foi removida (comandos não rodam). */
  onEvent?(ctx: BotContext, event: CommunityEvent): Promise<void | 'apagada'>;
  onJob?(ctx: BotContext, job: Job): Promise<void>;
  /** Avisos sobre a instalação (falta posição na hierarquia, canal apagado...). */
  status?(ctx: BotContext): Promise<string[]>;
  onInstall?(ctx: BotContext): Promise<void>;
}
