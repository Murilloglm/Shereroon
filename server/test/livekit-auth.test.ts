/**
 * Autenticação com o LiveKit — testes SIMULADOS.
 * Os JWT são gerados e conferidos de verdade (mesma biblioteca do backend); só o servidor LiveKit é um
 * substituto local (mock-livekit.ts). Os testes contra um LiveKit de verdade ficam em livekit-real.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TokenVerifier } from 'livekit-server-sdk';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { RateLimiter } from '../src/ratelimit.ts';
import { LiveKitSfu } from '../src/sfu.ts';
import { checkSfu, classifySfuError, describeSfuError } from '../src/sfu-errors.ts';
import { startMockLivekit, type MockLivekit } from './mock-livekit.ts';

const KEY = 'APIsimulada1234';
const SECRET = 'segredo-simulado-0123456789abcdefghijklmnop';
const OTHER_SECRET = 'outro-segredo-simulado-9876543210zyxwvutsrq';

let livekit: MockLivekit;
beforeAll(async () => {
  livekit = await startMockLivekit({ [KEY]: SECRET });
});
afterAll(() => livekit.close());
afterEach(() => {
  vi.useRealTimers();
  livekit.failWith(null);
});

const configWith = (key: string, secret: string, url = livekit.url) =>
  loadConfig({ LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, APP_SECRET: 'segredo-do-app-para-testes', ALLOWED_ORIGINS: 'http://localhost:5173' });

function appWith(key: string, secret: string) {
  const config = configWith(key, secret);
  const app = createApp({ config, sfu: new LiveKitSfu(config), remoteAddress: () => '203.0.113.9', limiter: new RateLimiter() });
  const post = async (path: string, body: unknown) => {
    const response = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify(body) });
    return { status: response.status, text: JSON.stringify(await response.clone().json()), json: (await response.json()) as any };
  };
  const get = async (path: string) => {
    const response = await app.request(path);
    return { status: response.status, json: (await response.json()) as any };
  };
  return { app, post, get };
}

describe('JWT de entrada (gerado só no backend)', () => {
  const sfu = () => new LiveKitSfu(configWith(KEY, SECRET));
  const request = { room: 'sala-a', identity: 'u-ana', name: 'Ana', host: false, ttlSeconds: 600 };

  it('é assinado pelo par configurado e libera só a sala pedida, sem câmera', async () => {
    const claims = await new TokenVerifier(KEY, SECRET).verify(await sfu().createToken(request));
    expect(claims.iss).toBe(KEY);
    expect(claims.sub).toBe('u-ana');
    expect(claims.video).toMatchObject({ roomJoin: true, room: 'sala-a', canPublish: true, canSubscribe: true, canUpdateOwnMetadata: false });
    expect(claims.video?.canPublishSources).toEqual(['screen_share', 'screen_share_audio', 'microphone']);
    // Nada de poder administrativo num token de participante.
    expect(claims.video?.roomAdmin).toBeUndefined();
    expect(claims.video?.roomCreate).toBeUndefined();
    expect(claims.video?.roomList).toBeUndefined();
  });

  it('vale pelo tempo configurado e expira depois', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-16T12:00:00Z') });
    const token = await sfu().createToken(request);
    const claims = await new TokenVerifier(KEY, SECRET).verify(token);
    expect((claims.exp ?? 0) - Math.floor(Date.now() / 1000)).toBe(600);
    vi.setSystemTime(new Date('2026-11-16T12:09:00Z'));
    await expect(new TokenVerifier(KEY, SECRET).verify(token, 0)).resolves.toBeTruthy();
    vi.setSystemTime(new Date('2026-11-16T12:11:00Z'));
    await expect(new TokenVerifier(KEY, SECRET).verify(token, 0)).rejects.toThrow();
  });

  it('não passa na verificação com outro segredo nem com outra chave', async () => {
    const token = await sfu().createToken(request);
    await expect(new TokenVerifier(KEY, OTHER_SECRET).verify(token)).rejects.toThrow();
    await expect(new TokenVerifier('APIoutrachave99', SECRET).verify(token)).rejects.toThrow();
  });

  it('token de canal de voz carrega só o que a pessoa pode publicar', async () => {
    const voice = (publish: { speak: boolean; stream: boolean; streamAudio: boolean }) =>
      sfu().createVoiceToken({ room: 'voz-1', identity: 'conta-1', name: 'Bia', ttlSeconds: 600, publish, metadata: { voz: true } })
        .then((token) => new TokenVerifier(KEY, SECRET).verify(token));
    expect((await voice({ speak: true, stream: false, streamAudio: false })).video).toMatchObject({ room: 'voz-1', canPublish: true, canPublishSources: ['microphone'] });
    expect((await voice({ speak: false, stream: false, streamAudio: false })).video).toMatchObject({ roomJoin: true, canPublish: false });
  });
});

describe('classificação das recusas do LiveKit', () => {
  it('par correto: a API administrativa responde', async () => {
    const sfu = new LiveKitSfu(configWith(KEY, SECRET));
    expect(await checkSfu(sfu)).toBeNull();
    await sfu.ensureRoom('sala-x', 4);
    expect((await sfu.snapshot('sala-x')).exists).toBe(true);
  });

  it('API Key que o LiveKit não conhece', async () => {
    expect(await checkSfu(new LiveKitSfu(configWith('APInaoexiste000', SECRET)))).toBe('chave_desconhecida');
  });

  it('API Secret que não corresponde à chave', async () => {
    expect(await checkSfu(new LiveKitSfu(configWith(KEY, OTHER_SECRET)))).toBe('segredo_incorreto');
  });

  it('LiveKit fora do ar ou com pane não é confundido com credencial errada', async () => {
    expect(await checkSfu(new LiveKitSfu(configWith(KEY, SECRET, 'ws://127.0.0.1:9')))).toBe('indisponivel');
    livekit.failWith(500);
    expect(await checkSfu(new LiveKitSfu(configWith(KEY, SECRET)))).toBe('indisponivel');
  });

  it('recusa sem motivo reconhecível continua sendo recusa de autenticação', () => {
    expect(classifySfuError(Object.assign(new Error('qualquer coisa'), { status: 401 }))).toBe('autenticacao_recusada');
    expect(classifySfuError(Object.assign(new Error('x'), { code: 'permission_denied' }))).toBe('autenticacao_recusada');
    expect(classifySfuError(new Error('fetch failed'))).toBe('indisponivel');
    expect(classifySfuError(null)).toBe('indisponivel');
  });

  it('o registro do erro não carrega tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJBUEkifQ.c2VncmVkby1hc3NpbmFkbw';
    const line = describeSfuError(Object.assign(new Error(`invalid token: ${jwt}, error: bad`), { status: 401 }));
    expect(line).not.toContain(jwt);
    expect(line).toContain('401');
    expect(line).toContain('<jwt>');
  });
});

describe('entrada na sala passando pelo backend', () => {
  it('chave desconhecida: erro claro, nenhum token emitido, nenhum segredo na resposta', async () => {
    const { post } = appWith('APInaoexiste000', SECRET);
    const created = await post('/api/rooms', { name: 'Jogatina' });
    const joined = await post('/api/rooms/join', { invite: created.json.invite, name: 'Ana' });
    expect(joined.status).toBe(502);
    expect(joined.json.error.code).toBe('sfu_chave_desconhecida');
    expect(joined.json.error.message).toMatch(/LIVEKIT_API_KEY/);
    expect(joined.json.token).toBeUndefined();
    expect(joined.text).not.toContain(SECRET);
    expect(joined.text).not.toContain('APInaoexiste000');
  });

  it('segredo incompatível: erro claro e diferente do anterior', async () => {
    const { post } = appWith(KEY, OTHER_SECRET);
    const created = await post('/api/rooms', { name: 'Jogatina' });
    const joined = await post('/api/rooms/join', { invite: created.json.invite, name: 'Ana' });
    expect(joined.status).toBe(502);
    expect(joined.json.error.code).toBe('sfu_segredo_incorreto');
    expect(joined.json.error.message).toMatch(/LIVEKIT_API_SECRET/);
    expect(joined.text).not.toContain(OTHER_SECRET);
  });

  it('par correto: várias pessoas entram na mesma sala privada, cada uma com seu token', async () => {
    const { post } = appWith(KEY, SECRET);
    const created = await post('/api/rooms', { name: 'Reunião', password: 'abacaxi', capacity: 5 });
    const semSenha = await post('/api/rooms/join', { invite: created.json.invite, name: 'Curioso' });
    expect(semSenha.status).toBe(401);

    const people = await Promise.all(['Ana', 'Bia', 'Caio'].map((name) => post('/api/rooms/join', { invite: created.json.invite, name, password: 'abacaxi' })));
    const claims = await Promise.all(people.map((person) => new TokenVerifier(KEY, SECRET).verify(person.json.token)));
    expect(people.map((person) => person.status)).toEqual([200, 200, 200]);
    expect(new Set(people.map((person) => person.json.identity)).size).toBe(3);
    expect(new Set(claims.map((claim) => claim.video?.room)).size).toBe(1);
    expect(claims.map((claim) => claim.name)).toEqual(['Ana', 'Bia', 'Caio']);
    expect(people[0]!.json.url).toBe(livekit.url);
  });

  it('GET /api/health/livekit diz se o LiveKit aceita as credenciais (com cache)', async () => {
    const ok = appWith(KEY, SECRET);
    const before = livekit.calls();
    expect(await ok.get('/api/health/livekit')).toEqual({ status: 200, json: { ok: true } });
    expect(await ok.get('/api/health/livekit')).toEqual({ status: 200, json: { ok: true } });
    expect(livekit.calls() - before).toBe(1);

    const bad = await appWith(KEY, OTHER_SECRET).get('/api/health/livekit');
    expect(bad.status).toBe(502);
    expect(bad.json).toMatchObject({ ok: false, error: { code: 'sfu_segredo_incorreto' } });
    // A saúde geral do serviço não depende do LiveKit: o Render não derruba o deploy por causa dele.
    expect((await appWith(KEY, OTHER_SECRET).get('/api/health')).status).toBe(200);
  });
});

describe('valores colados no painel da hospedagem', () => {
  const base = { NODE_ENV: 'production', LIVEKIT_URL: 'wss://exemplo.livekit.cloud', APP_SECRET: 'segredo-do-app-para-testes' };

  it('tira aspas, o nome da variável e quebras de linha coladas junto', () => {
    const config = loadConfig({
      ...base,
      LIVEKIT_URL: '"wss://exemplo.livekit.cloud"',
      LIVEKIT_API_KEY: ` LIVEKIT_API_KEY=${KEY}\n`,
      LIVEKIT_API_SECRET: `'${SECRET.slice(0, 20)}\n${SECRET.slice(20)}'`,
    });
    expect(config.livekitUrl).toBe('wss://exemplo.livekit.cloud');
    expect(config.apiKey).toBe(KEY);
    expect(config.apiSecret).toBe(SECRET);
    expect(config.warnings).toEqual([]);
  });

  it('corrige chave e segredo colados nos campos trocados, e avisa', () => {
    const config = loadConfig({ ...base, LIVEKIT_API_KEY: SECRET, LIVEKIT_API_SECRET: KEY });
    expect(config.apiKey).toBe(KEY);
    expect(config.apiSecret).toBe(SECRET);
    expect(config.warnings.join(' ')).toMatch(/trocad/);
  });

  it('avisa quando o formato não é o do LiveKit Cloud ou a API aponta para outro projeto, sem citar os valores', () => {
    const config = loadConfig({ ...base, LIVEKIT_API_KEY: 'minha-chave', LIVEKIT_API_SECRET: 'curto-demais', LIVEKIT_API_URL: 'https://outro-projeto.livekit.cloud' });
    expect(config.warnings).toHaveLength(3);
    expect(config.warnings.join(' ')).toMatch(/LIVEKIT_API_KEY.*LIVEKIT_API_SECRET.*LIVEKIT_API_URL/s);
    expect(config.warnings.join(' ')).not.toMatch(/minha-chave|curto-demais/);
  });

  it('servidor LiveKit próprio (fora do Cloud) aceita qualquer formato de chave sem aviso', () => {
    expect(loadConfig({ ...base, LIVEKIT_URL: 'wss://livekit.exemplo.com.br', LIVEKIT_API_KEY: 'minha-chave', LIVEKIT_API_SECRET: 'meu-segredo-proprio' }).warnings).toEqual([]);
  });
});
