import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupsClient, type ChatMessage } from './client.ts';

const setup = () => {
  const client = new GroupsClient();
  client.store.set({ status: 'dentro', account: { id: 'ana', username: 'ana', displayName: 'Ana' } });
  return client;
};
const confirmed = (pending: ChatMessage): ChatMessage => ({ ...pending, id: '9007199254740993', delivery: undefined });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('mostra mensagem antes da API e uma segunda tentativa em andamento reutiliza a requisição', async () => {
  const client = setup();
  let resolve!: (value: { message: ChatMessage }) => void;
  const call = vi.spyOn(client, 'call').mockImplementation(() => new Promise(done => { resolve = done; }));
  const sending = client.send('canal', 'Oi');
  const local = client.messagesOf('canal').items[0]!;
  expect(local).toMatchObject({ content: 'Oi', delivery: 'sending' });
  const retry = client.retry(local.clientId!);
  expect(retry).toBe(sending);
  expect(call).toHaveBeenCalledTimes(1);
  resolve({ message: confirmed(local) }); await sending;
  expect(client.messagesOf('canal').items).toHaveLength(1);
  expect(client.messagesOf('canal').items[0]).toMatchObject({ delivery: 'sent', id: '9007199254740993' });
});

it('falha retém conteúdo e chave; retry usa a chave original e confirma a mesma linha', async () => {
  const client = setup();
  const call = vi.spyOn(client, 'call').mockRejectedValueOnce(new Error('Sem rede'));
  await client.send('canal', 'Não perder meu texto');
  const local = client.messagesOf('canal').items[0]!;
  expect(local).toMatchObject({ content: 'Não perder meu texto', delivery: 'failed', deliveryError: 'Sem rede' });
  call.mockResolvedValueOnce({ message: confirmed(local) });
  await client.retry(local.clientId!);
  expect(call.mock.calls[0]![2]).toEqual(call.mock.calls[1]![2]);
  expect(client.messagesOf('canal').items).toHaveLength(1);
  expect(client.messagesOf('canal').items[0]?.delivery).toBe('sent');
});

it('resposta atrasada de uma conta anterior não contamina a conta atual', async () => {
  const client = setup();
  let resolve!: (value: { message: ChatMessage }) => void;
  vi.spyOn(client, 'call').mockImplementation(() => new Promise(done => { resolve = done; }));
  const sending = client.send('canal', 'Privado');
  const local = client.messagesOf('canal').items[0]!;
  client.store.set({ account: { id: 'beto', username: 'beto', displayName: 'Beto' }, messages: {} });
  resolve({ message: confirmed(local) }); await sending;
  expect(client.messagesOf('canal').items).toHaveLength(0);
});

it('confirmação HTTP sem clientId ainda substitui a linha local durante atualização do backend', async () => {
  const client = setup();
  vi.spyOn(client, 'call').mockImplementation(async () => {
    const pending = client.messagesOf('canal').items[0]!;
    return { message: { ...confirmed(pending), clientId: undefined } };
  });
  await client.send('canal', 'compatível');
  expect(client.messagesOf('canal').items).toHaveLength(1);
  expect(client.messagesOf('canal').items[0]).toMatchObject({ id: '9007199254740993', delivery: 'sent' });
});

it('agrupa confirmações de leitura e as envia com keepalive antes do recarregamento', async () => {
  const browser = new EventTarget(); vi.stubGlobal('window', browser);
  const client = setup();
  client.store.set({ view: {
    group: { id: 'grupo', name: 'G', description: '', icon: null, isPublic: false, ownerId: 'ana' },
    me: { userId: 'ana', isOwner: true, roleIds: [], permissions: 0n, top: null, timeoutUntil: null },
    roles: [], channels: [], members: [], voice: {}, notify: { level: 'tudo', channels: {} },
    unread: { canal: { last: '3', read: '0', mentions: 1 } },
  } });
  const call = vi.spyOn(client, 'call').mockResolvedValue({});
  client.watchChannel('canal');
  client.markRead('canal', '2'); client.markRead('canal', '3');
  expect(call).not.toHaveBeenCalled();
  browser.dispatchEvent(new Event('pagehide'));
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('POST', '/api/channels/canal/read', { messageId: '3' }, undefined, true);
  await Promise.resolve();
});
