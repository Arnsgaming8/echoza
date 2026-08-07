-- DELETE ALL USERS (profiles + auth.users)
-- WARNING: This removes ALL registered accounts. Users will need to re-register.
-- Paste into Supabase SQL Editor and run.

BEGIN;

-- 1. Delete app-level data (FK-safe order)
DELETE FROM public.read_receipts;
DELETE FROM public.messages;
DELETE FROM public.participants;
DELETE FROM public.push_subscriptions;

-- 2. Clear conversation FK references
UPDATE public.conversations SET created_by = NULL, last_message_sender_id = NULL;

-- 3. Delete conversations and profiles
DELETE FROM public.conversations;
DELETE FROM public.profiles;

-- 4. Delete Supabase Auth users (this is what's keeping the "accounts exist" message)
DELETE FROM auth.users;

COMMIT;

-- Verify
SELECT 'profiles remaining: ' || COUNT(*)::text AS profiles_count FROM public.profiles;
SELECT 'auth users remaining: ' || COUNT(*)::text AS auth_users_count FROM auth.users;
