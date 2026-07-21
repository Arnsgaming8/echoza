-- =============================================================================
-- Echoza database schema (Neon-native).
-- Replaces server/src/scripts/run-migration-v2.sql. Run this once in the Neon
-- SQL Editor after the project is created.
--
-- What's different from the Supabase-era schema:
--   1. profiles drops the `auth.users(id)` FK — Neon doesn't have an auth schema.
--   2. profiles gains `password_hash` + `last_sign_in_at` columns. After signing
--      in successfully once, the user has a bcrypt hash written here.
--   3. New `refresh_tokens` table for stateful refresh-token validation,
--      rotation, and session revocation (used by server/src/auth.ts).
--   4. RLS + Realtime publication + `secure-rls-and-realtime.sql` go away;
--      Neon is reached directly from our Express server via pg, so per-row
--      gateway policies are the responsibility of our handler code.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Profiles (Echoza users) ─────────────────────────────────────────────────
-- `password_hash` is NULL for users migrated from Supabase Auth — populated
-- the FIRST time they sign in successfully (see server/src/auth.ts loginUser).
-- `last_sign_in_at` is updated on every successful login so the 30-day
-- rolling session policy stays accurate without depending on Auth metadata.
-- `password_changed_at` is updated on password change (including via the
-- forgot-password flow) so we can invalidate pre-reset access JWTs.
-- `reset_nonce` is rotated every time the forgot-password flow issues a
-- challenge token, so a successfully-used (or replayed) challenge can be
-- detected by comparing it against the nonce stored at issue time.
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  display_name TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  last_sign_in_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  reset_nonce TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- In case the table was pre-created without these columns (e.g. partial
-- bootstrap), add them idempotently.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS reset_nonce TEXT;

-- ── Refresh tokens (server-issued, stateful, hash-stored) ──────────────────
-- Plaintext refresh tokens are only ever in transit (memory, JSON over HTTPS)
-- and in the client's localStorage. The DB stores the SHA-256 hash so a DB
-- leak can't disclose live tokens. Rotation creates a NEW row; the OLD row
-- is left intact so we can implement soft-revocation later if needed.
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON public.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_expires ON public.refresh_tokens(expires_at);

-- ── Conversations ──────────────────────────────────────────────────────────
-- `direct_pair_key` is maintained by a trigger (see below) so 1:1 chats
-- between the same pair of users can't collide on a duplicate row. App code
-- can also pre-compute it on insert with ON CONFLICT to skip the trigger.
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group BOOLEAN DEFAULT FALSE,
  group_name TEXT DEFAULT '',
  group_avatar TEXT DEFAULT '',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_message TEXT DEFAULT '',
  last_message_sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ,
  direct_pair_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Participants ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

-- ── Messages ───────────────────────────────────────────────────────────────
-- `attachments` is JSONB so the pg driver maps JS arrays straight through.
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB DEFAULT '[]'::jsonb,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Read receipts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.read_receipts (
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

-- ── Device fingerprints (forgot-password verification) ────────────────────
-- Records the last K device_ids (client-generated UUIDs stored in
-- localStorage) that successfully authenticated for a given user.
-- The forgot-password start endpoint checks whether the current device's
-- id is among these rows before issuing a password-reset challenge token.
-- Server-issued randomBytes IDs would also work; we deliberately let the
-- client generate so the same browser profile keeps the same id across
-- machine reboots even if the server's id namespace is reset on rebuild.
-- `last_used_at` is refreshed on every login; an admin/CLI pruner keeps
-- only the K most-recent rows per user. K is fixed at 2 for now (mirrors
-- the UX requirement "last two devices"). To loosen it later, edit the
-- pruneDeviceFingerprints function call sites in server/src/auth.ts.
CREATE TABLE IF NOT EXISTS public.device_fingerprints (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  user_agent TEXT,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_device_fp_user_time
  ON public.device_fingerprints(user_id, last_used_at DESC);

-- Prune a user's fingerprints down to the K most-recent ones. Called from
-- the application layer (server/src/auth.ts) after every login/register/
-- forgot-password change so the DB stays bounded. Doing this in app code
-- rather than a trigger avoids the deadlock surface that row-by-row
-- triggers create during rapid login bursts.
CREATE OR REPLACE FUNCTION public.prune_device_fingerprints (p_user_id UUID, p_keep INT)
RETURNS VOID
LANGUAGE SQL
AS $$
  DELETE FROM public.device_fingerprints
    WHERE user_id = p_user_id
      AND (user_id, device_id) NOT IN (
        SELECT user_id, device_id FROM public.device_fingerprints
          WHERE user_id = p_user_id
          ORDER BY last_used_at DESC
          LIMIT p_keep
      );
$$;

-- ── Push subscriptions (Web Push) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, endpoint)
);

-- =============================================================================
-- Dedupe trigger for 1:1 conversations.
-- Maintains conversations.direct_pair_key from the participants table so a
-- unique-partial-index can guarantee no duplicate direct chats ever exist
-- between the same pair of users, regardless of which app path created them.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sync_direct_pair_key ()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_conv UUID;
  v_pair TEXT;
BEGIN
  v_conv := COALESCE (NEW.conversation_id, OLD.conversation_id);
  IF v_conv IS NULL THEN
    RETURN NULL;
  END IF;

  IF (SELECT COUNT(*) FROM public.participants WHERE conversation_id = v_conv) = 2 THEN
    SELECT MIN(user_id::text) || ':' || MAX(user_id::text)
      INTO v_pair
      FROM public.participants
      WHERE conversation_id = v_conv;
  ELSE
    v_pair := NULL;
  END IF;

  UPDATE public.conversations c
    SET direct_pair_key = v_pair
    WHERE c.id = v_conv AND c.is_group = FALSE;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_direct_pair_key ON public.participants;
CREATE TRIGGER sync_direct_pair_key
  AFTER INSERT OR UPDATE OR DELETE
  ON public.participants
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_direct_pair_key ();

-- Unique-only-when-direct partial index. Groups are excluded so a user
-- can be in multiple group conversations (only 1:1 has pair uniqueness).
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_conversation_per_pair
  ON public.conversations (direct_pair_key)
  WHERE is_group = FALSE;

-- =============================================================================
-- Indexes (most-queried paths).
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_conv_last_msg        ON public.conversations(last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_conv_is_group        ON public.conversations(is_group);
CREATE INDEX IF NOT EXISTS idx_conv_created_by      ON public.conversations(created_by);
CREATE INDEX IF NOT EXISTS idx_participants_user    ON public.participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_conv    ON public.participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv_time   ON public.messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender      ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_read_receipts_msg    ON public.read_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_read_receipts_user   ON public.read_receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_push_user            ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower ON public.profiles(LOWER(username));

SELECT '✅ Echoza Neon schema applied' AS result;
