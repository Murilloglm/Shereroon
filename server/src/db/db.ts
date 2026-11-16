/**
 * Acesso ao banco. Em produção é PostgreSQL (DATABASE_URL). Nos testes e no uso local sem Postgres
 * instalado é o PGlite: o próprio PostgreSQL compilado para rodar dentro do Node, então o SQL é o mesmo.
 */

export type Row = Record<string, unknown>;

export interface Db {
  readonly kind: 'postgres' | 'pglite';
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Vários comandos de uma vez, sem parâmetros (usado pelas migrações). */
  exec(sql: string): Promise<void>;
  /** Tudo dentro de `run` acontece numa transação: ou vale inteiro, ou nada vale. */
  tx<T>(run: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Dentro de uma transação, `tx` aninhado só continua na mesma. */
function inTransaction(kind: Db['kind'], handle: Queryable, exec: (sql: string) => Promise<void>): Db {
  const db: Db = {
    kind,
    query: async <T extends Row>(text: string, params: readonly unknown[] = []) => (await handle.query(text, [...params])).rows as T[],
    exec,
    tx: (run) => run(db),
    close: async () => undefined,
  };
  return db;
}

export async function connectPostgres(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  // Uma conexão ociosa que cai não pode derrubar o processo.
  pool.on('error', (error) => console.error('[db]', error.message));
  await pool.query('SELECT 1');
  return {
    kind: 'postgres',
    query: async <T extends Row>(text: string, params: readonly unknown[] = []) => (await pool.query(text, [...params])).rows as T[],
    exec: async (sql) => void (await pool.query(sql)),
    async tx(run) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await run(inTransaction('postgres', client, async (sql) => void (await client.query(sql))));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** `dataDir` vazio = banco só na memória (testes). Com pasta, os dados ficam guardados entre execuções. */
export async function connectPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  return {
    kind: 'pglite',
    query: async <T extends Row>(text: string, params: readonly unknown[] = []) => (await lite.query(text, [...params])).rows as T[],
    exec: async (sql) => void (await lite.exec(sql)),
    tx: (run) =>
      lite.transaction((tx) =>
        run(
          inTransaction(
            'pglite',
            tx,
            async (sql) => void (await tx.exec(sql)),
          ),
        ),
      ) as Promise<never>,
    close: () => lite.close(),
  };
}

/** Inteiros grandes (BIGINT) chegam como texto num driver e como bigint no outro. */
export const big = (value: unknown): bigint => (typeof value === 'bigint' ? value : BigInt(String(value ?? '0')));
export const num = (value: unknown): number => Number(value ?? 0);
export const iso = (value: unknown): string => (value instanceof Date ? value : new Date(String(value))).toISOString();
export const isoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : iso(value));
