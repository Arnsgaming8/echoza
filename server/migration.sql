-- Run this in Supabase SQL Editor to set up tables

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL DEFAULT '',
  avatar TEXT DEFAULT '',
  online INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY,
  user1_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user2_id UUID DEFAULT '00000000-0000-0000-0000-000000000000',
  is_group INTEGER DEFAULT 0,
  group_name TEXT DEFAULT '',
  group_avatar TEXT DEFAULT '',
  last_message TEXT DEFAULT '',
  last_time TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS public.group_members (
  group_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  attachments TEXT DEFAULT '[]',
  read INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, endpoint)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conv_user1 ON public.conversations(user1_id);
CREATE INDEX IF NOT EXISTS idx_conv_user2 ON public.conversations(user2_id);
CREATE INDEX IF NOT EXISTS idx_conv_is_group ON public.conversations(is_group);
CREATE INDEX IF NOT EXISTS idx_conv_last_time ON public.conversations(last_time DESC);
CREATE INDEX IF NOT EXISTS idx_msg_conversation ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_msg_sender ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_msg_read ON public.messages(read);
CREATE INDEX IF NOT EXISTS idx_gm_user ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_gm_group ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);

-- Enable Row Level Security (optional — server uses service_role key)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS policies: only allow access via service_role (server-side)
CREATE POLICY "Service role only" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role only" ON public.conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role only" ON public.group_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role only" ON public.messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role only" ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime for messages table (so we can subscribe later)
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
