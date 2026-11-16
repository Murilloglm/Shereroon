import { describe, expect, it } from 'vitest';
import { applyMention, insertAt, mentionQuery, splitMessage } from './text.ts';

const people: Record<string, { userId: string; label: string }> = { ana: { userId: 'u1', label: 'Ana' }, 'beto.silva': { userId: 'u2', label: 'Beto' } };
const context = (mentions: string[], mentionEveryone = false) => ({ mentions, mentionEveryone, lookup: (name: string) => people[name] });

describe('texto das mensagens', () => {
  it('separa links, menções e texto, na ordem', () => {
    expect(splitMessage('oi @ana veja https://exemplo.com/a?b=1 agora', context(['u1']))).toEqual([
      { type: 'texto', text: 'oi ' },
      { type: 'mencao', text: '@Ana', userId: 'u1' },
      { type: 'texto', text: ' veja ' },
      { type: 'link', text: 'https://exemplo.com/a?b=1' },
      { type: 'texto', text: ' agora' },
    ]);
  });

  it('só destaca quem o servidor marcou como mencionado', () => {
    expect(splitMessage('oi @ana', context([]))).toEqual([{ type: 'texto', text: 'oi @ana' }]);
    expect(splitMessage('fulano@ana.com', context(['u1']))).toEqual([{ type: 'texto', text: 'fulano@ana.com' }]);
    expect(splitMessage('@ninguem aqui', context(['u1']))).toEqual([{ type: 'texto', text: '@ninguem aqui' }]);
  });

  it('entende ponto final depois do nome e nomes com ponto', () => {
    expect(splitMessage('valeu @ana.', context(['u1']))).toEqual([
      { type: 'texto', text: 'valeu ' },
      { type: 'mencao', text: '@Ana', userId: 'u1' },
      { type: 'texto', text: '.' },
    ]);
    expect(splitMessage('@Beto.Silva chegou', context(['u2']))[0]).toEqual({ type: 'mencao', text: '@Beto', userId: 'u2' });
  });

  it('@everyone só é destaque quando a mensagem foi aceita como menção geral', () => {
    expect(splitMessage('@everyone reunião', context([], true))[0]).toEqual({ type: 'mencao', text: '@everyone', userId: null });
    expect(splitMessage('@everyone reunião', context([], false))).toEqual([{ type: 'texto', text: '@everyone reunião' }]);
  });

  it('marcação continua sendo texto puro', () => {
    expect(splitMessage('<b>oi</b> <img src=x>', context([]))).toEqual([{ type: 'texto', text: '<b>oi</b> <img src=x>' }]);
  });
});

describe('menção em digitação', () => {
  it('acha o que vem depois do @ até o cursor', () => {
    expect(mentionQuery('oi @An', 6)).toEqual({ start: 3, query: 'an' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('oi @ana tudo', 12)).toBeNull();
    expect(mentionQuery('email@an', 8)).toBeNull();
  });

  it('completa com o nome de usuário e deixa o cursor depois do espaço', () => {
    expect(applyMention('oi @an tudo', 6, 3, 'ana')).toEqual({ text: 'oi @ana  tudo', caret: 8 });
  });

  it('insere emoji no cursor, trocando a seleção', () => {
    expect(insertAt('bom dia', 3, 3, '🌙')).toEqual({ text: 'bom🌙 dia', caret: 5 });
    expect(insertAt('bom dia', 0, 3, '🌙')).toEqual({ text: '🌙 dia', caret: 2 });
  });
});
