import { afterEach, describe, expect, it } from 'vitest';
import { dialogQueue, dialogs, settle, typedNameMatches, validatePrompt } from './dialogs.ts';

afterEach(() => dialogQueue.set({ queue: [] }));

describe('fila de diálogos', () => {
  it('mostra um por vez, na ordem, e devolve a resposta a quem chamou', async () => {
    const first = dialogs.confirm({ title: 'Primeiro?' });
    const second = dialogs.prompt({ title: 'Nome', label: 'Nome' });
    const queue = dialogQueue.get().queue;
    expect(queue.map((item) => item.kind)).toEqual(['confirmar', 'entrada']);

    settle(queue[0]!.id, true);
    await expect(first).resolves.toBe(true);
    expect(dialogQueue.get().queue).toHaveLength(1);

    settle(queue[1]!.id, null);
    await expect(second).resolves.toBeNull();
    expect(dialogQueue.get().queue).toHaveLength(0);
  });

  it('responder duas vezes não muda a resposta nem quebra a fila', async () => {
    const answer = dialogs.remove({ title: 'Excluir?', item: '#geral' });
    const { id } = dialogQueue.get().queue[0]!;
    settle(id, false);
    settle(id, true);
    await expect(answer).resolves.toBe(false);
    expect(dialogQueue.get().queue).toHaveLength(0);
  });

  it('aviso e erro resolvem sem valor', async () => {
    const warning = dialogs.alert({ title: 'Atenção', message: 'Algo' });
    const failure = dialogs.error('Falhou', 'stack');
    const [a, b] = dialogQueue.get().queue;
    expect(a!.kind).toBe('aviso');
    expect(b!.kind).toBe('erro');
    settle(a!.id, undefined);
    settle(b!.id, undefined);
    await expect(warning).resolves.toBeUndefined();
    await expect(failure).resolves.toBeUndefined();
  });
});

describe('validação do campo de texto', () => {
  it('obrigatório, tamanho máximo e regra própria', () => {
    expect(validatePrompt({ title: '', label: '', required: true }, '   ')).toBe('Preencha este campo.');
    expect(validatePrompt({ title: '', label: '', maxLength: 3 }, 'abcd')).toBe('Use no máximo 3 caracteres.');
    expect(validatePrompt({ title: '', label: '', validate: (value) => (value.includes('@') ? null : 'Precisa de @') }, 'ana')).toBe('Precisa de @');
    expect(validatePrompt({ title: '', label: '', required: true, maxLength: 10 }, '  ana  ')).toBeNull();
  });

  it('exclusão irreversível: o nome digitado precisa bater', () => {
    expect(typedNameMatches('Os Amigos', 'os amigos')).toBe(true);
    expect(typedNameMatches('Os Amigos', ' Os Amigos ')).toBe(true);
    expect(typedNameMatches('Os Amigos', 'Os Amigo')).toBe(false);
  });
});
