import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { fetchOne } from './db.js';
import { hashPassword } from './auth.js';

export const SYSTEM_ACCOUNT_USERNAME = 'Echoza Accounts';

export async function bootstrapSchema(): Promise<void> {
  await fetchOne(
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE`,
  );
  await fetchOne(
    `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_inactive_notified_at TIMESTAMPTZ`,
  );

  await fetchOne(
    `CREATE TABLE IF NOT EXISTS device_fingerprints (
       user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
       device_id TEXT NOT NULL,
       user_agent TEXT,
       last_used_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ DEFAULT NOW(),
       PRIMARY KEY (user_id, device_id)
     )`,
  );
  await fetchOne(
    `DELETE FROM device_fingerprints df
       WHERE NOT EXISTS (
         SELECT 1 FROM profiles p WHERE p.id = df.user_id
       )`,
  );
  await fetchOne(
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'device_fingerprints'::regclass AND contype = 'p'
       ) THEN
         ALTER TABLE device_fingerprints ADD PRIMARY KEY (user_id, device_id);
       END IF;
     END $$`,
  );
  await fetchOne(
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conrelid = 'device_fingerprints'::regclass
            AND conname = 'device_fingerprints_user_id_fkey'
       ) THEN
         ALTER TABLE device_fingerprints
           ADD CONSTRAINT device_fingerprints_user_id_fkey
           FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
       END IF;
     END $$`,
  );

  const existing = await fetchOne<{ id: string }>(
    `SELECT id FROM profiles WHERE username = $1`,
    [SYSTEM_ACCOUNT_USERNAME],
  );
  if (!existing) {
    const passwordHash = hashPassword(randomBytes(32).toString('hex'));
    await fetchOne(
      `INSERT INTO profiles (id, username, password_hash, is_system, created_at)
         VALUES ($1, $2, $3, TRUE, NOW())
         ON CONFLICT (username) DO NOTHING`,
      [uuidv4(), SYSTEM_ACCOUNT_USERNAME, passwordHash],
    );
  }
}
