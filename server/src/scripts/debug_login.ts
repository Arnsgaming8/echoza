import { supabase, anonSupabase } from '../supabase.js';
const username = 'Arnav_The_Dev';
const password = 'admin1234';
const email = 'u.arnav_the_dev@echoza.app';
const { data: dbUser } = await supabase.from('users').select('id, username, password').eq('username', username).maybeSingle();
console.log('DB user:', JSON.stringify({ id: dbUser?.id, pw: dbUser?.password ? 'hashed' : 'empty' }));
const { data: authData, error: authError } = await anonSupabase.auth.signInWithPassword({ email, password });
console.log('Auth sign in:', JSON.stringify({ ok: !authError, error: authError?.message }));
if (authError) {
    const { data: userData } = await supabase.auth.admin.getUserById(dbUser?.id || '');
    console.log('Auth user by DB id:', JSON.stringify({ found: !!userData?.user }));
    const { data: list } = await supabase.auth.admin.listUsers({ perPage: 2000 });
    const match = list?.users?.find(u => u.email === email);
    console.log('Auth user by email:', match ? { id: match.id, email: match.email } : 'NOT FOUND');
    if (match) {
        const { error: verifyError } = await anonSupabase.auth.signInWithPassword({ email, password });
        console.log('Verify with found user:', JSON.stringify({ ok: !verifyError, error: verifyError?.message }));
    }
}
