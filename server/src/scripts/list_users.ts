import { supabase } from '../supabase.js';
const { data } = await supabase.from('users').select('id, username');
console.log(JSON.stringify(data, null, 2));
