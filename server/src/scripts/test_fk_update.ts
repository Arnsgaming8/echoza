import { supabase } from '../supabase.js';
const oldId = '179be297-387b-43ed-b063-a3f80ddd1c23';
const newId = '6891477c-bd0b-4b7e-a493-f5212ccf1a8c';
const { data: before } = await supabase.from('conversations').select('id, user1_id').eq('user1_id', oldId);
console.log('Before:', JSON.stringify(before));
const { data: upd, error: updErr } = await supabase.from('conversations').update({ user1_id: newId }).eq('user1_id', oldId).select();
console.log('Update result:', JSON.stringify({ data: upd, error: updErr?.message }));
const { data: after } = await supabase.from('conversations').select('id, user1_id').eq('user1_id', newId);
console.log('After:', JSON.stringify(after));
