/**
 * Texto das mensagens: separa links e menções para a tela desenhar, e acha a menção que a pessoa está
 * digitando. Nada aqui produz HTML: a interface recebe pedaços de texto e decide o que desenhar.
 */

export type Piece = { type: 'texto'; text: string } | { type: 'link'; text: string } | { type: 'mencao'; text: string; userId: string | null };

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
const MENTION = /@([A-Za-z0-9_.]{3,24})/g;
const NAME_CHAR = /[A-Za-z0-9_.@]/;

export interface MentionContext {
  mentionEveryone: boolean;
  /** Contas que o SERVIDOR considerou mencionadas. Só essas viram destaque. */
  mentions: readonly string[];
  /** Nome de usuário (em minúsculas) → conta e nome a mostrar. */
  lookup: (username: string) => { userId: string; label: string } | undefined;
}

function splitMentions(text: string, context: MentionContext, out: Piece[]): void {
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    const start = match.index;
    if (start > 0 && NAME_CHAR.test(text[start - 1]!)) continue;
    const raw = match[1]!;
    const lower = raw.toLowerCase();
    let length = raw.length;
    let found = context.lookup(lower);
    if (!found) {
      // "@ana." no fim da frase: o ponto é pontuação.
      const trimmed = lower.replace(/\.+$/, '');
      found = context.lookup(trimmed);
      length = trimmed.length;
    }
    const everyone = lower === 'everyone' && context.mentionEveryone;
    if (!everyone && !(found && context.mentions.includes(found.userId))) continue;
    if (start > last) out.push({ type: 'texto', text: text.slice(last, start) });
    out.push(everyone ? { type: 'mencao', text: '@everyone', userId: null } : { type: 'mencao', text: `@${found!.label}`, userId: found!.userId });
    last = start + 1 + (everyone ? raw.length : length);
  }
  if (last < text.length) out.push({ type: 'texto', text: text.slice(last) });
}

export function splitMessage(content: string, context: MentionContext): Piece[] {
  const out: Piece[] = [];
  for (const [index, part] of content.split(URL_PATTERN).entries()) {
    if (index % 2 === 1) out.push({ type: 'link', text: part });
    else if (part) splitMentions(part, context, out);
  }
  return out;
}

/** A menção em digitação logo antes do cursor ("@an"), ou null. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{0,24})$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]!.toLowerCase() };
}

/** Troca a menção em digitação pelo nome de usuário escolhido. Devolve o texto novo e onde fica o cursor. */
export function applyMention(text: string, caret: number, start: number, username: string): { text: string; caret: number } {
  const inserted = `@${username} `;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

/** Insere um trecho (um emoji) na posição do cursor. */
export function insertAt(text: string, start: number, end: number, piece: string): { text: string; caret: number } {
  return { text: text.slice(0, start) + piece + text.slice(end), caret: start + piece.length };
}
