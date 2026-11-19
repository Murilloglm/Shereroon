export interface Delivery {
  clientId?: string | null;
  delivery?: 'sending' | 'sent' | 'failed';
  deliveryError?: string;
  localOrder?: number;
}
interface OrderedMessage extends Delivery { id: string; createdAt: string; author: { id: string | null } }
export const serverId = (id: string | undefined): boolean => !!id && /^\d+$/.test(id);
export function compareIds(a: string, b: string): number {
  const x = BigInt(a), y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function compareMessages(a: OrderedMessage, b: OrderedMessage): number {
  const x = serverId(a.id), y = serverId(b.id);
  if (x && y) return compareIds(a.id, b.id);
  if (x !== y) return x ? -1 : 1;
  return (a.localOrder ?? 0) - (b.localOrder ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
/** HTTP, histórico e WebSocket podem confirmar a mesma mensagem em qualquer ordem. */
export function mergeMessages<T extends OrderedMessage>(current: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map(current.map(item => [item.id, item]));
  const byRequest = new Map(current.filter(item => item.clientId).map(item => [`${item.author.id}:${item.clientId}`, item.id]));
  for (const item of incoming) {
    const key = item.clientId ? `${item.author.id}:${item.clientId}` : undefined;
    const previousId = key ? byRequest.get(key) : undefined;
    const previous = byId.get(previousId ?? item.id);
    if (previous && serverId(previous.id) && !serverId(item.id)) continue;
    if (previousId && previousId !== item.id) byId.delete(previousId);
    const next = previous?.delivery && serverId(item.id) ? { ...item, delivery: 'sent' as const, ...(previous.localOrder === undefined ? {} : { localOrder: previous.localOrder }) } : item;
    // Mantém referências das linhas que não mudaram, inclusive HTTP após o eco no gateway.
    byId.set(item.id, previous && previous.id === item.id && JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    if (key) byRequest.set(key, item.id);
  }
  return [...byId.values()].sort(compareMessages);
}
