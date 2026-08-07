import { supabase } from '../supabase.js';
const email = 'u.steph@echoza.app';
const password = 'steph@3467';
const { data: dbUser } = await supabase.from('users').select('*').eq('username', 'Steph').single();
if (!dbUser) {
    console.log('DB user not found');
    process.exit(1);
}
console.log('DB user:', dbUser.id);
const { data: users } = await supabase.auth.admin.listUsers();
const oldAuth = users?.users?.find(u => u.email === email);
if (oldAuth) {
    console.log('Deleting old auth:', oldAuth.id);
    await supabase.auth.admin.deleteUser(oldAuth.id);
}
const { data: newAuth, error: cErr } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: 'Steph' },
});
if (cErr) {
    console.log('Create error:', cErr.message);
    process.exit(1);
}
console.log('New auth:', newAuth.user.id);
await supabase.from('users').update({ id: newAuth.user.id }).eq('id', dbUser.id);
const oldId = dbUser.id;
const newId = newAuth.user.id;
await supabase.from('messages').update({ sender_id: newId }).eq('sender_id', oldId);
await supabase.from('conversations').update({ user1_id: newId }).eq('user1_id', oldId);
await supabase.from('conversations').update({ user2_id: newId }).eq('user2_id', oldId);
await supabase.from('group_members').update({ user_id: newId }).eq('user_id', oldId);
await supabase.from('push_subscriptions').update({ user_id: newId }).eq('user_id', oldId);
console.log('Done');
