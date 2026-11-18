import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Accounts } from '../src/community/auth.ts';
import { CosmicAdmin, bootstrapAdmin, totp } from '../src/community/global-admin.ts';
import { migrate } from '../src/db/schema.ts';
import { connectPglite } from '../src/db/db.ts';
import { createWorld, type Person, type World } from './world.ts';
import { ALL_PERMISSIONS } from '../../shared/permissions.ts';

let w: World;
let admin: Person, owner: Person, sender: Person, recipient: Person, outsider: Person;
let secret: string, recovery: string[], groupId: string;
const authorized = (extra: Record<string, unknown> = {}) => ({ confirm: true, reason: 'Operação autorizada para teste', ...extra });
const createCode = (code: string, extra: Record<string, unknown> = {}) => w.ok('POST', '/api/admin/codes', admin.token, authorized({ code, points: 500, ...extra }));
const redeem = (person: Person, code: string, key = randomUUID()) => w.api('POST', '/api/shop/redeem', person.token, { code, requestId: key });
const points = async (person: Person) => (await w.ok('GET', '/api/me/points', person.token)).points as number;
const inventory = async (person: Person) => (await w.ok('GET', '/api/me/inventory', person.token)).items as { id: string; adminGrant: boolean }[];
const gift = (person: Person, itemId: string, extra: Record<string, unknown> = {}) => w.api('POST', '/api/shop/gifts', person.token, { confirm: true, recipientId: recipient.id, itemId, kind: 'purchase', expectedPrice: 150, requestId: randomUUID(), message: 'Um presente cósmico!', ...extra });

beforeAll(async () => {
  w = await createWorld();
  [admin, owner, sender, recipient, outsider] = await Promise.all(['Mg', 'proprietario', 'remetente', 'destinatario', 'visitante'].map((name) => w.signup(name))) as [Person, Person, Person, Person, Person];
  groupId = await w.group(owner, 'Servidor privado');
  await w.ok('POST', '/api/friends', sender.token, { userId: recipient.id });
  await w.ok('POST', `/api/friends/${sender.id}/accept`, recipient.token);
  await w.ok('POST', '/api/friends', admin.token, { userId: recipient.id });
  await w.ok('POST', `/api/friends/${admin.id}/accept`, recipient.token);
});
afterAll(async () => { await w.db.close(); });
beforeEach(async () => { await w.db.query('DELETE FROM security_limits'); });

describe('administração global e MFA', () => {
  it('implementa o vetor TOTP padronizado', () => {
    expect(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1)).toBe('287082');
  });
  it('persiste o cargo principal após fechar e reabrir o banco em disco', async () => {
    const prefix = resolve(tmpdir(), 'cosmic-admin-persistence-');
    const folder = await mkdtemp(prefix);
    let database = await connectPglite(resolve(folder, 'db'));
    try {
      await migrate(database);
      const account = await new Accounts(database, { scryptCost: 10 }).register({ username: 'principal', displayName: 'Principal', password: 'senha-de-teste-1' });
      await bootstrapAdmin(database, account.user.id, 'senha-de-teste-1');
      await database.close();
      database = await connectPglite(resolve(folder, 'db'));
      const login = await new Accounts(database, { scryptCost: 10 }).login({ username: 'principal', password: 'senha-de-teste-1' });
      expect(login.user).toMatchObject({ id: account.user.id, cosmicAdmin: true });
      const [stored] = await database.query('SELECT is_primary, unlimited_cosmetics FROM global_permissions WHERE user_id = $1', [account.user.id]);
      expect(stored).toMatchObject({ is_primary: true, unlimited_cosmetics: true });
    } finally {
      await database.close();
      if (resolve(folder).startsWith(prefix)) await rm(folder, { recursive: true, force: true });
    }
  }, 30_000);
  it('não promove pelo nome, senha errada, frontend ou cargo de servidor', async () => {
    expect((await w.ok('GET', '/api/auth/me', admin.token)).user.cosmicAdmin).toBe(false);
    await expect(bootstrapAdmin(w.db, admin.id, 'senha-incorreta')).rejects.toThrow();
    await w.ok('PATCH', '/api/auth/me', owner.token, { displayName: 'Cosmic Admin', cosmicAdmin: true, unlimitedCosmetics: true });
    for (const path of ['overview', 'users', 'servers', 'permissions', 'codes', 'points', 'shop', 'gifts', 'audit', 'settings', 'mfa']) expect((await w.api('GET', `/api/admin/${path}`, owner.token)).status).toBe(403);
    expect((await w.api('PUT', `/api/admin/permissions/${owner.id}`, owner.token, authorized({ active: true }))).status).toBe(403);
    await bootstrapAdmin(w.db, admin.id, 'senha-de-teste-1');
    await expect(bootstrapAdmin(w.db, outsider.id, 'senha-de-teste-1')).rejects.toThrow();
    expect((await w.ok('GET', '/api/auth/me', admin.token)).user.cosmicAdmin).toBe(true);
    expect((await w.api('GET', '/api/admin/overview', admin.token)).json.error.code).toBe('mfa_necessario');
    expect((await w.api('POST', '/api/admin/codes', admin.token, authorized({ code: 'SemMFA', points: 500 }))).status).toBe(403);
  });
  it('cadastra MFA criptografado, confirma a sessão, recusa replay e protege a conta principal', async () => {
    expect((await w.api('POST', '/api/admin/mfa/enroll', admin.token, { password: 'incorreta' })).status).toBe(401);
    const setup = await w.ok('POST', '/api/admin/mfa/enroll', admin.token, { password: 'senha-de-teste-1' });
    secret = setup.secret;
    const verified = await w.ok('POST', '/api/admin/mfa/verify', admin.token, { code: totp(secret) });
    recovery = verified.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await w.api('POST', '/api/admin/mfa/verify', admin.token, { code: totp(secret) })).status).toBe(401);
    const [stored] = await w.db.query('SELECT mfa_secret, recovery_hashes FROM global_permissions WHERE user_id = $1', [admin.id]);
    expect(stored!.mfa_secret).not.toContain(secret);
    expect(JSON.stringify(stored!.recovery_hashes)).not.toContain(recovery[0]);
    expect((await w.ok('GET', '/api/admin/overview', admin.token)).summary.users).toBeDefined();
    expect((await w.api('PUT', `/api/admin/permissions/${admin.id}`, admin.token, authorized({ active: false }))).status).toBe(403);
  });
  it('mantém privilégios pelo ID após recriar serviços e login; novo login exige novo MFA', async () => {
    const accounts = new Accounts(w.db, { scryptCost: 10 });
    const login = await accounts.login({ username: 'Mg', password: 'senha-de-teste-1' });
    expect(login.user.cosmicAdmin).toBe(true);
    expect((await accounts.authenticate(login.token))?.adminVerified).toBe(false);
    const reloaded = new CosmicAdmin(w.db, 'segredo-do-app-para-testes');
    expect((await reloaded.status((await accounts.byId(admin.id))!, admin.token)).verified).toBe(true);
    expect((await w.api('GET', '/api/admin/users', login.token)).status).toBe(403);
    await accounts.logout(login.token);
    expect(await migrate(w.db)).toEqual([]);
  });
  it('entra sem convite com auditoria visível, gerencia o servidor e fica acima do dono', async () => {
    expect((await w.api('GET', `/api/groups/${groupId}`, admin.token)).status).toBe(404);
    await w.ok('POST', `/api/admin/servers/${groupId}/join`, admin.token, authorized());
    const state = await w.view(admin, groupId);
    expect(state.me).toMatchObject({ isOwner: false, isCosmicAdmin: true, permissions: ALL_PERMISSIONS.toString() });
    expect(state.members.find((member: any) => member.userId === admin.id).cosmicAdmin).toBe(true);
    await w.ok('POST', `/api/groups/${groupId}/channels`, admin.token, { name: 'canal-oficial', kind: 'texto' });
    for (const action of ['kick', 'ban', 'timeout']) expect((await w.api('POST', `/api/groups/${groupId}/members/${admin.id}/${action}`, owner.token, { seconds: 60 })).status).toBe(403);
    expect((await w.api('PATCH', `/api/groups/${groupId}/members/${admin.id}`, owner.token, { roleIds: [] })).status).toBe(403);
    const audit = await w.ok('GET', `/api/groups/${groupId}/audit`, owner.token);
    expect(audit.entries.some((row: any) => row.action === 'cosmic_admin.entrada')).toBe(true);
    const global = await w.ok('GET', '/api/admin/audit', admin.token);
    expect(global.rows.some((row: any) => row.action === 'servidor.entrada_global' && row.target_id === groupId)).toBe(true);
    expect(global.rows.some((row: any) => row.action === 'canal.criado')).toBe(true);
    expect((await w.ok('GET', `/api/users/${admin.id}`, owner.token)).profile.cosmicAdmin).toBe(true);
  });
  it('não dá acesso às mensagens privadas entre outras contas', async () => {
    const dm = (await w.ok('POST', '/api/dms', sender.token, { userId: recipient.id })).id;
    await w.ok('POST', `/api/dms/${dm}/messages`, sender.token, { content: 'Mensagem privada entre amigos' });
    expect((await w.api('GET', `/api/dms/${dm}/messages`, admin.token)).status).toBe(404);
    expect((await w.api('POST', `/api/dms/${dm}/messages`, admin.token, { content: 'Não autorizado' })).status).toBe(404);
  });
  it('não usa a verificação de outra sessão para acessar servidor ou painel', async () => {
    const login = await w.ok('POST', '/api/auth/login', null, { username: 'Mg', password: 'senha-de-teste-1' });
    expect((await w.api('GET', `/api/groups/${groupId}`, login.token)).json.error.code).toBe('mfa_necessario');
    expect((await w.api('GET', '/api/admin/overview', login.token)).status).toBe(403);
    await w.ok('POST', '/api/auth/logout', login.token);
  });
});

describe('códigos promocionais atômicos', () => {
  it('limita tentativas por conta no banco, mesmo recriando serviços', async () => {
    for (let i = 0; i < 8; i++) expect((await redeem(outsider, 'NaoExiste')).status).toBe(409);
    expect((await redeem(outsider, 'NaoExiste')).status).toBe(429);
  });
  it('concede a recompensa, aceita normalização e repete uma chave sem duplicar', async () => {
    await createCode('Update3.1');
    const before = await points(sender), key = randomUUID();
    expect((await redeem(sender, '  UPDATE3.1 ', key)).json).toMatchObject({ reward: { kind: 'points', points: 500 }, replay: false });
    expect((await redeem(sender, 'Update3.1', key)).json.replay).toBe(true);
    expect(await points(sender)).toBe(before + 500);
    expect((await redeem(sender, 'Update3.1')).json.error.code).toBe('codigo_ja_resgatado');
    const codes = (await w.ok('GET', '/api/admin/codes', admin.token)).rows;
    const code = codes.find((row: any) => row.code === 'Update3.1');
    expect(code.uses).toBe(1);
    expect((await w.ok('GET', `/api/admin/codes/${code.id}/redemptions`, admin.token)).rows[0].user_id).toBe(sender.id);
  });
  it('impede recompensa duplicada e ultrapassar limite total com pedidos simultâneos', async () => {
    await createCode('Ultimo', { points: 20, maxUses: 1 });
    const responses = await Promise.all([redeem(sender, 'Ultimo'), redeem(recipient, 'Ultimo'), redeem(owner, 'Ultimo')]);
    expect(responses.map((row) => row.status).sort()).toEqual([200, 409, 409]);
    await createCode('PorConta', { points: 30 });
    const same = await Promise.all(Array.from({ length: 6 }, () => redeem(recipient, 'PorConta')));
    expect(same.filter((row) => row.status === 200)).toHaveLength(1);
    await createCode('DoisUsos', { points: 1, perUser: 2 });
    expect((await redeem(sender, 'DoisUsos')).status).toBe(200);
    expect((await redeem(sender, 'DoisUsos')).status).toBe(200);
    expect((await redeem(sender, 'DoisUsos')).status).toBe(409);
  });
  it('recusa expirados, desativados e revogados; não permite reutilizar nomes nem chaves', async () => {
    await createCode('Expira', { expiresAt: new Date(w.clock.now.getTime() + 1000).toISOString() });
    w.clock.now = new Date(w.clock.now.getTime() + 2000);
    expect((await redeem(sender, 'Expira')).status).toBe(409);
    const created = await createCode('Controle');
    await w.ok('PATCH', `/api/admin/codes/${created.id}`, admin.token, authorized({ active: false }));
    expect((await redeem(sender, 'Controle')).status).toBe(409);
    await w.ok('PATCH', `/api/admin/codes/${created.id}`, admin.token, authorized({ active: true }));
    const key = randomUUID();
    expect((await redeem(sender, 'Controle', key)).status).toBe(200);
    expect((await redeem(sender, 'Update3.1', key)).json.error.code).toBe('pedido_reutilizado');
    await w.ok('DELETE', `/api/admin/codes/${created.id}`, admin.token, authorized());
    expect((await redeem(recipient, 'Controle')).status).toBe(409);
    expect((await w.api('POST', '/api/admin/codes', admin.token, authorized({ code: 'Controle', points: 1 }))).status).toBe(409);
  });
  it('entrega recompensa cosmética sem duplicar inventário nem consumir resgate em falha', async () => {
    const promo = await createCode('Cosmetico', { rewardKind: 'cosmetic', itemId: 'moldura-neon', points: 0, perUser: 2 });
    expect((await redeem(sender, 'Cosmetico')).status).toBe(200);
    expect((await redeem(sender, 'Cosmetico')).json.error.code).toBe('item_repetido');
    expect((await inventory(sender)).filter((item) => item.id === 'moldura-neon')).toHaveLength(1);
    expect((await w.ok('GET', `/api/admin/codes/${promo.id}/redemptions`, admin.token)).rows).toHaveLength(1);
  });
});

describe('presentes e transferências', () => {
  it('cobra e entrega só uma vez ao amigo correto, com histórico e notificação persistente', async () => {
    const live = await w.connect(recipient), before = await points(sender), key = randomUUID();
    const result = await Promise.all([gift(sender, 'anel-aurora', { requestId: key }), gift(sender, 'anel-aurora', { requestId: key })]);
    expect(result.map((r) => r.status)).toEqual([200, 200]);
    expect(result.map((r) => r.json.replay).sort()).toEqual([false, true]);
    expect(await points(sender)).toBe(before - 150);
    expect((await inventory(recipient)).some((item) => item.id === 'anel-aurora')).toBe(true);
    expect((await inventory(sender)).some((item) => item.id === 'anel-aurora')).toBe(false);
    expect(live.of('gift.received')).toHaveLength(1);
    live.close();
    const received = (await w.ok('GET', '/api/me/gifts', recipient.token)).gifts;
    expect(received[0]).toMatchObject({ senderId: sender.id, message: 'Um presente cósmico!', unread: true });
    await w.ok('POST', `/api/me/gifts/${received[0].id}/read`, outsider.token);
    expect((await w.ok('GET', '/api/me/gifts', recipient.token)).gifts[0].unread).toBe(true);
    await w.ok('POST', `/api/me/gifts/${received[0].id}/read`, recipient.token);
    expect((await w.ok('GET', '/api/me/gifts', recipient.token)).gifts[0].unread).toBe(false);
    const beforeDuplicate = await points(sender);
    expect((await gift(sender, 'anel-aurora')).json.error.code).toBe('item_repetido');
    expect(await points(sender)).toBe(beforeDuplicate);
  });
  it('recusa não amigos, falta de confirmação, saldo insuficiente e preço alterado sem perda', async () => {
    expect((await gift(outsider, 'orbita-estelar', { expectedPrice: 300 })).status).toBe(403);
    expect((await gift(sender, 'orbita-estelar', { confirm: false, expectedPrice: 300 })).status).toBe(400);
    const before = await points(sender);
    expect((await gift(sender, 'guardiao-cosmico', { expectedPrice: 1200 })).json.error.code).toBe('pontos_insuficientes');
    expect((await gift(sender, 'orbita-estelar', { expectedPrice: 1 })).json.error.code).toBe('preco_alterado');
    expect(await points(sender)).toBe(before);
    expect((await inventory(recipient)).some((item) => item.id === 'guardiao-cosmico')).toBe(false);
  });
  it('transfere um item permitido, desequipa e permite recomprar; concorrência não duplica', async () => {
    await w.ok('PATCH', '/api/admin/shop/moldura-neon', admin.token, authorized({ price: 120, active: true, transferable: true }));
    await w.ok('PUT', '/api/me/equipped', sender.token, { slot: 'moldura', itemId: 'moldura-neon' });
    const before = await points(sender);
    const results = await Promise.all([gift(sender, 'moldura-neon', { kind: 'transfer' }), gift(sender, 'moldura-neon', { kind: 'transfer' })]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(await points(sender)).toBe(before);
    expect((await inventory(sender)).some((item) => item.id === 'moldura-neon')).toBe(false);
    expect((await w.ok('GET', '/api/me/inventory', sender.token)).equipped.moldura).toBeUndefined();
    await w.ok('POST', '/api/shop/buy', sender.token, { itemId: 'moldura-neon', expectedPrice: 120 });
    expect(await points(sender)).toBe(before - 120);
  });
});

describe('economia administrativa', () => {
  it('mostra ilimitado como permissão, mantém saldo real e não transfere itens administrativos', async () => {
    const before = await points(admin);
    expect((await w.ok('GET', '/api/me/points', admin.token)).unlimited).toBe(true);
    await w.ok('POST', '/api/shop/buy', admin.token, { itemId: 'guardiao-cosmico' });
    expect(await points(admin)).toBe(before);
    expect((await inventory(admin)).find((item) => item.id === 'guardiao-cosmico')?.adminGrant).toBe(true);
    await w.ok('PATCH', '/api/admin/shop/guardiao-cosmico', admin.token, authorized({ price: 1200, active: true, transferable: true }));
    expect((await gift(admin, 'guardiao-cosmico', { kind: 'transfer' })).json.error.code).toBe('item_intransferivel');
    const recipientBalance = await points(recipient);
    expect((await gift(admin, 'asas-nebulosa', { expectedPrice: 700 })).status).toBe(200);
    expect((await inventory(recipient)).find((item) => item.id === 'asas-nebulosa')?.adminGrant).toBe(true);
    expect(await points(admin)).toBe(before);
    expect(await points(recipient)).toBe(recipientBalance);
  });
  it('concede e remove pontos com motivo, confirmação, auditoria e idempotência', async () => {
    const before = await points(outsider), key = randomUUID();
    const input = authorized({ userId: outsider.id, delta: 500, requestId: key });
    await w.ok('POST', '/api/admin/points', admin.token, input);
    await w.ok('POST', '/api/admin/points', admin.token, input);
    expect(await points(outsider)).toBe(before + 500);
    expect((await w.api('POST', '/api/admin/points', admin.token, { ...input, confirm: false })).status).toBe(400);
    expect((await w.api('POST', '/api/admin/points', admin.token, authorized({ userId: outsider.id, delta: -1000, requestId: randomUUID() }))).status).toBe(409);
    expect(await points(outsider)).toBe(before + 500);
    await w.ok('POST', '/api/admin/points', admin.token, authorized({ userId: outsider.id, delta: -50, requestId: randomUUID() }));
    expect(await points(outsider)).toBe(before + 450);
  });
  it('configurações pausam resgates e presentes no backend', async () => {
    await w.ok('PATCH', '/api/admin/settings', admin.token, authorized({ key: 'promotions_enabled', value: false }));
    expect((await redeem(outsider, 'Update3.1')).json.error.code).toBe('resgates_pausados');
    await w.ok('PATCH', '/api/admin/settings', admin.token, authorized({ key: 'promotions_enabled', value: true }));
    await w.ok('PATCH', '/api/admin/settings', admin.token, authorized({ key: 'gifts_enabled', value: false }));
    expect((await gift(sender, 'tempestade', { expectedPrice: 650 })).json.error.code).toBe('presentes_pausados');
    await w.ok('PATCH', '/api/admin/settings', admin.token, authorized({ key: 'gifts_enabled', value: true }));
  });
  it('recupera MFA com senha e código único e revoga todas as sessões', async () => {
    expect((await w.api('POST', '/api/admin/mfa/recover', admin.token, { password: 'errada', recoveryCode: recovery[0] })).status).toBe(401);
    await w.ok('POST', '/api/admin/mfa/recover', admin.token, { password: 'senha-de-teste-1', recoveryCode: recovery[0] });
    expect((await w.api('GET', '/api/auth/me', admin.token)).status).toBe(401);
    const fresh = await w.ok('POST', '/api/auth/login', null, { username: 'Mg', password: 'senha-de-teste-1' });
    expect(fresh.user.cosmicAdmin).toBe(true);
    expect((await w.ok('GET', '/api/admin/mfa', fresh.token)).enrolled).toBe(false);
    expect((await w.api('POST', '/api/admin/mfa/recover', fresh.token, { password: 'senha-de-teste-1', recoveryCode: recovery[0] })).status).toBe(401);
  });
});
