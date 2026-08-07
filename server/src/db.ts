import pg, { PoolClient, QueryResult, QueryResultRow } from 'pg';





export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  
  
  
  idleTimeoutMillis: 30_000,
});



export async function pingDb(): Promise<void> {
  const { rows } = await pool.query<{ now: string }>('SELECT NOW() AS now');
  if (!rows[0]?.now) throw new Error('Database ping returned no row');
}



export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}


export async function fetchOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const { rows } = await pool.query<T>(text, params as unknown[]);
  return rows[0] ?? null;
}


export async function fetchAll<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await pool.query<T>(text, params as unknown[]);
  return rows;
}


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
      
    }
    throw err;
  } finally {
    client.release();
  }
}
