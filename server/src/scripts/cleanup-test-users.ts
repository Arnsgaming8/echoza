import { supabase } from '../supabase.js';

async function main() {
  const testPatterns = ['test', 'asd', 'qwe', 'abc', 'demo', 'admin', 'user'];

  const { data: allUsers } = await supabase.from('users').select('id, username');
  const users = (allUsers || []).map(u => ({ id: u.id, username: u.username }));

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
    await supabase.from('messages').delete().eq('sender_id', u.id);
    await supabase.from('group_members').delete().eq('user_id', u.id);
    const { data: convs } = await supabase.from('conversations').select('id').eq('user1_id', u.id);
    for (const conv of (convs || [])) {
      await supabase.from('group_members').delete().eq('group_id', conv.id);
      await supabase.from('messages').delete().eq('conversation_id', conv.id);
      await supabase.from('conversations').delete().eq('id', conv.id);
    }
    await supabase.from('push_subscriptions').delete().eq('user_id', u.id);
    await supabase.from('users').delete().eq('id', u.id);
    console.log(`  Deleted ${u.username}`);
  }

  console.log('Cleanup complete.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
