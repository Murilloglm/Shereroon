import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Accounts } from '../src/community/auth.ts';
import { bootstrapAdmin, setOwnerMfaExemption, totp } from '../src/community/global-admin.ts';
import { createWorld, type Person, type World } from './world.ts';

let w: World, owner: Person, secondary: Person, regular: Person, groupId: string;
const password = 'senha-de-teste-1';
const reason = 'Dispensa solicitada pelo proprietário da plataforma';
beforeAll(async () => {
  w = await createWorld();
  owner = await w.signup('fundador');
  secondary = await w.signup('segundo_admin');
  regular = await w.signup('Mg');
  groupId = await w.group(regular, 'Servidor para administração');
  await bootstrapAdmin(w.db, owner.id, password);
  await w.db.query('INSERT INTO global_permissions (user_id) VALUES ($1)', [secondary.id]);
});
afterAll(async () => { await w.db.close(); });

describe('dispensa de MFA exclusiva do proprietário', () => {
  it('não dispensa MFA automaticamente para a conta principal ou pelo nome Mg', async () => {
    expect((await w.api('GET', '/api/admin/overview', owner.token)).json.error.code).toBe('mfa_necessario');
    expect((await w.api('GET', '/api/admin/overview', regular.token)).status).toBe(403);
    await expect(setOwnerMfaExemption(w.db, owner.id, 'senha-errada', true, reason)).rejects.toThrow();
    await expect(setOwnerMfaExemption(w.db, secondary.id, password, true, reason)).rejects.toThrow('exclusiva');
    await expect(setOwnerMfaExemption(w.db, regular.id, password, true, reason)).rejects.toThrow('exclusiva');
    expect((await w.db.query('SELECT count(*)::integer AS n FROM global_permissions WHERE mfa_exempt'))[0]!.n).toBe(0);
  });
  it('ativa por ID, mantém a senha de login e não fabrica provas de segundo fator', async () => {
    await setOwnerMfaExemption(w.db, owner.id, password, true, reason);
    expect((await w.api('POST', '/api/auth/login', null, { username: owner.name, password: 'errada' })).status).toBe(401);
    const login = await w.ok('POST', '/api/auth/login', null, { username: owner.name, password });
    expect(login.user).toMatchObject({ id: owner.id, cosmicAdmin: true, mfaExempt: true, adminVerified: true });
    expect((await w.ok('GET', '/api/admin/mfa', login.token))).toMatchObject({ primary: true, mfaExempt: true, enrolled: false, verified: true });
    expect((await w.ok('GET', '/api/admin/overview', login.token)).summary).toBeDefined();
    expect((await w.db.query('SELECT count(*)::integer AS n FROM sessions WHERE user_id = $1 AND admin_verified_until IS NOT NULL', [owner.id]))[0]!.n).toBe(0);
    await w.ok('POST', '/api/auth/logout', login.token);
    expect((await w.api('GET', '/api/admin/overview', login.token)).status).toBe(401);
  });
  it('libera administração de servidores, compras e sessões novas da conta exata', async () => {
    await w.ok('POST', `/api/admin/servers/${groupId}/join`, owner.token, { confirm: true, reason });
    const view = await w.view(owner, groupId);
    expect(view.me.isCosmicAdmin).toBe(true);
    await w.ok('POST', `/api/groups/${groupId}/channels`, owner.token, { kind: 'texto', name: 'canal-oficial' });
    await w.ok('POST', '/api/shop/buy', owner.token, { itemId: 'anel-aurora', expectedPrice: 150 });
    expect((await w.ok('GET', '/api/me/points', owner.token)).points).toBe(0);
    await w.ok('PATCH', '/api/auth/me', owner.token, { displayName: 'Nome alterado' });
    const reloaded = new Accounts(w.db, { scryptCost: 10 });
    const next = await reloaded.login({ username: owner.name, password });
    expect((await reloaded.authenticate(next.token))?.mfaExempt).toBe(true);
    await w.ok('GET', '/api/admin/overview', next.token);
    await reloaded.logout(next.token);
    const audit = (await w.ok('GET', '/api/admin/audit', owner.token)).rows;
    expect(audit.some((row: any) => row.action === 'admin.mfa_dispensado' && row.target_id === owner.id && row.reason === reason)).toBe(true);
    expect(audit.some((row: any) => row.action === 'servidor.entrada_global')).toBe(true);
    expect(audit.some((row: any) => row.action === 'canal.criado')).toBe(true);
  });
  it('não transfere a exceção por campos do frontend, promoção ou nome de perfil', async () => {
    await w.ok('PATCH', '/api/auth/me', secondary.token, { displayName: 'Mg', mfaExempt: true, adminVerified: true, isPrimary: true });
    await w.ok('PUT', `/api/admin/permissions/${secondary.id}`, owner.token, { active: true, confirm: true, reason, mfaExempt: true, isPrimary: true });
    const login = await w.ok('POST', '/api/auth/login', null, { username: secondary.name, password });
    secondary.token = login.token;
    expect(login.user).toMatchObject({ cosmicAdmin: true, mfaExempt: false, adminVerified: false });
    expect((await w.api('GET', '/api/admin/overview', secondary.token)).json.error.code).toBe('mfa_necessario');
    await expect(w.db.query('UPDATE global_permissions SET mfa_exempt = true WHERE user_id = $1', [secondary.id])).rejects.toThrow('owner_mfa_exemption_only');
    expect((await w.db.query('SELECT count(*)::integer AS n FROM global_permissions WHERE mfa_exempt'))[0]!.n).toBe(1);
  });
  it('os outros administradores ainda configuram e validam MFA normalmente', async () => {
    const setup = await w.ok('POST', '/api/admin/mfa/enroll', secondary.token, { password });
    await w.ok('POST', '/api/admin/mfa/verify', secondary.token, { code: totp(setup.secret) });
    await w.ok('GET', '/api/admin/overview', secondary.token);
    const other = await w.ok('POST', '/api/auth/login', null, { username: secondary.name, password });
    expect((await w.api('GET', '/api/admin/overview', other.token)).json.error.code).toBe('mfa_necessario');
    await w.ok('POST', '/api/auth/logout', other.token);
  });
  it('permite reexigir MFA sem afetar outras contas e recusa tokens inválidos', async () => {
    await expect(w.economy.admin.requireMfa((await w.accounts.byId(owner.id))!, 'token-invalido')).rejects.toThrow();
    await setOwnerMfaExemption(w.db, owner.id, password, false, 'Retorno temporário à política de MFA para teste');
    expect((await w.api('GET', '/api/admin/overview', owner.token)).json.error.code).toBe('mfa_necessario');
    expect((await w.ok('GET', '/api/admin/mfa', secondary.token)).verified).toBe(true);
    expect((await w.ok('GET', '/api/admin/mfa', owner.token))).toMatchObject({ mfaExempt: false, verified: false });
  });
});
