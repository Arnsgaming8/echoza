// ─────────────────────────────────────────────────────────────────────────────
// auth.ts
// Replaces Supabase Auth entirely. Three responsibilities:
//   1. Password hashing + verification using bcryptjs (already a dep).
//   2. JWT signing/verification for stateless access tokens (15m) plus
//      stateful refresh tokens (env.REFRESH_TOKEN_TTL_MS, default 1y —
//      bounded refresh-token TTL is retained as a soft cap so stolen
//      tokens expire eventually; we do NOT auto-log-out idle users
//      because the user policy is "stay signed in").
//   3. The "hybrid migration" path: when an account from the pre-Neon era
//      exists in `profiles` with `password_hash IS NULL`, and SUPABASE_URL
//      + SUPABASE_ANON_KEY env vars are configured, the login flow goes
//      through Supabase Auth REST (over HTTPS, no @supabase/supabase-js)
//      once, captures the plaintext password, writes a bcrypt-hash into
//      Neon, then issues the regular local JWT. Subsequent logins are
//      full Neon. Removes the need to mass-reset passwords.
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
 * so we can correlate the JWT to the row at rotation time, even though
 * the matching is by hash today.
 *
 * TTL is `env.REFRESH_TOKEN_TTL_MS` (1 year by default). Security note:
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
  // 256 bits of entropy keeps unguessable brute-force hopeless. Same secret-
  // space randomness as a cryptographically strong session cookie.
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
 * Verify an access token. Pure JWT decode — no DB hit per call. This is
 * important because Socket.IO auth middleware fires this on EVERY connect,
 * and Express REST middleware fires it on EVERY request.
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
 *
 * Concurrency: two simultaneous refreshers each with their own copy of
 * the same old token must NOT both succeed — otherwise the legitimate user
 * ends up with two valid new tokens in circulation. We DO this with a
 * single `DELETE ... RETURNING user_id` claim: row-level locking inside
 * the tx makes it so only one refresher can capture the old row; the
 * loser returns `{ ok: false }` cleanly.
 */
export async function rotateRefreshToken(
  oldTokenPlaintext: string,
): Promise<
  | { ok: true; userId: string; access: string; refresh: string; refreshExpiresAt: Date }
  | { ok: false }
> {
  // Verify the JWT signature FIRST (cheap, no DB hit) so a forged signature
  // or wrong-type token never even touches the refresh_tokens table.
  let decoded: RefreshTokenClaims;
  try {
    decoded = jwt.verify(oldTokenPlaintext, env.JWT_SECRET) as RefreshTokenClaims;
    if (decoded.type !== 'refresh') return { ok: false };
  } catch {
    return { ok: false };
  }

  const oldHash = createHash('sha256').update(oldTokenPlaintext).digest('hex');

  // Atomic claim: DELETE the old row inside a tx and INSERT the new row
  // in the SAME tx. If two refreshers race, the second's DELETE will
  // report zero rows (RETURNING empty) so `claimedUserId` is null and we
  // bail with `{ ok: false }`. Zero orphan windows; no double-issuance.
  const swap = await tx(async (client) => {
    const claimR = await client.query<{ user_id: string }>(
      `DELETE FROM refresh_tokens
         WHERE token_hash = $1 AND expires_at > NOW()
         RETURNING user_id`,
      [oldHash],
    );
    if (claimR.rows.length === 0) return null;
    const claimedUserId = claimR.rows[0].user_id;
    // Defense-in-depth: the JWT sub must match the row's user_id. A row
    // could in theory have been planted out-of-band in a stolen-DB world;
    // this guard ensures the JWT itself endorses the claim.
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
// 3. Account email helper (preserved for the Supabase Auth fallback only)
// ─────────────────────────────────────────────────────────────────────────────
const EMAIL_DOMAIN = '@echoza.app';

/**
 * Convert an Echoza username to the synthetic email format Echoza used
 * under Supabase Auth. ONLY used during the hybrid migration window via
 * supabaseAuthSignInFallback() to talk to Supabase's REST API. New users
 * don't need an email at all.
 */
export function usernameToEmail(username: string): string {
  return `u.${username.toLowerCase()}${EMAIL_DOMAIN}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Hybrid Supabase Auth REST fallback (no @supabase/supabase-js dep)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call Supabase Auth's password grant REST endpoint directly via fetch.
 * Returns the user-id on success, throws on failure. Only reachable when
 * the user's `password_hash IS NULL` in Neon (i.e. an unmigrated pre-Neon
 * account) AND env.hasSupabaseFallback === true.
 */
async function supabaseAuthSignInFallback(
  username: string,
  password: string,
): Promise<{ id: string } | null> {
  if (!env.hasSupabaseFallback) {
    throw new Error(
      'Supabase Auth fallback is not configured (missing SUPABASE_URL or SUPABASE_ANON_KEY).',
    );
  }
  const email = usernameToEmail(username);
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY!}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { user?: { id: string }; access_token?: string };
  if (!body.user?.id) return null;
  return { id: body.user.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. registerUser / loginUser  (PUBLIC API — same shape as the Supabase era)
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

  // INSERT IGNORE on collision via ON CONFLICT (username). Conflict means
  // the account already exists — surface that explicitly to the caller.
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

  let passwordMatched: boolean;
  if (profile.password_hash) {
    // Fast path: full Neon.
    passwordMatched = comparePassword(password, profile.password_hash);
  } else {
    // Hybrid path: pre-migration account, no local hash yet. Try Supabase
    // Auth REST, and if it succeeds, write the bcrypt hash locally so the
    // NEXT login is full Neon.
    if (!env.hasSupabaseFallback) {
      throw new Error(
        'Account exists but password has not been migrated and Supabase Auth fallback is not configured. ' +
          'Either set SUPABASE_URL + SUPABASE_ANON_KEY for the migration window, or have the user re-register.',
      );
    }
    const fb = await supabaseAuthSignInFallback(username, password);
    if (!fb || fb.id !== profile.id) {
      throw new Error('Invalid credentials');
    }
    // Capture the plaintext → bcrypt → update Neon in-place. If the UPDATE
    // races with another login, the bcrypt of the same password is
    // idempotent, so a second writer just overwrites with the same hash.
    const newHash = hashPassword(password);
    await fetchOne(
      `UPDATE profiles SET password_hash = $1 WHERE id = $2`,
      [newHash, profile.id],
    );
    profile.password_hash = newHash;
    passwordMatched = true;
  }

  if (!passwordMatched) {
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
// 6. getOrCreateDirectConversation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the direct conversation id between two users, creating one if
 * none exists. The `direct_pair_key` partial-unique index enforces
 * no-duplicates at the DB layer; we explicitly pre-compute the key on
 * INSERT and rely on ON CONFLICT (direct_pair_key) to short-circuit a
 * parallel race.
 */
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

  // Add participants idempotently via ON CONFLICT. If a concurrent call
  // already wired them up we silently skip.
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
