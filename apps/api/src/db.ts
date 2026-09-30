import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import type { PGlite } from '@electric-sql/pglite';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  dialect: 'postgres' | 'pglite';
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/schema.sql');

export function createPostgresDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    },
  });
  return {
    dialect: 'postgres',
    ...wrap(pool),
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/** Banco em memória para desenvolvimento e testes. Não use em produção. */
export async function createPgliteDb(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const lite = new PGlite({ extensions: { pgcrypto, citext } });
  const wrap = (client: { query: PGlite['query'] }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await client.query<T>(sql, params);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
    },
  });
  return {
    dialect: 'pglite',
    ...wrap(lite),
    async exec(sql) {
      await lite.exec(sql);
    },
    async tx(fn) {
      return lite.transaction(async (t) => fn(wrap(t as unknown as { query: PGlite['query'] })));
    },
    async close() {
      await lite.close();
    },
  };
}

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

/** Aplica db/schema.sql se o banco estiver vazio e, sempre, as migrações pendentes de db/migrations (em ordem, uma vez cada). */
export async function ensureSchema(db: Db): Promise<void> {
  const exists = await db.query<{ t: string | null }>(`SELECT to_regclass('app.cases') AS t`).catch(() => ({ rows: [{ t: null }] }));
  if (!exists.rows[0]?.t) {
    let sql = await readFile(SCHEMA_PATH, 'utf8');
    if (db.dialect === 'pglite') sql = sql.replaceAll('uuidv7()', 'gen_random_uuid()');
    await db.exec(sql);
  }
  await applyMigrations(db);
}

export async function applyMigrations(db: Db): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS app.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>(`SELECT name FROM app.schema_migrations`)).rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR).catch(() => [] as string[])).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    let sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    if (db.dialect === 'pglite') sql = sql.replaceAll('uuidv7()', 'gen_random_uuid()');
    // Uma transação por migração: ou entra inteira ou não entra.
    await db.exec(`BEGIN;
${sql}
INSERT INTO app.schema_migrations(name) VALUES ('${file.replace(/'/g, "''")}');
COMMIT;`);
    applied.push(file);
  }
  return applied;
}
