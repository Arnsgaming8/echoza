import { supabase } from '../supabase.js';
const email = 'u.arnav_the_dev@echoza.app';
const password = 'admin1234';
const { data: users } = await supabase.auth.admin.listUsers();
const found = users?.users?.find(u => u.email === email);
if (found) {
    console.log('Deleting existing auth user:', found.id);
    const { error: delErr } = await supabase.auth.admin.deleteUser(found.id);
    if (delErr)
        console.error('Delete error:', delErr);
    else
        console.log('Deleted OK');
}
const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
});
console.log('Create result:', JSON.stringify({ error: error?.message, id: data?.user?.id }));
