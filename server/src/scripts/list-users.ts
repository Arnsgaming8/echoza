import { supabase } from '../supabase.js';

async function main() {
  const { data: users } = await supabase.from('users').select('id, username, avatar');
  console.log(JSON.stringify(users || [], null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
