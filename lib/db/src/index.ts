import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let _pool: pg.Pool | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
  return url;
}

/**
 * Lazily-created singleton connection pool. Creating it at import time crashed any importer that
 * didn't have DATABASE_URL set (and opened a real connection nothing yet uses), so the URL check and
 * pool creation are deferred to first use.
 */
export function getPool(): pg.Pool {
  return (_pool ??= new Pool({ connectionString: requireDatabaseUrl() }));
}

/** The drizzle client over the lazy pool. */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  return (_db ??= drizzle(getPool(), { schema }));
}

export * from "./schema";
