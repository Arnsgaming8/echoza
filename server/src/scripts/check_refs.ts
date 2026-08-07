import { supabase } from '../supabase.js';
const oldIds = [
    '179be297-387b-43ed-b063-a3f80ddd1c23',
    '3b5037a8-ca47-4ffb-af33-9983a573ad58',
    '1965a23d-135d-4efb-b4e4-de0c40579a24',
];
for (const oldId of oldIds) {
    console.log(`Checking ${oldId}:`);
    const { data: msgs } = await supabase.from('messages').select('id').eq('sender_id', oldId).limit(3);
    const { data: conv1 } = await supabase.from('conversations').select('id').eq('user1_id', oldId).limit(3);
    const { data: conv2 } = await supabase.from('conversations').select('id').eq('user2_id', oldId).limit(3);
    const { data: gm } = await supabase.from('group_members').select('id').eq('user_id', oldId).limit(3);
    const { data: ps } = await supabase.from('push_subscriptions').select('id').eq('user_id', oldId).limit(3);
    console.log(`  messages: ${msgs?.length || 0}, conversations(u1): ${conv1?.length || 0}, conversations(u2): ${conv2?.length || 0}, group_members: ${gm?.length || 0}, push_subs: ${ps?.length || 0}`);
}
