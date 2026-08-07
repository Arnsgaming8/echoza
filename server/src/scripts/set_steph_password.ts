import { supabase } from '../supabase.js';
import bcrypt from 'bcryptjs';
const username = 'Steph';
const password = 'steph@3467';
const email = `u.${username.toLowerCase()}@echoza.app`;
const { data: users } = await supabase.auth.admin.listUsers();
const authUser = users?.users?.find(u => u.email === email);
if (authUser) {
    await supabase.auth.admin.updateUserById(authUser.id, { password });
    console.log('Auth password updated for', username);
}
const hash = bcrypt.hashSync(password, 10);
await supabase.from('users').update({ password: hash }).eq('username', username);
console.log('DB hash updated for', username);
