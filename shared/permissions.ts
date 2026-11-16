/**
 * Permissões dos grupos do ShareRoom. Este arquivo é usado pelos dois lados: o backend decide com ele o que
 * cada pessoa pode fazer, e a interface usa a mesma lista e a mesma conta só para MOSTRAR. Quem manda é
 * sempre o backend.
 *
 * Cada permissão é um bit de um número grande (bigint). No JSON, o conjunto viaja como texto decimal.
 */

export type PermissionArea = 'admin' | 'texto' | 'voz' | 'tela' | 'bots';

/**
 * Onde a regra é aplicada de verdade:
 * - `servidor`: o backend (ou o SFU, com um token emitido pelo backend) recusa quem não tem a permissão;
 * - `aplicativo`: só o aplicativo de quem transmite respeita (o SFU não tem como limitar isso);
 * - `sem_efeito`: o recurso ainda não existe no ShareRoom; a permissão fica guardada para quando existir.
 */
export type Enforcement = 'servidor' | 'aplicativo' | 'sem_efeito';

export interface PermissionInfo {
  key: PermissionKey;
  bit: number;
  area: PermissionArea;
  name: string;
  about: string;
  enforcement: Enforcement;
}

const LIST = [
  // Administração
  ['ADMINISTRATOR', 0, 'admin', 'Administrador', 'Tem todas as permissões e passa por cima das regras de cada canal. Dê com muito cuidado.', 'servidor'],
  ['MANAGE_ROLES', 1, 'admin', 'Gerenciar cargos', 'Criar, editar e excluir cargos abaixo do seu, dar ou tirar esses cargos e mudar as permissões por canal.', 'servidor'],
  ['MANAGE_CHANNELS', 2, 'admin', 'Gerenciar canais', 'Criar, renomear, reorganizar e excluir canais e categorias.', 'servidor'],
  ['MANAGE_GROUP', 3, 'admin', 'Gerenciar grupo', 'Mudar nome, descrição, ícone e se o grupo é público.', 'servidor'],
  ['CREATE_INVITE', 4, 'admin', 'Criar convites', 'Gerar links de convite para o grupo.', 'servidor'],
  ['KICK_MEMBERS', 5, 'admin', 'Expulsar membros', 'Tirar do grupo membros com cargo abaixo do seu. Quem foi expulso pode voltar com um convite.', 'servidor'],
  ['BAN_MEMBERS', 6, 'admin', 'Banir e desbanir membros', 'Banir membros com cargo abaixo do seu e desfazer banimentos. Quem foi banido não volta nem com convite.', 'servidor'],
  ['VIEW_AUDIT_LOG', 7, 'admin', 'Visualizar registro de auditoria', 'Ver quem mudou cargos, permissões, canais e membros.', 'servidor'],
  // Texto
  ['VIEW_CHANNEL', 8, 'texto', 'Ver canais', 'Enxergar o canal e ler as mensagens. Sem isso o canal nem aparece na lista.', 'servidor'],
  ['SEND_MESSAGES', 9, 'texto', 'Enviar mensagens', 'Escrever nos canais de texto.', 'servidor'],
  ['ATTACH_FILES', 10, 'texto', 'Anexar arquivos', 'Enviar arquivos junto com as mensagens.', 'sem_efeito'],
  ['SEND_LINKS', 11, 'texto', 'Enviar links', 'Sem isso, mensagens com endereços de sites são recusadas.', 'servidor'],
  ['DELETE_MESSAGES', 12, 'texto', 'Excluir mensagens de outros membros', 'Apagar mensagens que não são suas.', 'servidor'],
  ['PIN_MESSAGES', 13, 'texto', 'Fixar mensagens', 'Fixar e desafixar mensagens no canal.', 'servidor'],
  ['MENTION_EVERYONE', 14, 'texto', 'Mencionar @everyone', 'Usar @everyone para chamar a atenção de todos os membros do canal.', 'servidor'],
  ['MANAGE_MESSAGES', 15, 'texto', 'Gerenciar mensagens', 'Inclui excluir mensagens de outros e fixar.', 'servidor'],
  // Voz
  ['CONNECT', 16, 'voz', 'Conectar', 'Entrar nos canais de voz.', 'servidor'],
  ['SPEAK', 17, 'voz', 'Falar', 'Ligar o microfone no canal de voz.', 'servidor'],
  ['VIDEO', 18, 'voz', 'Ativar vídeo', 'Ligar a câmera no canal de voz.', 'sem_efeito'],
  ['MUTE_MEMBERS', 19, 'voz', 'Silenciar outros membros', 'Desligar na hora o microfone de outra pessoa no canal de voz.', 'servidor'],
  ['BLOCK_SPEAK', 20, 'voz', 'Impedir outros membros de falar', 'Tirar de alguém o direito de falar naquele canal até ser devolvido.', 'servidor'],
  ['MOVE_MEMBERS', 21, 'voz', 'Mover participantes', 'Tirar alguém de um canal de voz ou levar para outro.', 'servidor'],
  ['PRIORITY_SPEAKER', 22, 'voz', 'Definir prioridade de fala', 'Quando esta pessoa fala, o volume dos outros diminui.', 'sem_efeito'],
  // Compartilhamento de tela
  ['STREAM', 23, 'tela', 'Iniciar transmissão', 'Compartilhar a tela no canal de voz.', 'servidor'],
  ['WATCH_STREAMS', 24, 'tela', 'Assistir transmissões', 'Ver as telas compartilhadas no canal.', 'aplicativo'],
  ['SHARE_AUDIO', 25, 'tela', 'Compartilhar áudio', 'Transmitir o som do computador ou de aplicativos junto com a tela.', 'servidor'],
  ['HIGH_QUALITY_STREAM', 26, 'tela', 'Usar transmissão em alta qualidade', 'Transmitir acima de 720p a 30 FPS.', 'aplicativo'],
  ['STOP_STREAMS', 27, 'tela', 'Encerrar transmissões de outros membros', 'Parar a tela compartilhada por outra pessoa.', 'servidor'],
  // Bots
  ['INSTALL_BOTS', 28, 'bots', 'Instalar bots', 'Adicionar e remover bots do grupo.', 'servidor'],
  ['CONFIGURE_BOTS', 29, 'bots', 'Configurar bots', 'Mudar as opções dos bots instalados.', 'servidor'],
  ['USE_COMMANDS', 30, 'bots', 'Executar comandos', 'Usar os comandos dos bots nos canais.', 'servidor'],
  ['MANAGE_AUTOMATIONS', 31, 'bots', 'Gerenciar automações', 'Criar, editar e ligar regras de automação.', 'servidor'],
  ['VIEW_BOT_LOGS', 32, 'bots', 'Visualizar logs', 'Ver o que os bots fizeram.', 'servidor'],
  ['CONTROL_MUSIC', 33, 'bots', 'Controlar música', 'Comandar a fila e o player do bot de música.', 'sem_efeito'],
  ['MANAGE_TICKETS', 34, 'bots', 'Gerenciar tickets', 'Atender, encerrar e reabrir tickets.', 'servidor'],
  ['USE_ADMIN_TOOLS', 35, 'bots', 'Utilizar ferramentas administrativas', 'Usar os comandos de moderação dos bots.', 'servidor'],
] as const;

export type PermissionKey = (typeof LIST)[number][0];

export const PERMISSIONS: readonly PermissionInfo[] = LIST.map(([key, bit, area, name, about, enforcement]) => ({ key, bit, area, name, about, enforcement }));

/** Um bit por permissão: `P.SEND_MESSAGES`. */
export const P = Object.fromEntries(LIST.map(([key, bit]) => [key, 1n << BigInt(bit)])) as Record<PermissionKey, bigint>;

export const ALL_PERMISSIONS: bigint = PERMISSIONS.reduce((mask, permission) => mask | (1n << BigInt(permission.bit)), 0n);

export const AREA_NAMES: Record<PermissionArea, string> = {
  admin: 'Administração',
  texto: 'Texto',
  voz: 'Voz',
  tela: 'Compartilhamento de tela',
  bots: 'Bots',
};

/** O que um membro comum pode fazer num grupo recém-criado (cargo @everyone). */
export const DEFAULT_EVERYONE: bigint =
  P.VIEW_CHANNEL |
  P.SEND_MESSAGES |
  P.ATTACH_FILES |
  P.SEND_LINKS |
  P.CREATE_INVITE |
  P.CONNECT |
  P.SPEAK |
  P.VIDEO |
  P.STREAM |
  P.WATCH_STREAMS |
  P.SHARE_AUDIO |
  P.HIGH_QUALITY_STREAM |
  P.USE_COMMANDS;

/** Modelos para criar cargos comuns com um clique. São só pontos de partida, editáveis depois. */
export const ROLE_TEMPLATES: { name: string; color: string; permissions: bigint }[] = [
  { name: 'Administrador', color: '#f87171', permissions: P.ADMINISTRATOR },
  {
    name: 'Moderador',
    color: '#4ade80',
    permissions:
      DEFAULT_EVERYONE |
      P.KICK_MEMBERS |
      P.BAN_MEMBERS |
      P.MANAGE_MESSAGES |
      P.DELETE_MESSAGES |
      P.PIN_MESSAGES |
      P.MENTION_EVERYONE |
      P.MUTE_MEMBERS |
      P.BLOCK_SPEAK |
      P.MOVE_MEMBERS |
      P.STOP_STREAMS |
      P.VIEW_AUDIT_LOG |
      P.MANAGE_TICKETS |
      P.USE_ADMIN_TOOLS |
      P.VIEW_BOT_LOGS,
  },
  { name: 'VIP', color: '#fbbf24', permissions: DEFAULT_EVERYONE | P.MENTION_EVERYONE | P.PRIORITY_SPEAKER },
  { name: 'Membro', color: '#a78bfa', permissions: DEFAULT_EVERYONE },
];

export const has = (set: bigint, permission: bigint): boolean => (set & permission) === permission;

/** Texto decimal → bigint, aceitando só bits que existem. Qualquer coisa inválida vira null. */
export function parsePermissions(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return null;
  const parsed = BigInt(value);
  return (parsed & ~ALL_PERMISSIONS) === 0n ? parsed : null;
}

export interface RoleLike {
  id: string;
  position: number;
  permissions: bigint;
  isEveryone: boolean;
}

export interface OverrideLike {
  targetKind: 'cargo' | 'membro';
  targetId: string;
  allow: bigint;
  deny: bigint;
}

export interface Subject {
  userId: string;
  isOwner: boolean;
  /** Cargos que o membro tem (o @everyone não precisa estar na lista: vale para todos). */
  roleIds: ReadonlySet<string>;
  /** Membro em castigo (timeout): continua lendo, mas não escreve, não fala e não transmite. */
  timedOut?: boolean;
}

/** Permissões que valem para o grupo inteiro: a soma de todos os cargos da pessoa. O dono tem todas. */
export function basePermissions(subject: Subject, roles: readonly RoleLike[]): bigint {
  if (subject.isOwner) return ALL_PERMISSIONS;
  let set = 0n;
  for (const role of roles) {
    if (role.isEveryone || subject.roleIds.has(role.id)) set |= role.permissions;
  }
  return has(set, P.ADMINISTRATOR) ? ALL_PERMISSIONS : set;
}

const TIMEOUT_BLOCKED = P.SEND_MESSAGES | P.ATTACH_FILES | P.MENTION_EVERYONE | P.SPEAK | P.VIDEO | P.STREAM | P.SHARE_AUDIO | P.USE_COMMANDS;

/**
 * Permissões da pessoa num canal. `layers` são as regras por canal, da mais geral para a mais específica:
 * primeiro as da categoria, depois as do próprio canal. Em cada camada vale a ordem: @everyone, depois os
 * cargos da pessoa (negar e permitir somados), depois a regra individual dela. Um bit que não está em
 * "permitir" nem em "negar" é "herdar": fica como veio da camada anterior.
 */
export function channelPermissions(subject: Subject, roles: readonly RoleLike[], layers: readonly (readonly OverrideLike[])[]): bigint {
  const base = basePermissions(subject, roles);
  if (subject.isOwner || has(base, P.ADMINISTRATOR)) return ALL_PERMISSIONS;
  const everyoneId = roles.find((role) => role.isEveryone)?.id;
  let set = base;
  for (const layer of layers) {
    const everyone = layer.find((item) => item.targetKind === 'cargo' && item.targetId === everyoneId);
    if (everyone) set = (set & ~everyone.deny) | everyone.allow;
    let allow = 0n;
    let deny = 0n;
    for (const item of layer) {
      if (item.targetKind === 'cargo' && item.targetId !== everyoneId && subject.roleIds.has(item.targetId)) {
        allow |= item.allow;
        deny |= item.deny;
      }
    }
    set = (set & ~deny) | allow;
    const own = layer.find((item) => item.targetKind === 'membro' && item.targetId === subject.userId);
    if (own) set = (set & ~own.deny) | own.allow;
  }
  // As regras por canal não criam poderes de administração do grupo: esses vêm só dos cargos.
  set = (set & ~GROUP_WIDE) | (base & GROUP_WIDE);
  if (!has(set, P.VIEW_CHANNEL)) return 0n;
  if (has(set, P.MANAGE_MESSAGES)) set |= P.DELETE_MESSAGES | P.PIN_MESSAGES;
  if (subject.timedOut) set &= ~TIMEOUT_BLOCKED;
  return set;
}

/** Permissões que só fazem sentido para o grupo todo; uma regra de canal não as concede nem as tira. */
export const GROUP_WIDE: bigint =
  P.ADMINISTRATOR | P.MANAGE_ROLES | P.MANAGE_GROUP | P.CREATE_INVITE | P.KICK_MEMBERS | P.BAN_MEMBERS | P.VIEW_AUDIT_LOG | P.INSTALL_BOTS | P.CONFIGURE_BOTS | P.MANAGE_AUTOMATIONS | P.VIEW_BOT_LOGS;

/** Posição do cargo mais alto da pessoa. O dono fica acima de qualquer cargo. */
export function topPosition(subject: Subject, roles: readonly RoleLike[]): number {
  if (subject.isOwner) return Number.POSITIVE_INFINITY;
  let top = 0;
  for (const role of roles) {
    if (subject.roleIds.has(role.id) && role.position > top) top = role.position;
  }
  return top;
}

/** Só se mexe em cargo abaixo do seu cargo mais alto. Ter o mesmo cargo não basta. */
export function canManageRole(actor: Subject, roles: readonly RoleLike[], role: RoleLike): boolean {
  return actor.isOwner || role.position < topPosition(actor, roles);
}

/** Só se pune, edita ou move quem está abaixo na hierarquia. Ninguém age sobre o dono, nem sobre si mesmo. */
export function canActOnMember(actor: Subject, target: Subject, roles: readonly RoleLike[]): boolean {
  if (actor.userId === target.userId || target.isOwner) return false;
  return actor.isOwner || topPosition(target, roles) < topPosition(actor, roles);
}

/**
 * Ninguém liga ou desliga, em cargo ou regra de canal, uma permissão que não tem. É o que impede alguém com
 * "Gerenciar cargos" de se promover a administrador. Devolve os bits que a pessoa tentou mexer sem poder.
 */
export function forbiddenChanges(actorPermissions: bigint, before: bigint, after: bigint): bigint {
  return (before ^ after) & ~actorPermissions;
}

export function describePermissions(set: bigint): string[] {
  return PERMISSIONS.filter((permission) => has(set, 1n << BigInt(permission.bit))).map((permission) => permission.name);
}
