import { supabase } from '../supabase.js';
const r1 = await supabase.from('users').select('id').limit(1);
console.log('select id limit 1:', r1.error?.message || 'OK (' + r1.data?.length + ' rows)');
const r2 = await supabase.from('users').select('id, username').limit(1);
console.log('select id,username limit 1:', r2.error?.message || 'OK (' + r2.data?.length + ' rows)');
const r3 = await supabase.from('users').select('id, username');
console.log('select id,username:', r3.error?.message || 'OK (' + r3.data?.length + ' rows)');
