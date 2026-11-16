import { isIP } from 'node:net';

export interface Config {
  /** Endereço que os navegadores usam para falar com o LiveKit (ws:// ou wss://). */
  livekitUrl: string;
  /** Endereço HTTP(S) da API administrativa do LiveKit, usado só pelo backend. */
  livekitApiUrl: string;
  apiKey: string;
  apiSecret: string;
  appSecret: string;
  allowedOrigins: string[];
  tokenTtlSeconds: number;
  trustProxy: boolean;
}

type Env = Record<string, string | undefined>;

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];

/**
 * Origem da interface dentro do aplicativo de Windows. Nenhum site aberto num navegador comum consegue se
 * apresentar com ela, então é aceita sempre, sem precisar entrar em ALLOWED_ORIGINS.
 */
export const DESKTOP_ORIGIN = 'app://shareroom';

export class ConfigError extends Error {}

function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (host === 'localhost' || /\.(localhost|local|localdomain)$/.test(host)) return false;
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  if (ipVersion === 6) {
    // Só unicast global (2000::/3); exclui loopback, ULA, link-local e IPv4 mapeado.
    return (Number.parseInt(host.split(':')[0]!, 16) & 0xe000) === 0x2000;
  }
  // Esta validação é sintática: não substitui controle de DNS/rede do provedor.
  return host.includes('.') && !host.endsWith('.internal');
}

function publicUrl(value: string, protocol: 'wss:' | 'https:'): URL | null {
  try {
    if (!/^[a-z]+:\/\//i.test(value)) return null;
    const url = new URL(value);
    if (url.protocol !== protocol || url.username || url.password || url.href.includes('#') || !isPublicHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

/** Origem normalizada (esquema + host + porta), ou null se o valor não for uma URL http(s). */
export function normalizeOrigin(value: string): string | null {
  if (value.trim() === DESKTOP_ORIGIN) return DESKTOP_ORIGIN;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function loadConfig(env: Env): Config {
  const production = env.NODE_ENV === 'production';
  const missing: string[] = [];

  const read = (name: string, devDefault: string): string => {
    const value = env[name]?.trim();
    if (value) return value;
    if (production) missing.push(name);
    return devDefault;
  };

  // Padrões do `livekit-server --dev`. Em produção, tudo precisa vir do ambiente.
  const livekitUrl = read('LIVEKIT_URL', 'ws://localhost:7880');
  const apiKey = read('LIVEKIT_API_KEY', 'devkey');
  const apiSecret = read('LIVEKIT_API_SECRET', 'secret');
  if (missing.length > 0) {
    throw new ConfigError(`Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`);
  }
  if (!/^wss?:\/\//.test(livekitUrl)) {
    throw new ConfigError('LIVEKIT_URL deve começar com ws:// ou wss://');
  }
  if (production && !publicUrl(livekitUrl, 'wss:')) {
    throw new ConfigError('LIVEKIT_URL deve ser uma URL wss:// pública válida, sem credenciais nem fragmento, em produção.');
  }
  const livekitApiUrl = env.LIVEKIT_API_URL?.trim() || livekitUrl.replace(/^ws/, 'http');
  if (production && !publicUrl(livekitApiUrl, 'https:')) {
    throw new ConfigError('LIVEKIT_API_URL deve ser uma URL https:// pública válida, sem credenciais nem fragmento, em produção.');
  }
  if (production && (apiKey === 'devkey' || apiSecret === 'secret')) {
    throw new ConfigError('Credenciais de desenvolvimento do LiveKit não são permitidas em produção.');
  }

  const appSecret = env.APP_SECRET?.trim() || `shareroom:${apiSecret}`;
  if (production && (!env.APP_SECRET?.trim() || appSecret.length < 16)) {
    throw new ConfigError('APP_SECRET deve ser definido explicitamente com pelo menos 16 caracteres em produção.');
  }

  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const origin = normalizeOrigin(item);
      if (!origin) throw new ConfigError(`ALLOWED_ORIGINS contém um valor inválido: "${item}"`);
      return origin;
    });
  if (production && env.RENDER_EXTERNAL_URL?.trim()) {
    const external = publicUrl(env.RENDER_EXTERNAL_URL.trim(), 'https:');
    if (!external) throw new ConfigError('RENDER_EXTERNAL_URL deve ser uma URL https:// pública válida, sem credenciais nem fragmento.');
    origins.push(external.origin);
  }

  const ttl = Number(env.TOKEN_TTL_SECONDS ?? 600);
  if (!Number.isFinite(ttl) || ttl < 60 || ttl > 86_400) {
    throw new ConfigError('TOKEN_TTL_SECONDS deve estar entre 60 e 86400.');
  }

  return {
    livekitUrl,
    livekitApiUrl,
    apiKey,
    apiSecret,
    appSecret,
    allowedOrigins: [...new Set([...(origins.length > 0 ? origins : production ? [] : DEV_ORIGINS), DESKTOP_ORIGIN])],
    tokenTtlSeconds: Math.round(ttl),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  };
}
