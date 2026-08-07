import { supabase } from '../supabase.js';
const r = await supabase.from('users').select('password').eq('username', 'Steph').maybeSingle();
console.log(JSON.stringify(r));
