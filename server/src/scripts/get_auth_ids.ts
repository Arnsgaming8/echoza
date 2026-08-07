import { supabase } from '../supabase.js';
const { data } = await supabase.auth.admin.listUsers();
const usernames = ['Colin', 'Vanra', 'Ajuu'];
for (const u of data?.users || []) {
    const username = u.email?.replace(/@.*/, '').replace(/^u\./, '');
    const proper = usernames.find(n => n.toLowerCase() === username);
    if (proper) {
        console.log(proper + ':', u.id);
    }
}
