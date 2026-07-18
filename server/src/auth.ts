

















import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from './env.js';
import { fetchOne, fetchAll, tx } from './db.js';







const BCRYPT_COST = 10;







const DEVICE_FINGERPRINT_KEEP_LAST = 2;








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





interface AccessTokenClaims {
  sub: string;
  username: string;
  lastSignInAt: string | null;
  
  
  
  iat?: number;
  type: 'access';
}

interface RefreshTokenClaims {
  sub: string;
  jti: string;
  type: 'refresh';
}


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


export function signRefreshToken(userId: string): {
  plaintext: string;
  hash: string;
  jti: string;
  expiresAt: Date;
} {
  const jti = uuidv4();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_MS);

  const claims: RefreshTokenClaims = {
    sub: userId,
    jti,
    type: 'refresh',
  };
  const plaintext = jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: Math.floor(env.REFRESH_TOKEN_TTL_MS / 1000),
    algorithm: 'HS256',
  });
  const hash = createHash('sha256').update(plaintext).digest('hex');
  return { plaintext, hash, jti, expiresAt };
}


export async function verifyAccessToken(
  token: string,
): Promise<{ userId: string; lastSignInAt: string | null; username: string } | null> {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenClaims;
    if (decoded.type !== 'access') return null;
    
    
    
    
    
    
    const pwdChangedAt = await getPasswordChangedAt(decoded.sub);
    if (pwdChangedAt) {
      const iatSec = decoded.iat ?? 0;
      const pwdChangedSec = Math.floor(new Date(pwdChangedAt).getTime() / 1000);
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
  
  
  
  
  password = password.trim();
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
  
  
  
  
  
  username = username.trim();
  password = password.trim();
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


void fetchAll;






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





interface ForgotStepChallenge {
  ok: true;
  challenge: string;
  userId: string;
  expiresInSeconds: number;
}
interface ForgotStepFailed {
  ok: false;
  reason: 'unable_to_verify_device';
  
  
  
  allowPasswordSet?: boolean;
}
export type ForgotStepResult = ForgotStepChallenge | ForgotStepFailed;

const FORGOT_PASSWORD_CHALLENGE_TTL_SECONDS = 5 * 60;


export async function startForgotPassword(
  username: string,
  deviceId: string,
  userAgent?: string,
): Promise<ForgotStepResult> {
  const failWithDelay = async (
    reason: 'unable_to_verify_device',
    allowPasswordSet = false,
  ): Promise<ForgotStepFailed> => {
    
    
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


export async function completeForgotPassword(
  challenge: string,
  deviceId: string,
  newPassword: string,
): Promise<CompleteForgotPasswordResult> {
  
  
  
  newPassword = newPassword.trim();
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
  
  
  
  if (decoded.did !== deviceId) {
    return { ok: false, reason: 'invalid_challenge' };
  }

  
  
  
  
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

  
  
  
  
  
  
  await tx(async (client) => {
    
    
    
    
    
    const lockR = await client.query<{ reset_nonce: string | null }>(
      `SELECT reset_nonce FROM profiles WHERE id = $1 FOR UPDATE`,
      [decoded.sub],
    );
    const lockedNonce = lockR.rows[0]?.reset_nonce ?? null;
    if (lockedNonce !== decoded.nonce) {
      
      
      throw new Error('invalid_challenge');
    }

    
    
    
    await client.query(
      `UPDATE profiles
         SET password_hash = $1,
             password_changed_at = $2,
             last_sign_in_at = $2,
             reset_nonce = NULL
         WHERE id = $3`,
      [newHash, nowIso, profile.id],
    );
    
    
    await client.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1`,
      [profile.id],
    );
    
    
    
    
    
    
    invalidatePasswordChangedAtCache(profile.id);
  });

  
  
  
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
