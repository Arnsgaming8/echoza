import { supabase } from '../supabase.js';
console.log('Script starting...');
const { data, error } = await supabase.from('users').select('id, username').eq('username', 'Arnav_The_Dev');
console.log('Found:', JSON.stringify({ data, error }));
