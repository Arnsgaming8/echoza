-- ============================================================
-- SECURE RLS + ENABLE TABLE-LEVEL REALTIME  (run in Supabase SQL Editor)
-- ============================================================
-- Run this ONCE in the Supabase SQL Editor for your project, after our
-- Supabase-Auth integration is fully wired (Echoza now uses Supabase Auth
-- and calls supabase.auth.setSession(...) on the client so auth.uid() is
-- populated during realtime subscriptions).
--
-- Why this exists:
--   - The original schema enabled RLS with `USING (true) WITH CHECK (true)`
--     policies on every chat table. Combined with the anon-key supabase
--     client used by the frontend, that would mean ANY user on the public
--     internet could subscribe to `postgres_changes` on `messages` and
--     stream every chat world-wide.
--   - This script replaces those permissive policies with strict per-user
--     policies keyed on `auth.uid()` and a SECURITY DEFINER helper
--     `public.is_participant(...)`.
--   - It also adds `conversations`, `participants`, and `read_receipts`
--     to the `supabase_realtime` publication so client-side Realtime
--     subscriptions fire for them (messages was already added by the
--     original migration).
--
-- Idempotent: every DROP/ADD uses IF EXISTS / OR REPLACE.
-- Safe to re-run: existing tables, functions, and publication stay intact.
-- ----------------------------------------------------------------

BEGIN;

-- ── 1. Drop the loose policies that allowed the anon firehose ──
DROP POLICY IF EXISTS "Service role only" ON public.messages;
DROP POLICY IF EXISTS "Service role only" ON public.conversations;
DROP POLICY IF EXISTS "Service role only" ON public.participants;
DROP POLICY IF EXISTS "Service role only" ON public.read_receipts;

-- ── 2. Helper function: is this user a participant in this conversation? ──
-- Marked SECURITY DEFINER so it can read `participants` even when called
-- from a context where RLS would block direct SELECT. `SET search_path`
-- prevents search-path injection attacks.
CREATE OR REPLACE FUNCTION public.is_participant(_user_id uuid, _conversation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.participants
    WHERE user_id = _user_id
      AND conversation_id = _conversation_id
  );
$$;

-- ── 3. messages: read + insert only into conversations you are in ──
DROP POLICY IF EXISTS "messages_select"   ON public.messages;
DROP POLICY IF EXISTS "messages_insert"   ON public.messages;
DROP POLICY IF EXISTS "messages_update"   ON public.messages;
DROP POLICY IF EXISTS "messages_delete"   ON public.messages;

CREATE POLICY "messages_select" ON public.messages
  FOR SELECT TO authenticated
  USING (public.is_participant(auth.uid(), conversation_id));

-- Writes still go through our Socket.IO / Express server (which uses the
-- service_role key and bypasses RLS entirely), but we add these so a
-- compromised client token can still only write into conversations
-- they're legitimately in.
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (public.is_participant(auth.uid(), conversation_id));

-- ── 4. conversations: read only rows you participate in ──
DROP POLICY IF EXISTS "conversations_select" ON public.conversations;
CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_participant(auth.uid(), id));

-- ── 5. participants: read your own row + rows in convs you are in ──
DROP POLICY IF EXISTS "participants_select" ON public.participants;
CREATE POLICY "participants_select" ON public.participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_participant(auth.uid(), conversation_id)
  );

-- ── 6. read_receipts: read receipts for messages in convs you are in ──
DROP POLICY IF EXISTS "read_receipts_select" ON public.read_receipts;
CREATE POLICY "read_receipts_select" ON public.read_receipts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.id = read_receipts.message_id
        AND public.is_participant(auth.uid(), m.conversation_id)
    )
  );

-- ── 7. Enable table-level Realtime on the chat tables ──
-- `messages` was already added by the original migration. The
-- ALTER PUBLICATION statements below are no-ops for already-present tables.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'read_receipts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.read_receipts;
  END IF;
END $$;

-- ── 8. Verify ──
SELECT
  'RLS enabled on: ' || string_agg(tablename, ', ' ORDER BY tablename) AS enabled_tables
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('messages', 'conversations', 'participants', 'read_receipts')
  AND rowsecurity = true;

SELECT
  'Realtime publication tables: ' || string_agg(tablename, ', ' ORDER BY tablename) AS pub_tables
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('messages', 'conversations', 'participants', 'read_receipts');

COMMIT;
