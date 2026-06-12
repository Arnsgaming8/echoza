import { initDb, query } from '../db.js';

async function main() {
  await initDb();
  const result = await query('SELECT id, username, avatar FROM users');
  const users = (result[0]?.values || []).map((r: any[]) => ({ id: r[0], username: r[1], avatar: r[2] }));
  console.log(JSON.stringify(users, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
