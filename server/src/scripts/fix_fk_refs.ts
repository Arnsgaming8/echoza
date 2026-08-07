import { supabase } from '../supabase.js';
const oldIds = {
    'Emersyn': 'e6a5a813-f915-4190-82b3-9b8c4dcaaa2c',
    'Colin': '179be297-387b-43ed-b063-a3f80ddd1c23',
    'Scribble': 'c617fe7f-40ca-4131-ae21-89999e00d54f',
    'Vanra': '3b5037a8-ca47-4ffb-af33-9983a573ad58',
    'Ajuu': '1965a23d-135d-4efb-b4e4-de0c40579a24',
};
const { data: currentUsers } = await supabase.from('users').select('id, username');
const currentMap = {};
for (const u of currentUsers || [])
    currentMap[u.username] = u.id;
for (const [username, oldId] of Object.entries(oldIds)) {
    const newId = currentMap[username];
    if (!newId || newId === oldId)
        continue;
    console.log(`${username}: update FK refs ${oldId} -> ${newId}`);
    await supabase.from('messages').update({ sender_id: newId }).eq('sender_id', oldId);
    await supabase.from('conversations').update({ user1_id: newId }).eq('user1_id', oldId);
    await supabase.from('conversations').update({ user2_id: newId }).eq('user2_id', oldId);
    await supabase.from('group_members').update({ user_id: newId }).eq('user_id', oldId);
    await supabase.from('push_subscriptions').update({ user_id: newId }).eq('user_id', oldId);
}
console.log('Done');
