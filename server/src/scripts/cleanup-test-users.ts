import { initDb, query, mutate } from '../db.js';

async function main() {
  await initDb();

  const testPatterns = ['test', 'asd', 'qwe', 'abc', 'demo', 'admin', 'user'];

  const allUsers = await query('SELECT id, username FROM users');
  const users = (allUsers[0]?.values || []).map((r: any[]) => ({ id: r[0], username: r[1] }));

  const toDelete = users.filter(u => {
    const name = u.username.toLowerCase();
    return testPatterns.some(p => name.includes(p)) || name.length <= 3;
  });

  if (toDelete.length === 0) {
    console.log('No test accounts found.');
    process.exit(0);
  }

  console.log(`Found ${toDelete.length} test account(s):`);
  toDelete.forEach(u => console.log(`  - ${u.username} (${u.id})`));

  for (const u of toDelete) {
    await mutate(`DELETE FROM messages WHERE sender_id = ?`, [u.id]);
    await mutate(`DELETE FROM group_members WHERE user_id = ?`, [u.id]);
    const convs = await query(`SELECT id FROM conversations WHERE user1_id = ?`, [u.id]);
    for (const row of (convs[0]?.values || [])) {
      const convId = row[0] as string;
      await mutate(`DELETE FROM group_members WHERE group_id = ?`, [convId]);
      await mutate(`DELETE FROM messages WHERE conversation_id = ?`, [convId]);
      await mutate(`DELETE FROM conversations WHERE id = ?`, [convId]);
    }
    await mutate(`DELETE FROM push_subscriptions WHERE user_id = ?`, [u.id]);
    await mutate(`DELETE FROM users WHERE id = ?`, [u.id]);
    console.log(`  Deleted ${u.username}`);
  }

  console.log('Cleanup complete.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
