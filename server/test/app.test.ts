import { beforeEach, describe, expect, it } from 'vitest';
import { cleanName, createApp } from '../src/app.ts';
import { loadConfig, ConfigError } from '../src/config.ts';
import { RateLimiter } from '../src/ratelimit.ts';
import { parseState, serializeState } from '../src/sfu.ts';
import { FakeSfu } from './fake-sfu.ts';

const ORIGIN = 'https://fulano.github.io';
const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  LIVEKIT_URL: 'wss://exemplo.livekit.cloud',
  LIVEKIT_API_KEY: 'chave',
  LIVEKIT_API_SECRET: 'segredo-do-livekit-123',
  APP_SECRET: 'segredo-do-app-para-testes',
  ALLOWED_ORIGINS: `${ORIGIN}/shareroom/, http://localhost:5173`,
};
const config = loadConfig(PRODUCTION_ENV);

let sfu: FakeSfu;
let now: number;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  sfu = new FakeSfu();
  now = 1_000_000;
  app = createApp({ config, sfu, remoteAddress: () => '203.0.113.7', limiter: new RateLimiter(() => now) });
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, json: (await response.json()) as any };
}

async function createRoom(extra: Record<string, unknown> = {}) {
  const { json } = await post('/api/rooms', { name: 'Jogatina', ...extra });
  return json as { invite: string; hostKey: string; room: { id: string; name: string; capacity: number; hasPassword: boolean } };
}

describe('configuração', () => {
  it('normaliza origens e aceita caminho colado por engano', () => {
    expect(config.allowedOrigins).toEqual([ORIGIN, 'http://localhost:5173', 'app://shareroom']);
    expect(config.livekitApiUrl).toBe('https://exemplo.livekit.cloud');
  });

  it('o aplicativo de Windows é atendido; um site desconhecido, não', async () => {
    const fromApp = await post('/api/rooms', { userName: 'Murillo' }, { origin: 'app://shareroom' });
    expect(fromApp.status).toBe(200);
    expect(fromApp.headers.get('access-control-allow-origin')).toBe('app://shareroom');
    const stranger = await post('/api/rooms', { userName: 'Murillo' }, { origin: 'https://site-desconhecido.example' });
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull();
    // Outros endereços com o esquema app:// não passam: só a origem exata do aplicativo.
    const lookalike = await post('/api/rooms', { userName: 'Murillo' }, { origin: 'app://outro' });
    expect(lookalike.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('em produção exige as variáveis do LiveKit', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
  });

  it('em desenvolvimento usa os padrões do livekit --dev', () => {
    const dev = loadConfig({});
    expect(dev.livekitUrl).toBe('ws://localhost:7880');
    expect(dev.livekitApiUrl).toBe('http://localhost:7880');
    expect(dev.apiKey).toBe('devkey');
    expect(dev.apiSecret).toBe('secret');
    expect(dev.appSecret).toBe('shareroom:secret');
    expect(dev.allowedOrigins).toContain('http://localhost:5173');
  });

  it('recusa LIVEKIT_URL sem ws://', () => {
    expect(() => loadConfig({ LIVEKIT_URL: 'https://errado' })).toThrow(/ws:\/\//);
  });

  it('em produção exige TLS no WebSocket e na API do LiveKit', () => {
    expect(() => loadConfig({ ...PRODUCTION_ENV, LIVEKIT_URL: 'ws://exemplo.livekit.cloud' })).toThrow(/LIVEKIT_URL/);
    for (const url of ['http://api.livekit.cloud', 'wss://api.livekit.cloud', 'https://', 'https:api.livekit.cloud']) {
      expect(() => loadConfig({ ...PRODUCTION_ENV, LIVEKIT_API_URL: url }), url).toThrow(/LIVEKIT_API_URL/);
    }
    const explicitApi = loadConfig({ ...PRODUCTION_ENV, LIVEKIT_API_URL: 'https://api.livekit.cloud/custom-path' });
    expect(explicitApi.livekitApiUrl).toBe('https://api.livekit.cloud/custom-path');
    expect(loadConfig({ ...PRODUCTION_ENV, LIVEKIT_URL: 'wss://1.1.1.1' }).livekitApiUrl).toBe('https://1.1.1.1');
  });

  it('em produção recusa endpoints locais, privados e link-local nas duas URLs do LiveKit', () => {
    for (const host of [
      'localhost', 'LOCALHOST.', 'app.localhost', 'livekit.local', 'livekit',
      '127.0.0.1', '127.22.33.44', '127.1', '2130706433', '0.0.0.0',
      '10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '[::1]', '[::]', '[fc00::1]', '[fd12::1]', '[fe80::1]', '[::ffff:127.0.0.1]',
    ]) {
      expect(() => loadConfig({ ...PRODUCTION_ENV, LIVEKIT_URL: `wss://${host}:7880` }), host).toThrow(/LIVEKIT_URL/);
      expect(() => loadConfig({ ...PRODUCTION_ENV, LIVEKIT_API_URL: `https://${host}:7880` }), host).toThrow(/LIVEKIT_API_URL/);
    }
  });

  it('em produção recusa credenciais e fragmentos nas URLs sem repeti-los no erro', () => {
    for (const suffix of ['login:senha-na-url@exemplo.livekit.cloud', 'exemplo.livekit.cloud/#fragmento', 'exemplo.livekit.cloud/#']) {
      expect(() => loadConfig({ ...PRODUCTION_ENV, LIVEKIT_URL: `wss://${suffix}` })).toThrow(/LIVEKIT_URL/);
      expect(() => loadConfig({ ...PRODUCTION_ENV, LIVEKIT_API_URL: `https://${suffix}` })).toThrow(/LIVEKIT_API_URL/);
    }
    expect(() => loadConfig({ ...PRODUCTION_ENV, LIVEKIT_API_URL: 'https://login:senha-na-url@exemplo.livekit.cloud' })).not.toThrow(/senha-na-url/);
  });

  it('em produção recusa as credenciais padrão de desenvolvimento do LiveKit', () => {
    expect(() => loadConfig({ ...PRODUCTION_ENV, LIVEKIT_API_KEY: 'devkey' })).toThrow(/Credenciais de desenvolvimento/);
    expect(() => loadConfig({ ...PRODUCTION_ENV, LIVEKIT_API_SECRET: 'secret' })).toThrow(/Credenciais de desenvolvimento/);
  });

  it('em produção exige APP_SECRET explícito com pelo menos 16 caracteres', () => {
    for (const appSecret of [undefined, '', '   ', 'curto']) {
      expect(() => loadConfig({ ...PRODUCTION_ENV, APP_SECRET: appSecret })).toThrow(/APP_SECRET/);
    }
    expect(loadConfig({ ...PRODUCTION_ENV, APP_SECRET: '0123456789abcdef' }).appSecret).toBe('0123456789abcdef');
  });

  it('autoriza a origem pública do próprio serviço Render junto das origens extras', () => {
    const renderConfig = loadConfig({ ...PRODUCTION_ENV, RENDER_EXTERNAL_URL: 'https://shareroom.onrender.com/caminho' });
    expect(renderConfig.allowedOrigins).toEqual([ORIGIN, 'http://localhost:5173', 'https://shareroom.onrender.com', 'app://shareroom']);
    const onlyRender = loadConfig({ ...PRODUCTION_ENV, ALLOWED_ORIGINS: '', RENDER_EXTERNAL_URL: 'https://shareroom.onrender.com' });
    expect(onlyRender.allowedOrigins).toEqual(['https://shareroom.onrender.com', 'app://shareroom']);
    const deduplicated = loadConfig({ ...PRODUCTION_ENV, ALLOWED_ORIGINS: ORIGIN, RENDER_EXTERNAL_URL: `${ORIGIN}/shareroom` });
    expect(deduplicated.allowedOrigins).toEqual([ORIGIN, 'app://shareroom']);
  });

  it('não autoriza uma URL externa insegura ou local do Render', () => {
    for (const url of ['http://shareroom.onrender.com', 'https://localhost', 'https://10.0.0.1', 'https://[::1]', 'https://login:senha@shareroom.onrender.com', 'https://shareroom.onrender.com/#x']) {
      expect(() => loadConfig({ ...PRODUCTION_ENV, RENDER_EXTERNAL_URL: url })).toThrow(/RENDER_EXTERNAL_URL/);
    }
    expect(loadConfig({ RENDER_EXTERNAL_URL: 'https://localhost' }).allowedOrigins).not.toContain('https://localhost');
  });
});

describe('CORS', () => {
  it('libera só as origens configuradas', async () => {
    const allowed = await app.request('/api/health', { headers: { origin: ORIGIN } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const blocked = await app.request('/api/health', { headers: { origin: 'https://site-malicioso.example' } });
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('responde ao preflight', async () => {
    const response = await app.request('/api/rooms/join', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });
});

describe('criar sala', () => {
  it('devolve convite, chave do dono e dados públicos', async () => {
    const created = await createRoom({ capacity: 6 });
    expect(created.invite.length).toBeGreaterThan(30);
    expect(created.hostKey).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(created.room).toMatchObject({ name: 'Jogatina', capacity: 6, hasPassword: false });
  });

  it('nunca expõe a senha nem a marca dela na resposta', async () => {
    const { json } = await post('/api/rooms', { name: 'Secreta', password: 'hunter2' });
    expect(json.room.hasPassword).toBe(true);
    expect(JSON.stringify(json)).not.toContain('hunter2');
  });

  it('valida lotação e senha', async () => {
    expect((await post('/api/rooms', { capacity: 1 })).status).toBe(400);
    expect((await post('/api/rooms', { capacity: 51 })).status).toBe(400);
    expect((await post('/api/rooms', { capacity: 'dez' })).status).toBe(400);
    expect((await post('/api/rooms', { password: 'x'.repeat(65) })).status).toBe(400);
    expect((await post('/api/rooms', 'não é json')).status).toBe(400);
  });

  it('limita a criação em massa pelo mesmo IP', async () => {
    for (let index = 0; index < 20; index++) expect((await post('/api/rooms', {})).status).toBe(200);
    const blocked = await post('/api/rooms', {});
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('muitas_salas');
  });
});

describe('consultar convite', () => {
  it('mostra os dados públicos da sala', async () => {
    const created = await createRoom({ password: 'abc' });
    const { status, json } = await post('/api/rooms/info', { invite: created.invite });
    expect(status).toBe(200);
    expect(json.room).toEqual(created.room);
  });

  it('devolve 404 para convite inventado', async () => {
    const { status, json } = await post('/api/rooms/info', { invite: 'A'.repeat(48) });
    expect(status).toBe(404);
    expect(json.error.code).toBe('convite_invalido');
  });
});

describe('entrar na sala', () => {
  it('emite token com identidade nova e cria a sala com a lotação certa', async () => {
    const created = await createRoom({ capacity: 4 });
    const { status, json } = await post('/api/rooms/join', { invite: created.invite, name: '  Ana   Clara ' });
    expect(status).toBe(200);
    expect(json.identity).toMatch(/^u-[A-Za-z0-9_-]{12}$/);
    expect(json.isHost).toBe(false);
    expect(json.url).toBe('wss://exemplo.livekit.cloud');
    expect(sfu.tokens[0]).toMatchObject({ name: 'Ana Clara', host: false, ttlSeconds: 600, room: `sr-${created.room.id}` });
    expect(sfu.rooms.get(`sr-${created.room.id}`)?.capacity).toBe(4);
  });

  it('reconhece o dono pela chave', async () => {
    const created = await createRoom();
    const { json } = await post('/api/rooms/join', { invite: created.invite, name: 'Dono', hostKey: created.hostKey });
    expect(json.isHost).toBe(true);
    expect(sfu.tokens[0]?.host).toBe(true);
    const fake = await post('/api/rooms/join', { invite: created.invite, name: 'Esperto', hostKey: 'chave-inventada' });
    expect(fake.json.isHost).toBe(false);
  });

  it('exige nome', async () => {
    const created = await createRoom();
    const { status, json } = await post('/api/rooms/join', { invite: created.invite, name: '   ' });
    expect(status).toBe(400);
    expect(json.error.code).toBe('nome_obrigatorio');
  });

  it('pede senha, recusa a errada e aceita a certa', async () => {
    const created = await createRoom({ password: 'pão de queijo' });
    const base = { invite: created.invite, name: 'Beto' };
    expect((await post('/api/rooms/join', base)).json.error.code).toBe('senha_necessaria');
    expect((await post('/api/rooms/join', { ...base, password: 'errada' })).json.error.code).toBe('senha_incorreta');
    expect((await post('/api/rooms/join', { ...base, password: 'pão de queijo' })).status).toBe(200);
    expect(sfu.tokens).toHaveLength(1);
  });

  it('bloqueia força bruta de senha por IP e libera depois da janela', async () => {
    const created = await createRoom({ password: 'certa' });
    const attempt = (password: string) => post('/api/rooms/join', { invite: created.invite, name: 'X', password });
    for (let index = 0; index < 8; index++) expect((await attempt(`chute-${index}`)).status).toBe(401);
    const blocked = await attempt('certa');
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('muitas_tentativas');
    now += 5 * 60_000 + 1;
    expect((await attempt('certa')).status).toBe(200);
  });

  it('mantém a identidade de quem volta com a prova de sessão, sem pedir senha de novo', async () => {
    const created = await createRoom({ password: 'abc' });
    const first = await post('/api/rooms/join', { invite: created.invite, name: 'Ana', password: 'abc' });
    const again = await post('/api/rooms/join', {
      invite: created.invite,
      name: 'Ana',
      session: { identity: first.json.identity, proof: first.json.proof },
    });
    expect(again.status).toBe(200);
    expect(again.json.identity).toBe(first.json.identity);
  });

  it('ignora prova de sessão forjada (e por isso volta a pedir senha)', async () => {
    const created = await createRoom({ password: 'abc' });
    const forged = await post('/api/rooms/join', {
      invite: created.invite,
      name: 'Ana',
      session: { identity: 'u-identidadeAlheia', proof: 'AAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(forged.status).toBe(401);
  });

  it('responde 502 quando o SFU está fora do ar', async () => {
    const created = await createRoom();
    sfu.failNext = true;
    const { status, json } = await post('/api/rooms/join', { invite: created.invite, name: 'Ana' });
    expect(status).toBe(502);
    expect(json.error.code).toBe('sfu_indisponivel');
  });

  it.each([{ status: 401 }, { status: 403 }, { code: 'unauthenticated' }])(
    'identifica autenticação do SFU recusada sem expor detalhes internos: %j', async (upstream) => {
      const created = await createRoom();
      sfu.snapshot = async () => { throw Object.assign(new Error('detalhe-interno-nao-publico'), upstream); };
      const { status, json } = await post('/api/rooms/join', { invite: created.invite, name: 'Ana' });
      expect(status).toBe(502);
      expect(json.error.code).toBe('sfu_autenticacao_recusada');
      expect(JSON.stringify(json)).not.toContain('detalhe-interno-nao-publico');
    },
  );
});

describe('expulsar', () => {
  it('só o dono expulsa; o expulso não volta com a mesma sessão', async () => {
    const created = await createRoom();
    const guest = await post('/api/rooms/join', { invite: created.invite, name: 'Visitante' });
    const identity = guest.json.identity as string;
    const roomName = `sr-${created.room.id}`;

    const denied = await post('/api/rooms/kick', { invite: created.invite, hostKey: 'errada', identity });
    expect(denied.status).toBe(403);
    expect(sfu.rooms.get(roomName)?.participants.has(identity)).toBe(true);

    const kicked = await post('/api/rooms/kick', { invite: created.invite, hostKey: created.hostKey, identity });
    expect(kicked.status).toBe(200);
    expect(sfu.rooms.get(roomName)?.participants.has(identity)).toBe(false);
    expect(sfu.rooms.get(roomName)?.state.banned).toEqual([identity]);

    const back = await post('/api/rooms/join', {
      invite: created.invite,
      name: 'Visitante',
      session: { identity, proof: guest.json.proof },
    });
    expect(back.status).toBe(403);
    expect(back.json.error.code).toBe('expulso');
  });

  it('valida o formato da identidade', async () => {
    const created = await createRoom();
    const { status } = await post('/api/rooms/kick', { invite: created.invite, hostKey: created.hostKey, identity: '../etc' });
    expect(status).toBe(400);
  });
});

describe('trancar sala', () => {
  it('barra gente nova, mas deixa voltar quem já estava e o dono', async () => {
    const created = await createRoom();
    const insider = await post('/api/rooms/join', { invite: created.invite, name: 'Já estava' });

    expect((await post('/api/rooms/lock', { invite: created.invite, hostKey: 'errada', locked: true })).status).toBe(403);
    expect((await post('/api/rooms/lock', { invite: created.invite, hostKey: created.hostKey, locked: true })).json.locked).toBe(true);

    const newcomer = await post('/api/rooms/join', { invite: created.invite, name: 'Atrasado' });
    expect(newcomer.status).toBe(403);
    expect(newcomer.json.error.code).toBe('sala_trancada');

    const returning = await post('/api/rooms/join', {
      invite: created.invite,
      name: 'Já estava',
      session: { identity: insider.json.identity, proof: insider.json.proof },
    });
    expect(returning.status).toBe(200);
    expect((await post('/api/rooms/join', { invite: created.invite, name: 'Dono', hostKey: created.hostKey })).status).toBe(200);

    await post('/api/rooms/lock', { invite: created.invite, hostKey: created.hostKey, locked: false });
    expect((await post('/api/rooms/join', { invite: created.invite, name: 'Atrasado' })).status).toBe(200);
  });

  it('funciona mesmo antes de alguém entrar', async () => {
    const created = await createRoom();
    const { status } = await post('/api/rooms/lock', { invite: created.invite, hostKey: created.hostKey, locked: true });
    expect(status).toBe(200);
    expect((await post('/api/rooms/join', { invite: created.invite, name: 'Novo' })).status).toBe(403);
  });
});

describe('encerrar sala', () => {
  it('só o dono encerra', async () => {
    const created = await createRoom();
    await post('/api/rooms/join', { invite: created.invite, name: 'Ana' });
    expect((await post('/api/rooms/close', { invite: created.invite, hostKey: 'x' })).status).toBe(403);
    expect((await post('/api/rooms/close', { invite: created.invite, hostKey: created.hostKey })).status).toBe(200);
    expect(sfu.rooms.size).toBe(0);
  });
});

describe('utilitários', () => {
  it('cleanName tira controle, junta espaços e corta por caractere', () => {
    expect(cleanName('  João\u0000\n  Silva  ')).toBe('João Silva');
    expect(cleanName('a‮b')).toBe('a b');
    expect(Array.from(cleanName('🎮'.repeat(50)))).toHaveLength(32);
    expect(cleanName(42)).toBe('');
  });

  it('estado da sala sobrevive a metadados vazios ou corrompidos', () => {
    expect(parseState(undefined)).toEqual({ locked: false, banned: [] });
    expect(parseState('{quebrado')).toEqual({ locked: false, banned: [] });
    expect(parseState(serializeState({ locked: true, banned: ['u-1'] }))).toEqual({ locked: true, banned: ['u-1'] });
    expect(parseState('{"locked":"sim","banned":[1,"u-2"]}')).toEqual({ locked: false, banned: ['u-2'] });
  });

  it('rota desconhecida devolve 404 em JSON', async () => {
    const response = await app.request('/api/nada');
    expect(response.status).toBe(404);
    expect(((await response.json()) as any).error.code).toBe('rota_inexistente');
  });
});
