import { timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from './env.js';
import { fetchAll, fetchOne } from './db.js';
import { signAccessToken, signRefreshToken, AuthResult } from './auth.js';

const ADMIN_SECRET = env.ADMIN_SECRET || 'legrand';
export const ADMIN_TOKEN_TTL_SECONDS = 15 * 60;

interface AdminTokenClaims {
  sub: string;
  type: 'admin';
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyAdminSecret(secret: string): boolean {
  return safeEqual(secret, ADMIN_SECRET);
}

export function signAdminToken(): string {
  const claims: AdminTokenClaims = { sub: 'admin', type: 'admin' };
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: ADMIN_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

export function verifyAdminToken(token: string): boolean {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AdminTokenClaims;
    return decoded.type === 'admin';
  } catch {
    return false;
  }
}

export interface AdminAccountRow {
  id: string;
  username: string;
  avatar: string;
  last_sign_in_at: string | null;
  created_at: string | null;
  is_system: boolean;
}

export async function adminSearchAccounts(q: string): Promise<AdminAccountRow[]> {
  const like = '%' + q + '%';
  return fetchAll<AdminAccountRow>(
    `SELECT id, username, avatar, last_sign_in_at, created_at, is_system
       FROM profiles
      WHERE LOWER(username) LIKE LOWER($1)
      ORDER BY is_system DESC, last_sign_in_at DESC NULLS LAST
      LIMIT 30`,
    [like],
  );
}

export async function adminAccessAccount(
  userId: string,
): Promise<AuthResult | null> {
  const profile = await fetchOne<{
    id: string;
    username: string;
    avatar: string;
    last_sign_in_at: string | null;
  }>(
    `SELECT id, username, avatar, last_sign_in_at
       FROM profiles
      WHERE id = $1`,
    [userId],
  );
  if (!profile) return null;

  const refresh = signRefreshToken(profile.id);
  await fetchOne(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
    [profile.id, refresh.hash, refresh.expiresAt],
  );

  const access = signAccessToken(profile.id, profile.username, profile.last_sign_in_at);
  return {
    access_token: access,
    refresh_token: refresh.plaintext,
    user: {
      id: profile.id,
      username: profile.username,
      avatar: profile.avatar,
      online: false,
    },
  };
}
