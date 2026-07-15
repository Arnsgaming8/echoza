import pg, { PoolClient, QueryResult, QueryResultRow } from 'pg';

// ── Pool ────────────────────────────────────────────────────────────────────
// Single shared pg.Pool per process. Neon connection strings already
// include `?sslmode=require`, so the driver auto-detects TLS — no explicit
// ssl config needed here. Max 10 concurrent connections per Render dyno.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  // The free tier of Render sends SIGTERM on instance recycle. Releasing
  // idle sockets proactively prevents the "terminating connection due to
  // administrator command" warning that otherwise pollutes the logs.
  idleTimeoutMillis: 30_000,
});

// First-connection probe so server boot fails fast on a misconfigured
// DATABASE_URL rather than at first incoming request.
export async function pingDb(): Promise<void> {
  const { rows } = await pool.query<{ now: string }>('SELECT NOW() AS now');
  if (!rows[0]?.now) throw new Error('Database ping returned no row');
}

// ── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Run a parameterized SQL statement. Returns the full pg result so callers
 * can inspect rowCount, insert ids, etc. when they need to.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/** Convenience: fetch a single row or null. */
export async function fetchOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const { rows } = await pool.query<T>(text, params as unknown[]);
  return rows[0] ?? null;
}

/** Convenience: fetch all rows. */
export async function fetchAll<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await pool.query<T>(text, params as unknown[]);
  return rows;
}

/**
 * Transaction wrapper. Borrows a client from the pool, BEGIN, runs the
 * callback with that client so the caller can issue many statements on the
 * same connection, then COMMIT — or ROLLBACK on thrown error.
 */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* swallow rollback failure so the original error propagates */
    }
    throw err;
  } finally {
    client.release();
  }
}
