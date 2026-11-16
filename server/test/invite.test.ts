import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../src/bytes.ts';
import {
  checkPassword,
  decodeInvite,
  encodeInvite,
  hostKey,
  isHostKey,
  isSessionProof,
  newRoomId,
  passwordTag,
  sessionProof,
  type RoomDescriptor,
} from '../src/invite.ts';
import { Signer } from '../src/signer.ts';

const signer = new Signer('segredo-de-teste-bem-comprido');

async function makeRoom(password?: string): Promise<RoomDescriptor> {
  const id = newRoomId();
  return {
    id,
    name: 'Jogatina com a galera',
    capacity: 10,
    passwordTag: password ? await passwordTag(signer, id, password) : null,
  };
}

describe('convite', () => {
  it('codifica e decodifica uma sala sem senha', async () => {
    const room = await makeRoom();
    const decoded = await decodeInvite(signer, await encodeInvite(signer, room));
    expect(decoded).toEqual(room);
  });

  it('preserva acentos, emoji e a marca da senha', async () => {
    const room = { ...(await makeRoom('1234')), name: 'Sessão do João 🎮' };
    const decoded = await decodeInvite(signer, await encodeInvite(signer, room));
    expect(decoded?.name).toBe('Sessão do João 🎮');
    expect(decoded?.passwordTag).toEqual(room.passwordTag);
  });

  it('rejeita qualquer byte adulterado', async () => {
    const code = await encodeInvite(signer, await makeRoom('1234'));
    const bytes = fromBase64Url(code)!;
    for (let index = 0; index < bytes.length; index++) {
      const tampered = bytes.slice();
      tampered[index] = tampered[index]! ^ 0x01;
      expect(await decodeInvite(signer, toBase64Url(tampered)), `byte ${index}`).toBeNull();
    }
  });

  it('não deixa remover a senha de um convite', async () => {
    const withPassword = await makeRoom('1234');
    const stripped = await encodeInvite(new Signer('outra-chave-qualquer-123'), { ...withPassword, passwordTag: null });
    expect(await decodeInvite(signer, stripped)).toBeNull();
  });

  it('rejeita convite assinado com outra chave e lixo em geral', async () => {
    const code = await encodeInvite(new Signer('chave-de-outro-servidor'), await makeRoom());
    expect(await decodeInvite(signer, code)).toBeNull();
    for (const junk of ['', 'abc', '!!!!', 'a'.repeat(600), null, undefined, 42, {}]) {
      expect(await decodeInvite(signer, junk)).toBeNull();
    }
  });

  it('recusa lotação fora dos limites na hora de criar', async () => {
    await expect(encodeInvite(signer, { ...(await makeRoom()), capacity: 1 })).rejects.toThrow();
    await expect(encodeInvite(signer, { ...(await makeRoom()), capacity: 500 })).rejects.toThrow();
  });
});

describe('senha', () => {
  it('aceita a senha certa e recusa a errada', async () => {
    const room = await makeRoom('açaí-com-granola');
    expect(await checkPassword(signer, room, 'açaí-com-granola')).toBe(true);
    expect(await checkPassword(signer, room, 'acai-com-granola')).toBe(false);
    expect(await checkPassword(signer, room, '')).toBe(false);
  });

  it('a mesma senha gera marcas diferentes em salas diferentes', async () => {
    const first = await makeRoom('mesma');
    const second = await makeRoom('mesma');
    expect(first.passwordTag).not.toEqual(second.passwordTag);
  });

  it('sala sem senha aceita qualquer coisa', async () => {
    expect(await checkPassword(signer, await makeRoom(), 'tanto faz')).toBe(true);
  });
});

describe('chave do dono e sessão', () => {
  it('a chave do dono vale só para a própria sala', async () => {
    const first = await makeRoom();
    const second = await makeRoom();
    const key = await hostKey(signer, first.id);
    expect(await isHostKey(signer, first.id, key)).toBe(true);
    expect(await isHostKey(signer, second.id, key)).toBe(false);
    expect(await isHostKey(signer, first.id, undefined)).toBe(false);
    expect(await isHostKey(signer, first.id, 'x'.repeat(100))).toBe(false);
  });

  it('a prova de sessão amarra identidade e sala', async () => {
    const room = await makeRoom();
    const proof = await sessionProof(signer, room.id, 'u-abc123');
    expect(await isSessionProof(signer, room.id, 'u-abc123', proof)).toBe(true);
    expect(await isSessionProof(signer, room.id, 'u-outro', proof)).toBe(false);
    expect(await isSessionProof(signer, (await makeRoom()).id, 'u-abc123', proof)).toBe(false);
    expect(await isSessionProof(signer, room.id, 'u-abc123', null)).toBe(false);
  });
});
