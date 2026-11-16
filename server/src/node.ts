import { existsSync, mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.ts';
import { officialBots } from './bots/catalog.ts';
import { BotRuntime } from './bots/runtime.ts';
import { Accounts } from './community/auth.ts';
import { Community } from './community/core.ts';
import { attachGateway } from './community/gateway.ts';
import { Hub } from './community/hub.ts';
import { connectPglite, connectPostgres, type Db } from './db/db.ts';
import { migrate } from './db/schema.ts';
import { ConfigError, loadConfig } from './config.ts';
import { LiveKitSfu } from './sfu.ts';
import { checkSfu, sfuFailureError } from './sfu-errors.ts';

const here = dirname(fileURLToPath(import.meta.url));

// Carrega o .env da raiz do projeto (ou da pasta atual), se existir.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(here, '../../.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`\nConfiguração inválida: ${error.message}\nVeja o arquivo .env.example.\n`);
    process.exit(1);
  }
  throw error;
}

/**
 * Banco de dados das contas e dos grupos. Em produção vem de DATABASE_URL (PostgreSQL). No uso local, sem
 * Postgres instalado, entra o PGlite, que guarda os dados numa pasta do projeto. Sem banco, o servidor sobe
 * do mesmo jeito e só as salas por link funcionam.
 */
async function openDatabase(): Promise<Db | null> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return connectPostgres(url);
  if (process.env.NODE_ENV === 'production') return null;
  try {
    const folder = process.env.PGLITE_DIR?.trim() || resolve(here, '../.data/pglite');
    if (folder === ':memory:') return await connectPglite();
    mkdirSync(folder, { recursive: true });
    return await connectPglite(folder);
  } catch (error) {
    console.warn(`Banco local indisponível (${(error as Error).message}). Contas e grupos ficam desligados.`);
    return null;
  }
}

const sfu = new LiveKitSfu(config);
let groups: { accounts: Accounts; community: Community; bots: BotRuntime } | undefined;
let database: Db | null = null;
try {
  database = await openDatabase();
  if (database) {
    const applied = await migrate(database);
    if (applied.length > 0) console.log(`Banco de dados: migrações aplicadas (${applied.join(', ')}).`);
    const accounts = new Accounts(database);
    const megabytes = (name: string, fallback: number, max: number): number => {
      const value = Number(process.env[name]);
      return (Number.isFinite(value) && value >= 1 ? Math.min(value, max) : fallback) * 1024 * 1024;
    };
    const community = new Community(database, new Hub(), sfu, {
      livekitUrl: config.livekitUrl,
      tokenTtlSeconds: config.tokenTtlSeconds,
      // Os arquivos do chat ficam no banco: os limites protegem o espaço do plano contratado.
      maxFileBytes: megabytes('MAX_FILE_MB', 10, 50),
      groupStorageBytes: megabytes('GROUP_STORAGE_MB', 400, 100_000),
    });
    // Os bots rodam aqui, no backend: seguem funcionando com todo mundo offline.
    const bots = new BotRuntime(database, community, officialBots());
    bots.start();
    groups = { accounts, community, bots };
    setInterval(() => void accounts.purgeExpired().catch(() => undefined), 6 * 60 * 60_000).unref();
    setInterval(() => void community.purgeOrphanFiles().catch(() => undefined), 30 * 60_000).unref();
  }
} catch (error) {
  console.error(`\nNão foi possível abrir o banco de dados: ${(error as Error).message}\n`);
  process.exit(1);
}

const app = createApp({
  config,
  sfu,
  remoteAddress: (c) => getConnInfo(c).remote.address,
  groups,
});

// Auto-hospedagem em um único serviço: se existir um build do frontend, serve junto.
const webRoot = [process.env.WEB_DIST, resolve(process.cwd(), 'web/dist'), resolve(here, '../../web/dist'), resolve(here, '../web')]
  .filter((item): item is string => Boolean(item))
  .find((item) => existsSync(resolve(item, 'index.html')));

if (webRoot && process.env.SERVE_WEB !== '0') {
  app.use(
    '*',
    serveStatic({
      root: webRoot,
      onFound: (path, c) => {
        // Arquivos com hash no nome podem ficar em cache para sempre; o index.html nunca.
        c.header('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
}

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(`ShareRoom API em http://localhost:${info.port}`);
  console.log(`  LiveKit: ${config.livekitUrl}`);
  console.log(`  Origens autorizadas: ${config.allowedOrigins.join(', ') || '(nenhuma — defina ALLOWED_ORIGINS)'}`);
  if (webRoot) console.log(`  Servindo o frontend de ${webRoot}`);
  console.log(
    groups
      ? `  Contas e grupos: ligados (${database?.kind === 'postgres' ? 'PostgreSQL' : 'banco local PGlite'})`
      : '  Contas e grupos: desligados (defina DATABASE_URL para ligar)',
  );
  for (const warning of config.warnings) console.warn(`  ATENÇÃO: ${warning}`);
  // Confere as credenciais já na subida: o motivo de uma recusa aparece no log do deploy, não só quando alguém tenta entrar.
  void checkSfu(sfu).then((failure) => {
    if (!failure) console.log('  LiveKit: credenciais aceitas.');
    else console.error(`  ATENÇÃO: LiveKit ${failure === 'indisponivel' ? 'não respondeu' : 'recusou as credenciais'}. ${sfuFailureError(failure).message}`);
  });
});

if (groups) attachGateway(server as Server, { ...groups, allowedOrigins: config.allowedOrigins });
