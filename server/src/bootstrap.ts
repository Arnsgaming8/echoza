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
