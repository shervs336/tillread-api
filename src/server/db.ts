import { SCHEMA_SQL } from "./schema-sql";

/**
 * A minimal SQL interface over two drivers:
 * - postgres.js against Supabase (or any Postgres) when DATABASE_URL is set,
 * - PGlite (Postgres compiled to WebAssembly, in memory) for local development and tests.
 * Both run the same SQL, so tests exercise the real queries, upserts and constraints.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createPostgres(url: string, max = 5): Promise<Db> {
  const { default: postgres } = await import("postgres");
  // prepare: false for Supabase's transaction pooler (pgbouncer).
  const sql = postgres(url, { prepare: false, max, idle_timeout: 20, connect_timeout: 10 });
  type Runner = { unsafe: (text: string, params?: never[]) => Promise<unknown> };
  const wrap = (s: Runner): Db => ({
    query: async (text, params = []) => (await s.unsafe(text, params as never[])) as never,
    tx: (fn) => sql.begin((t) => fn(wrap(t as unknown as Runner))) as never,
    close: () => sql.end(),
  });
  return wrap(sql);
}

export async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  await pg.exec(SCHEMA_SQL);
  type Q = Pick<typeof pg, "query">;
  const wrap = (q: Q, root: boolean): Db => ({
    query: async (text, params = []) => (await q.query(text, params)).rows as never,
    tx: (fn) => (root ? pg.transaction((t) => fn(wrap(t, false))) : fn(wrap(q, false))),
    close: () => pg.close(),
  });
  return wrap(pg, true);
}

let shared: Promise<Db> | undefined;

/** The app's database: Postgres in production, an in-memory PGlite in development. */
export function getDb(): Promise<Db> {
  shared ??= process.env.DATABASE_URL
    ? createPostgres(process.env.DATABASE_URL)
    : process.env.NODE_ENV === "production" && !process.env.ALLOW_MEMORY_DB
      ? Promise.reject(new Error("DATABASE_URL is not set"))
      : createPglite();
  return shared;
}
