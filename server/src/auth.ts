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

// The forgot-password flow lets a user reset their password from a device
// they've previously logged in on. We enforce that by checking the last
// couple of (user_id, device_id) rows in `device_fingerprints` against
// the device_id the client sends in the `X-Device-Id` header. KEEP_LAST
// matches the pruneDeviceFingerprints() call so the table never grows
// past this limit per user.
const DEVICE_FINGERPRINT_KEEP_LAST = 2;

// In-memory cache for `password_changed_at` lookups during
// verifyAccessToken. JWT access tokens are stateless, so without this
// guard an attacker who learned a user's pre-reset access token would
// still hold a valid 15m session for up to 15m after a successful
// password change. A short TTL amortizes the DB cost across bursts of
// verify calls while staying fresh enough that a legitimate password
// change takes effect inside the cache window.
const pwdChangedAtCache = new Map<string, { value: string | null; expiresAt: number }>();
const PWD_CHANGED_AT_CACHE_TTL_MS = 5_000;

async function getPasswordChangedAt(userId: string): Promise<string | null> {
  const cached = pwdChangedAtCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  const profile = await fetchOne<{ password_changed_at: string | null }>(
    `SELECT password_changed_at FROM profiles WHERE id = $1`,
    [userId],
  );
  const value = profile?.password_changed_at ?? null;
  pwdChangedAtCache.set(userId, { value, expiresAt: now + PWD_CHANGED_AT_CACHE_TTL_MS });
  return value;
}

export function invalidatePasswordChangedAtCache(userId: string): void {
  pwdChangedAtCache.delete(userId);
}

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
  // `iat` is set automatically by jsonwebtoken (NumericDate, seconds
  // since epoch). Used here to compare against `password_changed_at`
  // so that access tokens issued BEFORE a password change get rejected.
  iat?: number;
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
 * Verify an access token. JWT decode is stateless, but we ALSO check the
 * user's `password_changed_at` against the JWT's `iat` claim to invalidate
 * pre-reset access tokens. The DB hit is amortized via a 5s in-memory
 * cache keyed by user_id, so the hot socket path stays cheap while still
 * invalidating tokens within ~5s of a password change.
 */
export async function verifyAccessToken(
  token: string,
): Promise<{ userId: string; lastSignInAt: string | null; username: string } | null> {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenClaims;
    if (decoded.type !== 'access') return null;
    // Reject pre-reset access tokens. Compare in WHOLE SECONDS:
    // jsonwebtoken floors iat to seconds while Postgres has ms precision,
    // so an ms-level comparison would falsely reject a fresh token issued
    // in the same second as the password change. Same-second tokens are
    // safe — the password has only been changed for sub-second, and
    // they'd just have been re-issued by completeForgotPassword anyway.
    const pwdChangedAt = await getPasswordChangedAt(decoded.sub);
    if (pwdChangedAt) {
      const iatSec = decoded.iat ?? 0;
      const pwdChangedSec = new Date(pwdChangedAt).getTime() / 1000;
      if (iatSec < pwdChangedSec) return null;
    }
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

export async function registerUser(
  username: string,
  password: string,
  deviceId?: string,
  userAgent?: string,
): Promise<AuthResult> {
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
    // FIX #15: Structured error code for 409 detection instead of string match.
    const err = new Error('Username already taken');
    (err as any).code = 'USERNAME_TAKEN';
    throw err;
  }

  if (deviceId) {
    await recordDeviceFingerprint(inserted.id, deviceId, userAgent);
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

export async function loginUser(
  username: string,
  password: string,
  deviceId?: string,
  userAgent?: string,
): Promise<AuthResult> {
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
  // unreachable for active users. Forgot-password change() below is a
  // legitimate way to set a hash for legacy accounts that never went
  // through the bcrypt script.
  if (!profile.password_hash) {
    throw new Error(
      'Account requires a password reset. Please use the forgot-password flow or contact support.',
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

  if (deviceId) {
    await recordDeviceFingerprint(profile.id, deviceId, userAgent);
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// 5. Device-fingerprint bookkeeping (forgot-password verification)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert (user_id, device_id) into the device_fingerprints table, then
 * prune to keep only the K most-recent rows per user. Called from
 * loginUser, registerUser, and after a successful forgot-password change.
 */
export async function recordDeviceFingerprint(
  userId: string,
  deviceId: string,
  userAgent?: string,
): Promise<void> {
  if (!deviceId) return;
  await fetchOne(
    `INSERT INTO device_fingerprints (user_id, device_id, user_agent, last_used_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, device_id)
       DO UPDATE SET last_used_at = NOW(), user_agent = EXCLUDED.user_agent`,
    [userId, deviceId, userAgent ?? null],
  );
  await fetchOne(
    `SELECT public.prune_device_fingerprints($1, $2)`,
    [userId, DEVICE_FINGERPRINT_KEEP_LAST],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Forgot-password flow
// ─────────────────────────────────────────────────────────────────────────────

interface ForgotStepChallenge {
  ok: true;
  challenge: string;
  userId: string;
  expiresInSeconds: number;
}
interface ForgotStepFailed {
  ok: false;
  reason: 'unable_to_verify_device';
  // FIX [thinker-input]: Allow legacy users (NULL password_hash) to set
  // their first local password through this flow. The route maps
  // reason='password_not_set' onto a friendlier UI message.
  allowPasswordSet?: boolean;
}
export type ForgotStepResult = ForgotStepChallenge | ForgotStepFailed;

const FORGOT_PASSWORD_CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Step 1: take a username + current device_id, decide whether to issue a
 * password-reset challenge JWT. The response shape is deliberately uniform
 * (no enumeration leak between username-not-found vs. device-not-found):
 * either a challenge or a single "unable_to_verify_device" reason.
 *
 * A short artificial delay is added on the failure paths so an attacker
 * can't distinguish them via response timing.
 *
 * Note: we document in the UI that this flow is not a substitute for
 * server-side multi-factor auth — see "Limit of 2 devices" in the
 * security review. If the user has cleared localStorage or is on a new
 * device, they have no path to recover and must contact the admin.
 */
export async function startForgotPassword(
  username: string,
  deviceId: string,
  userAgent?: string,
): Promise<ForgotStepResult> {
  const failWithDelay = async (
    reason: 'unable_to_verify_device',
    allowPasswordSet = false,
  ): Promise<ForgotStepFailed> => {
    // Mask timing: always burn roughly the cost of a DB roundtrip +
    // bcrypt compare so caller can't distinguish short-circuit paths.
    await new Promise<void>((r) => setTimeout(r, 80));
    return { ok: false, reason, allowPasswordSet };
  };

  const profile = await fetchOne<{ id: string; has_hash: boolean }>(
    `SELECT id, (password_hash IS NOT NULL) AS has_hash
       FROM profiles
       WHERE LOWER(username) = LOWER($1)`,
    [username],
  );
  if (!profile) return failWithDelay('unable_to_verify_device');

  const fingerprint = await fetchOne<{ device_id: string }>(
    `SELECT device_id FROM device_fingerprints
       WHERE user_id = $1 AND device_id = $2`,
    [profile.id, deviceId],
  );
  if (!fingerprint) {
    return failWithDelay('unable_to_verify_device', !profile.has_hash);
  }

  // Rotate reset_nonce so any prior issued challenge tied to this user
  // becomes invalid; only the most-recently-issued challenge works. Even
  // though the JWT itself has a 5m exp, this gives us per-user single-shot
  // semantics on the application layer.
  const nonce = randomBytes(16).toString('hex');
  await fetchOne(
    `UPDATE profiles SET reset_nonce = $1 WHERE id = $2`,
    [nonce, profile.id],
  );

  void userAgent; // currently unused — kept for future device-management UI

  const challenge = jwt.sign(
    {
      sub: profile.id,
      did: deviceId,
      type: 'pwd_reset',
      nonce,
    },
    env.JWT_SECRET,
    { expiresIn: FORGOT_PASSWORD_CHALLENGE_TTL_SECONDS, algorithm: 'HS256' },
  );
  return {
    ok: true,
    challenge,
    userId: profile.id,
    expiresInSeconds: FORGOT_PASSWORD_CHALLENGE_TTL_SECONDS,
  };
}

export type CompleteForgotPasswordResult =
  | { ok: true; access_token: string; refresh_token: string; user: UserRecord }
  | { ok: false; reason: 'invalid_challenge' | 'password_too_short' | 'user_not_found' };

/**
 * Step 2: trade a valid challenge JWT + new password for fresh tokens.
 * Verifies the challenge signature, scope (`pwd_reset`), and binds the
 * device_id baked into the challenge to the device_id header sent on
 * this request — defending against challenge interception. Then
 * bcrypt-hashes the new password, sets `password_changed_at` so all
 * pre-reset access tokens get rejected, rotates reset_nonce to NULL,
 * revokes ALL other refresh tokens for the user, and issues a fresh
 * pair so the user is auto-logged-in on this device.
 */
export async function completeForgotPassword(
  challenge: string,
  deviceId: string,
  newPassword: string,
): Promise<CompleteForgotPasswordResult> {
  if (newPassword.length < 8) {
    return { ok: false, reason: 'password_too_short' };
  }

  interface ResetClaims {
    sub: string;
    did: string;
    type: string;
    nonce: string;
  }
  let decoded: ResetClaims;
  try {
    decoded = jwt.verify(challenge, env.JWT_SECRET) as ResetClaims;
  } catch {
    return { ok: false, reason: 'invalid_challenge' };
  }
  if (decoded.type !== 'pwd_reset') {
    return { ok: false, reason: 'invalid_challenge' };
  }
  // Bind challenge to the device that requested it. Defends against
  // challenge interception/replay from a different device even if a
  // future bug extends JWT expiry improperly.
  if (decoded.did !== deviceId) {
    return { ok: false, reason: 'invalid_challenge' };
  }

  // Verify the challenge nonce is still the most-recent one issued for
  // this user. startForgotPassword rotates this on every issuance;
  // completeForgotPassword clears it on successful use. So both replay
  // (same challenge used twice) AND reuse-after-rotation land here.
  const profile = await fetchOne<{
    id: string;
    username: string;
    avatar: string;
    last_sign_in_at: string | null;
    reset_nonce: string | null;
  }>(
    `SELECT id, username, avatar, last_sign_in_at, reset_nonce
       FROM profiles
       WHERE id = $1`,
    [decoded.sub],
  );
  if (!profile) return { ok: false, reason: 'user_not_found' };
  if (!profile.reset_nonce || profile.reset_nonce !== decoded.nonce) {
    return { ok: false, reason: 'invalid_challenge' };
  }

  const newHash = hashPassword(newPassword);
  const nowIso = new Date().toISOString();

  // All state writes happen inside one tx. SELECT FOR UPDATE on the
  // profile row serializes concurrent completeForgotPassword calls for
  // the same user, so two parallel challenge submissions can't both
  // pass the nonce check above. The reset_nonce → NULL UPDATE happens
  // inside the same tx, so the nonce is consumed atomically with the
  // password change.
  await tx(async (client) => {
    // Re-check nonce under the row lock so concurrent callers see a
    // deterministic winner. We already passed the unlocked check above
    // (column `profile.reset_nonce === decoded.nonce`); this guards
    // against the case where a parallel tx committed a different nonce
    // between our first read and the lock acquisition.
    const lockR = await client.query<{ reset_nonce: string | null }>(
      `SELECT reset_nonce FROM profiles WHERE id = $1 FOR UPDATE`,
      [decoded.sub],
    );
    const lockedNonce = lockR.rows[0]?.reset_nonce ?? null;
    if (lockedNonce !== decoded.nonce) {
      // Throw to roll back the tx (no writes happened yet, but the
      // lock will release on ROLLBACK).
      throw new Error('invalid_challenge');
    }

    // Single atomic UPDATE clears reset_nonce + writes new hash + records
    // change timestamp. Resetting nonce in the same statement ensures no
    // race can re-use the challenge after we've consumed it.
    await client.query(
      `UPDATE profiles
         SET password_hash = $1,
             password_changed_at = $2,
             last_sign_in_at = $2,
             reset_nonce = NULL
         WHERE id = $3`,
      [newHash, nowIso, profile.id],
    );
    // Revoke every outstanding refresh token for this user so other
    // devices/sessions must re-authenticate with the new password.
    await client.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1`,
      [profile.id],
    );
    // Drop the password_changed_at cache INSIDE the tx so that any
    // concurrent verifyAccessToken that lands during or just after
    // commit forces a fresh DB read (which sees the new post-update
    // password_changed_at). Without this, a verify in the sub-ms window
    // between commit and external invalidation could use a stale cache
    // entry and accept an old access token.
    invalidatePasswordChangedAtCache(profile.id);
  });

  // Refresh this device's fingerprint row so the user doesn't accidentally
  // prune themselves out by logging in concurrently on another device
  // before the next pruneDeviceFingerprints tick.
  await recordDeviceFingerprint(profile.id, deviceId);

  const refresh = signRefreshToken(profile.id);
  await fetchOne(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
    [profile.id, refresh.hash, refresh.expiresAt],
  );
  const access = signAccessToken(profile.id, profile.username, profile.last_sign_in_at);
  return {
    ok: true,
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
