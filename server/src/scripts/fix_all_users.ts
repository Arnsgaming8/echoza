import { supabase } from '../supabase.js';
import bcrypt from 'bcryptjs';
const users = [
    { username: 'Emersyn', password: 'password123' },
    { username: 'Steph', password: 'password123' },
    { username: 'Colin', password: 'password123' },
    { username: 'Scribble', password: 'password123' },
    { username: 'Vanra', password: 'password123' },
    { username: 'Ajuu', password: 'password123' },
    { username: 'Arnav_The_Dev', password: 'admin1234' },
];
for (const { username, password } of users) {
    const email = `u.${username.toLowerCase()}@echoza.app`;
    const hash = bcrypt.hashSync(password, 10);
    const { data: existingUser } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    if (!existingUser) {
        console.log(`Creating DB user: ${username}`);
        const { data: authUsers } = await supabase.auth.admin.listUsers();
        const existingAuth = authUsers?.users?.find(u => u.email === email);
        if (existingAuth) {
            const { data, error } = await supabase.from('users').insert({
                id: existingAuth.id,
                username,
                password: hash,
                avatar: '',
                online: 1,
            });
            if (error)
                console.error(`  Insert DB user ${username} error:`, error.message);
            else
                console.log(`  Created DB row with auth ID ${existingAuth.id}`);
            await supabase.auth.admin.updateUserById(existingAuth.id, { password });
        }
        else {
            const { data: newAuth, error: authErr } = await supabase.auth.admin.createUser({
                email, password, email_confirm: true, user_metadata: { username },
            });
            if (authErr) {
                console.error(`  Create auth ${username} error:`, authErr.message);
                continue;
            }
            const { data, error } = await supabase.from('users').insert({
                id: newAuth.user.id,
                username,
                password: hash,
                avatar: '',
                online: 1,
            });
            if (error)
                console.error(`  Insert DB user ${username} error:`, error.message);
            else
                console.log(`  Created auth+DB for ${username}`);
        }
    }
    else {
        const { data: authUsers } = await supabase.auth.admin.listUsers();
        const existingAuth = authUsers?.users?.find(u => u.email === email);
        if (existingAuth) {
            console.log(`${username}: Auth exists (${existingAuth.id}), updating password and DB hash`);
            await supabase.auth.admin.updateUserById(existingAuth.id, { password });
        }
        else {
            console.log(`${username}: DB exists, creating Auth user`);
            const { data: newAuth, error: authErr } = await supabase.auth.admin.createUser({
                email, password, email_confirm: true, user_metadata: { username },
            });
            if (authErr) {
                console.error(`  Create auth ${username} error:`, authErr.message);
                continue;
            }
            await supabase.from('users').update({ id: newAuth.user.id }).eq('username', username);
        }
    }
}
console.log('\nDone! Passwords:');
console.log('  Emersyn, Steph, Colin, Scribble, Vanra, Ajuu -> password123');
console.log('  Arnav_The_Dev -> admin1234');
