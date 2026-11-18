export interface Delivery {
  clientId?: string;
  delivery?: 'sending' | 'failed';
  deliveryError?: string;
}
interface Message extends Delivery { id: string; createdAt: string; author: { id: string | null } }
export const isConfirmed = (message: Message): boolean => /^\d+$/.test(message.id);
export function messageOrder(a: Message, b: Message): number {
  const ac = isConfirmed(a), bc = isConfirmed(b);
  if (ac && bc) return a.id.length - b.id.length || a.id.localeCompare(b.id);
  if (ac !== bc) return ac ? -1 : 1;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
/** HTTP acknowledgements and gateway echoes reconcile the same client operation. */
export function mergeMessages<T extends Message>(current: readonly T[], incoming: readonly T[]): T[] {
  const items = [...current];
  for (const message of incoming) {
    const index = items.findIndex(item => item.id === message.id || !!message.clientId && item.clientId === message.clientId && item.author.id === message.author.id);
    if (index < 0) items.push(message);
    else if (!isConfirmed(items[index]!) || isConfirmed(message)) items[index] = message;
  }
  return items.sort(messageOrder);
}
export function messageKey(message: Message): string { return message.clientId ? `${message.author.id}:${message.clientId}` : message.id; }
