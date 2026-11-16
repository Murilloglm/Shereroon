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

  const appSecret = env.APP_SECRET?.trim() || `shareroom:${apiSecret}`;
  if (production && appSecret.length < 16) {
    throw new ConfigError('APP_SECRET (ou LIVEKIT_API_SECRET) é curto demais para assinar convites com segurança.');
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

  const ttl = Number(env.TOKEN_TTL_SECONDS ?? 600);
  if (!Number.isFinite(ttl) || ttl < 60 || ttl > 86_400) {
    throw new ConfigError('TOKEN_TTL_SECONDS deve estar entre 60 e 86400.');
  }

  return {
    livekitUrl,
    livekitApiUrl: env.LIVEKIT_API_URL?.trim() || livekitUrl.replace(/^ws/, 'http'),
    apiKey,
    apiSecret,
    appSecret,
    allowedOrigins: [...new Set([...(origins.length > 0 ? origins : production ? [] : DEV_ORIGINS), DESKTOP_ORIGIN])],
    tokenTtlSeconds: Math.round(ttl),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  };
}
