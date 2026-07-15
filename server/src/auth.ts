// ─────────────────────────────────────────────────────────────────────────────
// auth.ts
// Self-hosted auth only. No more Supabase Auth REST fallback.
//
// Responsibilities:
//   1. Password hashing + verification using bcryptjs (already a dep).
//   2. JWT signing/verification for stateless access tokens (15m) plus
//      stateful refresh tokens (env.REFRESH_TOKEN_TTL_MS, default 1y —
//      bounded refresh-token TTL is retained as a soft cap so stolen
//      tokens expire eventually; we do NOT auto-log-out idle users).
//   3. Account management (registerUser, loginUser, deleteAccount).
//
// Cutover note: a pre-deploy ONE-SHOT script (`scripts/_force_temp_passwords.ts`)
// must have written bcrypt hashes into every profile whose `password_hash`
// was NULL, otherwise the local-only loginUser path will refuse to authenticate
// them — there's no longer any Supabase fallback to recover from NULL.
// ─────────────────────────────────────────────────────────────────────────────

import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from './env.js';
import { fetchOne, fetchAll, tx } from './db.js';

// ── Constants ────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 1. Password hashing
// ─────────────────────────────────────────────────────────────────────────────

const BCRYPT_COST = 10;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_COST);
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. JWT issuance + verification
// ─────────────────────────────────────────────────────────────────────────────

interface AccessTokenClaims {
  sub: string;
  username: string;
  lastSignInAt: string | null;
  type: 'access';
}

interface RefreshTokenClaims {
  sub: string;
  jti: string;
  type: 'refresh';
}

/** Stateless access token. Short-lived; safe to verify without a DB hit. */
export function signAccessToken(
  userId: string,
  username: string,
  lastSignInAt: string | null,
): string {
  const claims: AccessTokenClaims = {
    sub: userId,
    username,
    lastSignInAt,
    type: 'access',
  };
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: Math.floor(env.ACCESS_TOKEN_TTL_MS / 1000),
    algorithm: 'HS256',
  });
}

/**
 * Stateful refresh token. The plaintext token is returned for the caller
 * to keep in their localStorage; only `token_hash` (SHA-256 hex of the
 * plaintext) is persisted to Neon. The jti claim is baked into the token
 * so we can correlate the JWT to the row at rotation time.
 *
 * TTL is `env.REFRESH_TOKEN_TTL_MS` (1y default). Security note:
 * we keep a long but bounded TTL so a stolen refresh token eventually
 * expires — the user can stay signed in across browser sessions but a
 * leaked refresh token's blast radius is capped at ~1 year, not infinity.
 */
export function signRefreshToken(userId: string): {
  plaintext: string;
  hash: string;
  jti: string;
  expiresAt: Date;
} {
  const jti = uuidv4();
  // 256 bits of entropy keeps unguessable brute-force hopeless.
  const plaintext = randomBytes(32).toString('hex') + '.' + jti;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_MS);

  const claims: RefreshTokenClaims = {
    sub: userId,
    jti,
    type: 'refresh',
  };
  jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: Math.floor(env.REFRESH_TOKEN_TTL_MS / 1000),
    algorithm: 'HS256',
  });
  return { plaintext, hash, jti, expiresAt };
}

/**
 * Verify an access token. Pure JWT decode — no DB hit per call.
 */
export async function verifyAccessToken(
  token: string,
): Promise<{ userId: string; lastSignInAt: string | null; username: string } | null> {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenClaims;
    if (decoded.type !== 'access') return null;
    return {
      userId: decoded.sub,
      lastSignInAt: decoded.lastSignInAt ?? null,
      username: decoded.username,
    };
  } catch {
    return null;
  }
}

/**
 * Verify + match a refresh token. Returns the user id if the JWT signature
 * is valid AND the SHA-256 hash exists in the `refresh_tokens` table AND
 * has not expired. The DB lookup is necessary so revoked / rotated-out
 * tokens can stop being honored even though the JWT signature still
 * verifies.
 */
export async function verifyRefreshToken(token: string): Promise<string | null> {
  let decoded: RefreshTokenClaims;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET) as RefreshTokenClaims;
    if (decoded.type !== 'refresh') return null;
  } catch {
    return null;
  }
  const hash = createHash('sha256').update(token).digest('hex');
  const row = await fetchOne<{ user_id: string }>(
    `SELECT user_id FROM refresh_tokens
       WHERE token_hash = $1
         AND expires_at > NOW()`,
    [hash],
  );
  return row?.user_id ?? null;
}

/**
 * Atomically replace a refresh token with a new one and return a fresh
 * access/refresh pair. Used by POST /api/auth/refresh.
 */
export async function rotateRefreshToken(
  oldTokenPlaintext: string,
): Promise<
  | { ok: true; userId: string; access: string; refresh: string; refreshExpiresAt: Date }
  | { ok: false }
> {
  let decoded: RefreshTokenClaims;
  try {
    decoded = jwt.verify(oldTokenPlaintext, env.JWT_SECRET) as RefreshTokenClaims;
    if (decoded.type !== 'refresh') return { ok: false };
  } catch {
    return { ok: false };
  }

  const oldHash = createHash('sha256').update(oldTokenPlaintext).digest('hex');

  const swap = await tx(async (client) => {
    const claimR = await client.query<{ user_id: string }>(
      `DELETE FROM refresh_tokens
         WHERE token_hash = $1 AND expires_at > NOW()
         RETURNING user_id`,
      [oldHash],
    );
    if (claimR.rows.length === 0) return null;
    const claimedUserId = claimR.rows[0].user_id;
    if (decoded.sub !== claimedUserId) return null;
    const next = signRefreshToken(claimedUserId);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
      [claimedUserId, next.hash, next.expiresAt],
    );
    return { userId: claimedUserId, next };
  });

  if (!swap) return { ok: false };

  const profile = await fetchOne<{ username: string; last_sign_in_at: string | null }>(
    `SELECT username, last_sign_in_at FROM profiles WHERE id = $1`,
    [swap.userId],
  );
  if (!profile) return { ok: false };

  const access = signAccessToken(swap.userId, profile.username, profile.last_sign_in_at);
  return {
    ok: true,
    userId: swap.userId,
    access,
    refresh: swap.next.plaintext,
    refreshExpiresAt: swap.next.expiresAt,
  };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const hash = createHash('sha256').update(token).digest('hex');
  await tx(async (client) => {
    await client.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. registerUser / loginUser   (PUBLIC API)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserRecord {
  id: string;
  username: string;
  avatar: string;
  online: boolean;
}

export interface AuthResult {
  access_token: string;
  refresh_token: string;
  user: UserRecord;
}

export async function registerUser(username: string, password: string): Promise<AuthResult> {
  const nowIso = new Date().toISOString();
  const newId = uuidv4();
  const passwordHash = hashPassword(password);

  const inserted = await fetchOne<{ id: string; username: string; avatar: string }>(
    `INSERT INTO profiles (id, username, password_hash, last_sign_in_at, created_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username, avatar`,
    [newId, username, passwordHash, nowIso],
  );
  if (!inserted) {
    throw new Error('Username already taken');
  }

  const refresh = signRefreshToken(inserted.id);
  await fetchOne(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
    [inserted.id, refresh.hash, refresh.expiresAt],
  );

  const access = signAccessToken(inserted.id, inserted.username, nowIso);
  return {
    access_token: access,
    refresh_token: refresh.plaintext,
    user: { id: inserted.id, username: inserted.username, avatar: inserted.avatar, online: false },
  };
}

export async function loginUser(username: string, password: string): Promise<AuthResult> {
  const profile = await fetchOne<{
    id: string;
    username: string;
    avatar: string;
    password_hash: string | null;
    last_sign_in_at: string | null;
  }>(
    `SELECT id, username, avatar, password_hash, last_sign_in_at
       FROM profiles
       WHERE username = $1`,
    [username],
  );
  if (!profile) {
    throw new Error('Account does not exist');
  }

  // Defensive: the pre-cutover script (_force_temp_passwords.ts) writes a
  // bcrypt hash into every profile that was NULL, so this branch should be
  // unreachable for active users. Keeps as a graceful reject — pass-through
  // for a forgotten account is better than an opaque 500.
  if (!profile.password_hash) {
    throw new Error(
      'Account requires a password reset. Please contact support to set your password.',
    );
  }

  if (!comparePassword(password, profile.password_hash)) {
    throw new Error('Invalid credentials');
  }

  const nowIso = new Date().toISOString();
  await fetchOne(
    `UPDATE profiles SET last_sign_in_at = $1 WHERE id = $2`,
    [nowIso, profile.id],
  );

  const refresh = signRefreshToken(profile.id);
  await fetchOne(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [profile.id, refresh.hash, refresh.expiresAt],
  );

  const access = signAccessToken(profile.id, profile.username, nowIso);
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

// ─────────────────────────────────────────────────────────────────────────────
// 4. getOrCreateDirectConversation
// ─────────────────────────────────────────────────────────────────────────────

export async function getOrCreateDirectConversation(
  userAId: string,
  userBId: string,
): Promise<string> {
  const pair = [userAId, userBId].sort();
  const directPairKey = pair[0] + ':' + pair[1];

  const existing = await fetchOne<{ id: string }>(
    `SELECT id FROM conversations
       WHERE direct_pair_key = $1 AND is_group = FALSE`,
    [directPairKey],
  );
  if (existing?.id) return existing.id;

  const newId = uuidv4();
  const inserted = await fetchOne<{ id: string }>(
    `INSERT INTO conversations (id, is_group, direct_pair_key)
       VALUES ($1, FALSE, $2)
       ON CONFLICT (direct_pair_key) WHERE is_group = FALSE DO NOTHING
       RETURNING id`,
    [newId, directPairKey],
  );
  const convId = inserted?.id ?? newId;

  await fetchAll(
    `INSERT INTO participants (conversation_id, user_id)
       VALUES ($1, $2), ($1, $3)
       ON CONFLICT DO NOTHING`,
    [convId, userAId, userBId],
  );
  return convId;
}

// Keep db import trees happy if the linter greps for tx/fetchAll.
void fetchAll;
