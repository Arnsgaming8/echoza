import pg from 'pg';
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { Pool } = pg;

let pool: pg.Pool;
let sqlDb: any = null;
const DB_PATH = join(__dirname, '..', 'echoza.db');
const USE_PG = !!process.env.DATABASE_URL;

export async function initDb(): Promise<void> {
  if (USE_PG) {
    const connectionString = process.env.DATABASE_URL;
    const ssl = { rejectUnauthorized: false };
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

    console.log('PostgreSQL connected and schema ready');
  } else {
    const SQL = await initSqlJs();
    if (existsSync(DB_PATH)) {
      const buffer = readFileSync(DB_PATH);
      sqlDb = new SQL.Database(buffer);
    } else {
      sqlDb = new SQL.Database();
    }

    sqlDb.run('PRAGMA journal_mode=WAL');
    sqlDb.run('PRAGMA foreign_keys=ON');

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        avatar TEXT DEFAULT '',
        online INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user1_id TEXT NOT NULL,
        user2_id TEXT DEFAULT '',
        is_group INTEGER DEFAULT 0,
        group_name TEXT DEFAULT '',
        group_avatar TEXT DEFAULT '',
        last_message TEXT DEFAULT '',
        last_time TEXT DEFAULT ''
      )
    `);

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        joined_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (group_id, user_id)
      )
    `);

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments TEXT DEFAULT '[]',
        read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    try {
      sqlDb.run(`ALTER TABLE messages ADD COLUMN attachments TEXT DEFAULT '[]'`);
    } catch {}

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, endpoint)
      )
    `);

    saveSqlite();
    console.log('SQLite database ready at:', DB_PATH);
  }
}

function saveSqlite() {
  if (sqlDb) {
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    writeFileSync(DB_PATH, buffer);
  }
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

function execSqliteSelect(sql: string, params: any[]): SqlJsResult[] {
  if (!sqlDb) return [];
  const stmt = sqlDb.prepare(sql);
  stmt.bind(params);
  const columns: string[] = stmt.getColumnNames();
  const values: any[][] = [];
  while (stmt.step()) {
    const row: Record<string, any> = stmt.getAsObject();
    const arr = columns.map(c => row[c]);
    values.push(arr);
  }
  stmt.free();
  return [{ columns, values }];
}

function execSqliteRun(sql: string, params: any[]): void {
  if (!sqlDb) return;
  sqlDb.run(sql, params);
  saveSqlite();
}

export function getPool(): pg.Pool {
  return pool;
}

export async function query(sql: string, params: any[] = []): Promise<SqlJsResult[]> {
  if (USE_PG) {
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
  } else {
    if (/^\s*SELECT/i.test(sql)) {
      return execSqliteSelect(sql, params);
    }
    execSqliteRun(sql, params);
    return [];
  }
}

export async function mutate(sql: string, params: any[] = []): Promise<void> {
  if (USE_PG) {
    const hadInsertOrIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);
    let pgSql = toPgSql(sql);

    if (hadInsertOrIgnore) {
      pgSql = pgSql.replace(/INSERT\s+OR\s+IGNORE/i, 'INSERT') + ' ON CONFLICT DO NOTHING';
    }

    await pool.query(pgSql, params);
  } else {
    execSqliteRun(sql, params);
  }
}
