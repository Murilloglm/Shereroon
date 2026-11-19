import { afterEach, expect, it, vi } from 'vitest';
import { avatars, mediaUrl, rememberAvatar, rememberAvatars } from './avatars.ts';
afterEach(() => avatars.set({ byUser: {} }));
it('valida URLs e usa IDs imutáveis; não aceita URLs externas arbitrárias', () => {
  expect(mediaUrl('arquivo:abcDEF_123-')).toMatch(/\/api\/media\/abcDEF_123-$/);
  for (const value of ['arquivo:../segredo', 'https://example.com/a.png', 'padrao:1', null]) expect(mediaUrl(value)).toBeNull();
});
it('um lote de membros notifica uma vez e mantém a foto válida até receber um valor definido', () => {
  const change = vi.fn(); const stop = avatars.subscribe(change);
  rememberAvatars([{ id: 'ana', image: 'arquivo:photo12345' }, { id: 'beto', image: 'padrao:2' }]);
  expect(change).toHaveBeenCalledTimes(1);
  rememberAvatar('ana', undefined); expect(change).toHaveBeenCalledTimes(1);
  expect(avatars.get().byUser.ana).toBe('arquivo:photo12345');
  rememberAvatar('ana', null); expect(avatars.get().byUser.ana).toBeNull();
  stop();
});
it('resposta HTTP antiga não sobrescreve um evento de foto recebido durante a requisição', () => {
  rememberAvatar('ana', 'arquivo:foto-original');
  const before = avatars.get().byUser;
  rememberAvatar('ana', 'arquivo:foto-nova');
  rememberAvatars([{ id: 'ana', image: 'arquivo:foto-original' }], before);
  expect(avatars.get().byUser.ana).toBe('arquivo:foto-nova');
  rememberAvatars([{ id: 'ana', image: 'arquivo:troca-offline' }], avatars.get().byUser);
  expect(avatars.get().byUser.ana).toBe('arquivo:troca-offline');
});
