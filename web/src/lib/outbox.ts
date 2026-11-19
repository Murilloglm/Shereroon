import { compareMessages, mergeMessages, serverId, type Delivery } from './messages.ts';

export type { Delivery };
export { mergeMessages };
interface Message extends Delivery { id: string; createdAt: string; author: { id: string | null } }
export const isConfirmed = (message: Pick<Message, 'id'>): boolean => serverId(message.id);
export const messageOrder = compareMessages;
export function messageKey(message: Message): string { return message.clientId ? `${message.author.id}:${message.clientId}` : message.id; }
