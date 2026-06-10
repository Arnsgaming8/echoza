import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool;

export async function initDb(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const ssl = connectionString?.includes('sslmode')
    ? { rejectUnauthorized: false }
    : false;

  pool = new Pool({ connectionString, ssl });

  await pool.query('SELECT 1');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      online INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (NOW())
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user1_id TEXT NOT NULL,
      user2_id TEXT DEFAULT '',
      is_group INTEGER DEFAULT 0,
      group_name TEXT DEFAULT '',
      group_avatar TEXT DEFAULT '',
      last_message TEXT DEFAULT '',
      last_time TEXT DEFAULT '',
      FOREIGN KEY (user1_id) REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT DEFAULT (NOW()),
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES conversations(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments TEXT DEFAULT '[]',
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (NOW()),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )
  `);

  try {
    await pool.query(`ALTER TABLE messages ADD COLUMN attachments TEXT DEFAULT '[]'`);
  } catch {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT DEFAULT (NOW()),
      PRIMARY KEY (user_id, endpoint),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  console.log('Database connected and schema ready');
}

export function getPool(): pg.Pool {
  return pool;
}

interface SqlJsResult {
  columns: string[];
  values: any[][];
}

let paramIndex = 0;

function toPgSql(sql: string): string {
  paramIndex = 0;
  let result = sql.replace(/\?/g, () => `$${++paramIndex}`);
  result = result.replace(/\bLIKE\b/gi, 'ILIKE');
  return result;
}

export async function query(sql: string, params: any[] = []): Promise<SqlJsResult[]> {
  const hadInsertOrIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);
  let pgSql = toPgSql(sql);

  if (hadInsertOrIgnore) {
    pgSql = pgSql.replace(/INSERT\s+OR\s+IGNORE/i, 'INSERT') + ' ON CONFLICT DO NOTHING';
  }

  const result = await pool.query(pgSql, params);
  return [{
    columns: result.fields.map(f => f.name),
    values: result.rows.map(row => Object.values(row)),
  }];
}

export async function mutate(sql: string, params: any[] = []): Promise<void> {
  const hadInsertOrIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);
  let pgSql = toPgSql(sql);

  if (hadInsertOrIgnore) {
    pgSql = pgSql.replace(/INSERT\s+OR\s+IGNORE/i, 'INSERT') + ' ON CONFLICT DO NOTHING';
  }

  await pool.query(pgSql, params);
}
