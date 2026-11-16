/** Utilidades compartilhadas pelos bots: variáveis em textos e leitura de datas em português. */

/** Troca {variavel} pelo valor. Variável desconhecida fica como está. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-zà-ú_]+)\}/gi, (whole, name: string) => (name.toLowerCase() in values ? String(values[name.toLowerCase()]) : whole));
}

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const plain = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Diferença, em minutos, entre o horário local do fuso e o UTC, naquele instante. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Monta um instante a partir de dia e hora "de parede" num fuso. */
function wallTime(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = new Date(Date.UTC(year, month, day, hour, minute));
  return new Date(guess.getTime() - zoneOffsetMinutes(timeZone, guess) * 60_000);
}

function localParts(timeZone: string, at: Date): { year: number; month: number; day: number; weekday: number } {
  const local = new Date(at.getTime() + zoneOffsetMinutes(timeZone, at) * 60_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth(), day: local.getUTCDate(), weekday: local.getUTCDay() };
}

export interface When {
  at: Date;
  /** Intervalo de repetição em segundos, quando o texto pede repetição. */
  everySeconds?: number;
  /** O que sobrou do texto depois da data (a mensagem do lembrete). */
  rest: string;
}

/**
 * Entende o começo de um texto como uma data, em português:
 *   "em 10m" / "em 2h" / "em 3 dias"
 *   "hoje 21:00" / "amanhã 8h30" / "sexta 20:00" / "25/12 09:00" / "25/12/2027 09:00" / "21:30"
 *   "todo dia 21:00" / "toda segunda 20:00" (repetem)
 * Devolve null se não entender. Datas no passado viram a próxima ocorrência quando isso faz sentido.
 */
export function parseWhen(text: string, now: Date, timeZone: string): When | null {
  const input = text.trim();
  const clean = plain(input);
  const time = String.raw`(\d{1,2})(?::|h)(\d{2})?h?`;
  const cut = (length: number) => input.slice(length).trim();
  const hm = (hour: string, minute: string | undefined): [number, number] | null => {
    const h = Number(hour);
    const m = Number(minute ?? 0);
    return h <= 23 && m <= 59 ? [h, m] : null;
  };
  const today = localParts(timeZone, now);
  let match: RegExpExecArray | null;

  if ((match = /^em\s+(\d{1,4})\s*(m|min|mins|minuto|minutos|h|hora|horas|d|dia|dias)\b\s*/.exec(clean))) {
    const amount = Number(match[1]);
    const unit = match[2]![0] === 'm' ? 60 : match[2]![0] === 'h' ? 3600 : 86_400;
    if (amount < 1 || amount * unit > 366 * 86_400) return null;
    return { at: new Date(now.getTime() + amount * unit * 1000), rest: cut(match[0].length) };
  }
  if ((match = new RegExp(String.raw`^tod[oa]s?\s+(?:os\s+)?dias?\s+(?:as\s+)?${time}\s*`).exec(clean))) {
    const clock = hm(match[1]!, match[2]);
    if (!clock) return null;
    let at = wallTime(timeZone, today.year, today.month, today.day, ...clock);
    if (at <= now) at = wallTime(timeZone, today.year, today.month, today.day + 1, ...clock);
    return { at, everySeconds: 86_400, rest: cut(match[0].length) };
  }
  if ((match = new RegExp(String.raw`^tod[oa]s?\s+(?:as\s+)?(${WEEKDAYS.join('|')})(?:-feira|s)?\s+(?:as\s+)?${time}\s*`).exec(clean))) {
    const clock = hm(match[2]!, match[3]);
    if (!clock) return null;
    const ahead = (WEEKDAYS.indexOf(match[1]!) - today.weekday + 7) % 7;
    let at = wallTime(timeZone, today.year, today.month, today.day + ahead, ...clock);
    if (at <= now) at = wallTime(timeZone, today.year, today.month, today.day + ahead + 7, ...clock);
    return { at, everySeconds: 7 * 86_400, rest: cut(match[0].length) };
  }
  if ((match = new RegExp(String.raw`^(hoje|amanha)\s+(?:as\s+)?${time}\s*`).exec(clean))) {
    const clock = hm(match[2]!, match[3]);
    if (!clock) return null;
    const at = wallTime(timeZone, today.year, today.month, today.day + (match[1] === 'amanha' ? 1 : 0), ...clock);
    return at > now ? { at, rest: cut(match[0].length) } : null;
  }
  if ((match = new RegExp(String.raw`^(${WEEKDAYS.join('|')})(?:-feira)?\s+(?:as\s+)?${time}\s*`).exec(clean))) {
    const clock = hm(match[2]!, match[3]);
    if (!clock) return null;
    const ahead = (WEEKDAYS.indexOf(match[1]!) - today.weekday + 7) % 7;
    let at = wallTime(timeZone, today.year, today.month, today.day + ahead, ...clock);
    if (at <= now) at = wallTime(timeZone, today.year, today.month, today.day + ahead + 7, ...clock);
    return { at, rest: cut(match[0].length) };
  }
  if ((match = new RegExp(String.raw`^(\d{1,2})/(\d{1,2})(?:/(\d{4}))?\s+(?:as\s+)?${time}\s*`).exec(clean))) {
    const clock = hm(match[4]!, match[5]);
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (!clock || day < 1 || day > 31 || month < 0 || month > 11) return null;
    let at = wallTime(timeZone, match[3] ? Number(match[3]) : today.year, month, day, ...clock);
    if (at <= now && !match[3]) at = wallTime(timeZone, today.year + 1, month, day, ...clock);
    return at > now && at.getTime() - now.getTime() < 2 * 366 * 86_400_000 ? { at, rest: cut(match[0].length) } : null;
  }
  if ((match = new RegExp(String.raw`^(?:as\s+)?${time}\s*`).exec(clean)) && /[:h]/.test(match[0])) {
    const clock = hm(match[1]!, match[2]);
    if (!clock) return null;
    let at = wallTime(timeZone, today.year, today.month, today.day, ...clock);
    if (at <= now) at = wallTime(timeZone, today.year, today.month, today.day + 1, ...clock);
    return { at, rest: cut(match[0].length) };
  }
  return null;
}

export function formatWhen(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at);
}

/** Texto sem acento e em minúsculas, para comparar palavras ("Idiota" = "idióta"). */
export const normalize = plain;
