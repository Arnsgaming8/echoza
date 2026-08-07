-- ============================================================
-- DEDUPE DIRECT CONVERSATIONS  (one-time cleanup + prevention)
-- ============================================================
-- Run this in the Supabase SQL Editor.
--
-- Symptom: the same contact appears twice on both ends of a chat
-- because historical duplicates exist between the same pair of
-- users.  The server now picks the OLDEST direct conversation
-- deterministically, so the bug is fixed going forward without
-- any schema change.  This script MERGES any leftover duplicates
-- and adds a schema-level guarantee that NEW duplicates cannot
-- be inserted.
--
-- Idempotent on the cleanup portion (re-runs are safe).
-- ------------------------------------------------------------

BEGIN;

-- ── 1. CLEANUP: merge duplicate direct conversations ─────────
DO $$
DECLARE
  rec   RECORD;
  canon UUID;
  dupd  UUID;
BEGIN
  FOR rec IN (
    WITH pair AS (
      SELECT c.id AS conv_id, c.created_at,
             LEAST(p1.user_id::text, p2.user_id::text)   AS u_lo,
             GREATEST(p1.user_id::text, p2.user_id::text) AS u_hi
      FROM conversations c
      JOIN participants p1 ON p1.conversation_id = c.id
      JOIN participants p2 ON p2.conversation_id = c.id
                          AND p1.user_id < p2.user_id
      WHERE c.is_group = false
    )
    SELECT u_lo, u_hi,
           array_agg(conv_id ORDER BY created_at ASC) AS ids
    FROM pair
    GROUP BY u_lo, u_hi
    HAVING count(*) > 1
  ) LOOP
    canon := rec.ids[1];
    RAISE NOTICE 'Pair % / % has % duplicates; canonical = %, dropping % dupes',
      rec.u_lo, rec.u_hi,
      array_length(rec.ids, 1),
      canon,
      array_length(rec.ids, 1) - 1;

    FOR i IN 2 .. array_length(rec.ids, 1) LOOP
      dupd := rec.ids[i];

      -- 1a. Move messages to canonical.
      UPDATE messages
        SET conversation_id = canon
        WHERE conversation_id = dupd;

      -- 1b. Preserve newer last_read_at across duplicates: take max of
      --     canonical.last_read_at and any duplicate.last_read_at per user.
      UPDATE participants p
      SET last_read_at = GREATEST(p.last_read_at, COALESCE(d.last_read_at, p.last_read_at))
      FROM participants d
      WHERE p.conversation_id = canon
        AND d.conversation_id = dupd
        AND p.user_id = d.user_id;

      -- 1c. Drop the duplicate participants (kept on canonical already).
      DELETE FROM participants WHERE conversation_id = dupd;

      -- 1d. Drop the duplicate conversation row.
      DELETE FROM conversations WHERE id = dupd;
    END LOOP;
  END LOOP;
END $$;

-- ── 2. PREVENTION: column + trigger + unique index ───────────
-- A plain TEXT column (not an inline subquery expression) so the
-- unique index is IMMUTABLE-compliant. Maintained by a trigger
-- on participants so any membership change keeps it in sync.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS direct_pair_key TEXT;

UPDATE public.conversations c
SET direct_pair_key = (
  SELECT LEAST(user_id::text) || ':' || GREATEST(user_id::text)
  FROM public.participants
  WHERE conversation_id = c.id
)
WHERE is_group = false AND direct_pair_key IS NULL;

CREATE OR REPLACE FUNCTION public.sync_direct_pair_key()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_conv UUID;
  v_pair TEXT;
BEGIN
  v_conv := COALESCE(NEW.conversation_id, OLD.conversation_id);

  -- min/max aggregate gives us a single deterministic value per
  -- conversation regardless of how many participant rows the join
  -- produces — no LIMIT 1 ambiguity if ever 3+ participants.
  SELECT LEAST(user_id::text) || ':' || GREATEST(user_id::text)
    INTO v_pair
  FROM public.participants
  WHERE conversation_id = v_conv;

  UPDATE public.conversations c
    SET direct_pair_key = v_pair
    WHERE c.id = v_conv AND c.is_group = false;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_direct_pair_key ON public.participants;
CREATE TRIGGER sync_direct_pair_key
  AFTER INSERT OR UPDATE OR DELETE ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.sync_direct_pair_key();

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_conversation_per_pair
  ON public.conversations(direct_pair_key)
  WHERE is_group = false;

-- ── 3. VERIFY: should be 0 ───────────────────────────────────
DO $$
DECLARE
  dup_count INT := 0;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT direct_pair_key
    FROM public.conversations
    WHERE is_group = false
    GROUP BY direct_pair_key
    HAVING count(*) > 1
  ) t;

  RAISE NOTICE 'Remaining duplicate direct conversations: %', dup_count;
END $$;

COMMIT;
