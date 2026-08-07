import { supabase } from '../supabase.js';
const fixes = [
    { username: 'Colin', oldId: '179be297-387b-43ed-b063-a3f80ddd1c23', newId: '6891477c-bd0b-4b7e-a493-f5212ccf1a8c' },
    { username: 'Vanra', oldId: '3b5037a8-ca47-4ffb-af33-9983a573ad58', newId: '6a4c8ab1-d380-4ff5-b294-1514da3be9e9' },
    { username: 'Ajuu', oldId: '1965a23d-135d-4efb-b4e4-de0c40579a24', newId: 'f2228cde-03e6-4971-add7-1a906792c2f7' },
];
for (const { username, oldId, newId } of fixes) {
    console.log(`${username}: ${oldId} -> ${newId}`);
    await supabase.from('messages').update({ sender_id: newId }).eq('sender_id', oldId);
    await supabase.from('conversations').update({ user1_id: newId }).eq('user1_id', oldId);
    await supabase.from('conversations').update({ user2_id: newId }).eq('user2_id', oldId);
    await supabase.from('group_members').update({ user_id: newId }).eq('user_id', oldId);
    await supabase.from('push_subscriptions').update({ user_id: newId }).eq('user_id', oldId);
    const { error } = await supabase.from('users').update({ id: newId }).eq('id', oldId);
    if (error)
        console.error(`  Update error:`, error.message);
    else
        console.log(`  OK`);
}
