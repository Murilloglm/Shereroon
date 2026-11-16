import { describe, expect, it } from 'vitest';
import { shouldAlert } from './alerts.ts';

describe('quando uma mensagem merece aviso', () => {
  it('"todas as mensagens" avisa sempre', () => {
    expect(shouldAlert({ level: 'tudo', mentioned: false })).toBe(true);
    expect(shouldAlert({ level: 'tudo', mentioned: true })).toBe(true);
  });

  it('"só menções" avisa apenas quando a conta foi mencionada', () => {
    expect(shouldAlert({ level: 'mencoes', mentioned: false })).toBe(false);
    expect(shouldAlert({ level: 'mencoes', mentioned: true })).toBe(true);
  });

  it('canal silenciado não avisa nem com menção', () => {
    expect(shouldAlert({ level: 'nada', mentioned: true })).toBe(false);
  });
});
