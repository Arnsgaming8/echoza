import { supabase } from '../supabase.js';
const { data } = await supabase.from('users').select('username, password');
for (const u of data || []) {
    const pw = u.password || '';
    const hasHash = pw.startsWith('$2');
    console.log(u.username, hasHash ? 'has bcrypt hash' : 'NO bcrypt hash (len=' + pw.length + ')');
}
