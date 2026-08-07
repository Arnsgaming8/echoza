import pg from 'pg';
const { Pool } = pg;
const PROJECT_REF = 'cekfrmgiecswlioflmip';
const PASSWORD = 'Echoza2024!';
const REGION = 'us-east-1';
const sql = `
-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- PROFILES table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CONVERSATIONS v2
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group BOOLEAN DEFAULT FALSE,
  group_name TEXT DEFAULT '',
  group_avatar TEXT DEFAULT '',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_message TEXT DEFAULT '',
  last_message_sender_id UUID REFERENCES public.profiles(id),
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PARTICIPANTS
CREATE TABLE IF NOT EXISTS public.participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

-- MESSAGES v2
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- READ RECEIPTS
CREATE TABLE IF NOT EXISTS public.read_receipts (
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

-- PUSH SUBSCRIPTIONS (same structure, FK to profiles now)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, endpoint)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_conv_created_at ON public.conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON public.conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_participants_user ON public.participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_conv ON public.participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON public.messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_id ON public.profiles(id);
CREATE INDEX IF NOT EXISTS idx_push_user ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_read_receipts_msg ON public.read_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_read_receipts_user ON public.read_receipts(user_id);

-- ROW LEVEL SECURITY (safety net — server uses service_role key)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role all" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role all" ON public.conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role all" ON public.participants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role all" ON public.messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role all" ON public.read_receipts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role all" ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('profiles', 'conversations', 'participants', 'messages', 'read_receipts', 'push_subscriptions')
ORDER BY table_name;
`;
async function tryConnect(connectionString, label) {
    const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
        const client = await pool.connect();
        console.log(`✅ Connected via ${label}`);
        console.log('Running migration SQL...');
        const result = await client.query(sql);
        console.log('✅ All tables created successfully');
        console.log('\nTables created:');
        result.rows.forEach(r => console.log(`   - ${r.table_name}`));
        client.release();
        await pool.end();
        return true;
    }
    catch (err) {
        console.log(`❌ ${label} failed: ${err.message}`);
        await pool.end().catch(() => { });
        return false;
    }
}
async function main() {
    console.log('=== Echoza Schema v2 Migration ===\n');
    const directUrl = `postgresql:
    if (await tryConnect(directUrl, 'direct connection')) {
        return;
    }
    const sessionPoolerUrl = `postgresql://postgres.${PROJECT_REF}:${PASSWORD}@aws-0-${REGION}.pooler.supabase.com:5432/postgres`;
    if (await tryConnect(sessionPoolerUrl, 'session pooler')) {
        return;
    }
    const txPoolerUrl = `postgresql:
    if (await tryConnect(txPoolerUrl, 'transaction pooler')) {
        return;
    }
    console.log('\n❌ All connection methods failed.');
    process.exit(1);
}
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
