import { supabase } from '../supabase.js';
const email = 'u.arnav_the_dev@echoza.app';
const password = 'admin1234';
const { data: existing } = await supabase.auth.admin.listUsers();
const found = existing?.users?.find(u => u.email === email);
if (found) {
    console.log('Auth user already exists:', found.id);
    const { error } = await supabase.auth.admin.updateUserById(found.id, { password });
    if (error)
        console.error('Reset password error:', error);
    else
        console.log('Password reset OK');
}
else {
    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });
    if (error)
        console.error('Create error:', error);
    else
        console.log('Created auth user:', data.user?.id);
}
import bcrypt from 'bcryptjs';
const hash = bcrypt.hashSync(password, 10);
const { error: updErr } = await supabase.from('users').update({ password: hash }).eq('username', 'Arnav_The_Dev');
console.log('DB update error:', updErr);
