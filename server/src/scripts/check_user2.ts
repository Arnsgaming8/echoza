import { supabase } from '../supabase.js';
const { data: user, error } = await supabase.from('users').select('id, username').eq('username', 'Arnav_The_Dev').maybeSingle();
console.log('DB user:', JSON.stringify(user));
console.log('DB error:', JSON.stringify(error));
const { data: all } = await supabase.from('users').select('id, username');
console.log('All users:', JSON.stringify(all));
