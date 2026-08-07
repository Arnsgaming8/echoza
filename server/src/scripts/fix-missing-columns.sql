-- Run this once in Supabase SQL Editor to add missing columns.
-- These columns exist in migration.sql but were never added to the live DB
-- because CREATE TABLE IF NOT EXISTS skips existing tables.

ALTER TABLE public.conversations 
  ADD COLUMN IF NOT EXISTS group_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_avatar TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_message TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_time TIMESTAMPTZ DEFAULT NULL;
