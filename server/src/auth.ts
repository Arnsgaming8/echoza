import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { supabase, anonSupabase } from './supabase.js';

const EMAIL_DOMAIN = '@echoza.app';
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
// Standard UUID namespace from RFC 4122 §4.3 — used to derive deterministic v5 UUIDs.
const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export function usernameToEmail(username: string): string {
  return `u.${username.toLowerCase()}${EMAIL_DOMAIN}`;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export async function registerUser(username: string, password: string) {
  const email = usernameToEmail(username);
  const { data: authData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (createError) throw createError;
  if (!authData.user) throw new Error('Failed to create user');

  const { error: dbError } = await supabase.from('profiles').insert({
    id: authData.user.id,
    username,
    display_name: '',
    avatar: '',
  });
  if (dbError) {
    await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
    throw dbError;
  }

  const { data: sessionData, error: signInError } = await anonSupabase.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return {
    access_token: sessionData.session?.access_token || '',
    refresh_token: sessionData.session?.refresh_token || '',
    user: {
      id: authData.user.id,
      username,
      avatar: '',
      online: false,
    },
  };
}

export async function loginUser(username: string, password: string) {
  const email = usernameToEmail(username);

  // Check if the account exists in the profiles table first
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (!existingProfile) {
    throw new Error('Account does not exist');
  }

  // Try Supabase Auth
  const { data: sessionData, error: signInError } = await anonSupabase.auth.signInWithPassword({ email, password });
  if (!signInError && sessionData?.session) {
    const uid = sessionData.user.id;
    const metaUsername = sessionData.user.user_metadata?.username || username;

    // Try to fetch the profile row; if missing (fresh schema, no migration), fall back to auth metadata
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username, avatar')
      .eq('id', uid)
      .maybeSingle();

    return {
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token || '',
      user: {
        id: uid,
        username: profile?.username || metaUsername,
        avatar: profile?.avatar || '',
        online: false,
      },
    };
  }

  // Profile exists but password is wrong
  throw new Error('Invalid credentials');
}

export async function verifyAccessToken(token: string): Promise<{
  userId: string;
  lastSignInAt: string | null;
} | null> {
  try {
    const { data, error } = await anonSupabase.auth.getUser(token);
    if (error || !data.user) return null;
    return {
      userId: data.user.id,
      // Supabase Auth tracks last_sign_in_at per user; resets on each
      // successful signInWithPassword. We use it to enforce a rolling
      // 30-day forced-logout policy server-side.
      lastSignInAt: data.user.last_sign_in_at || null,
    };
  } catch {
    return null;
  }
}

/**
 * Returns null if the session is still valid, or
 * `{ reason: 'session_expired_30_days', accountExpiresAt }` if the rolling
 * 30-day window from Supabase Auth's `last_sign_in_at` has elapsed.
 *
 * If `lastSignInAt` is missing (hand-rolled test JWT, etc.) we let the
 * request through — gating on missing data would create weird login loops.
 */
export function checkSessionExpiry(lastSignInAt: string | null | undefined): null | {
  reason: string;
  accountExpiresAt: string;
} {
  if (!lastSignInAt) return null;
  const expiresAt = new Date(lastSignInAt).getTime() + SESSION_DURATION_MS;
  if (Date.now() > expiresAt) {
    return {
      reason: 'session_expired_30_days',
      accountExpiresAt: new Date(expiresAt).toISOString(),
    };
  }
  return null;
}

/**
 * Idempotently creates the Echoza Security bot profile + auth user. Race-safe
 * across concurrent cron calls (e.g. cron-job.org retrying mid-flight, or
 * ops double-firing). Strategy:
 *  1. Fast-path read of profiles by username — if present, return id.
 *  2. Authoritative read of auth users by email — if present, ensure profile
 *     row exists under that id (race-safe; 23505 duplicate tolerated) and return.
 *  3. Otherwise create. If Supabase auth responds with an 'already_exists' /
 *     'duplicate' style error (another concurrent call won the race), re-list
 *     auth and find the winning id.
 *  4. Create the profile row. On failure, compensating delete of the auth user.
 */
export async function getOrCreateEchozaSecurityId(): Promise<string> {
  // 1. Fast path
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', 'Echoza Security')
    .maybeSingle();
  if (existing?.id) return existing.id;

  const BOT_EMAIL = 'echoza-security@echoza.app';

  // 2. Race-safe auth-users scan: find an existing Echoza Security email id.
  let page = 1;
  while (true) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (!data?.users?.length) break;
    for (const u of data.users) {
      if (u.email === BOT_EMAIL) {
        // Make sure the profile row also exists; benign 23505 (already there)
        // from a racing profile-writer is fine.
        const { error: pErr } = await supabase.from('profiles').insert({
          id: u.id,
          username: 'Echoza Security',
          display_name: 'Echoza Security',
          avatar: '',
        });
        if (pErr && pErr.code !== '23505') {
          console.warn(`[auth] Echoza Security profile insert failed for existing auth user ${u.id}: ${pErr.message}`);
        }
        return u.id;
      }
    }
    if (data.users.length < 1000) break;
    page++;
  }

  // 3. Create the auth user.
  const { data: authData, error: createErr } = await supabase.auth.admin.createUser({
    email: BOT_EMAIL,
    password: randomBytes(32).toString('hex'),
    email_confirm: true,
    user_metadata: { username: 'Echoza Security' },
  });
  if (createErr) {
    const msg = (createErr.message || '').toLowerCase();
    // Race recovery: another concurrent cron won the race and created the
    // auth user between our listUsers scan above and our createUser call.
    if (msg.includes('already') || msg.includes('duplicate') || msg.includes('exists')) {
      let page2 = 1;
      while (true) {
        const { data } = await supabase.auth.admin.listUsers({ page: page2, perPage: 1000 });
        if (!data?.users?.length) break;
        for (const u of data.users) {
          if (u.email === BOT_EMAIL) return u.id;
        }
        if (data.users.length < 1000) break;
        page2++;
      }
    }
    throw new Error('Failed to create Echoza Security auth user: ' + createErr.message);
  }
  const authId = authData.user?.id;
  if (!authId) throw new Error('No auth id returned for Echoza Security user');

  // 4. Insert the profile row. 23505 (already there) is tolerated.
  const { error: profileErr } = await supabase.from('profiles').insert({
    id: authId,
    username: 'Echoza Security',
    display_name: 'Echoza Security',
    avatar: '',
  });
  if (profileErr && profileErr.code !== '23505') {
    await supabase.auth.admin.deleteUser(authId).catch(() => { /* best-effort cleanup */ });
    throw new Error('Failed to create Echoza Security profile: ' + profileErr.message);
  }
  return authId;
}

/**
 * Returns the direct conversation id between two users (1:1, is_group=false),
 * creating one with `uuidv4()` if none exists. Mirrors the resolution logic
 * in socket.ts but runs through `service_role` (no admin role required)
 * and uses public.profiles consistently with the live runtime schema.
 */
export async function getOrCreateDirectConversation(userAId: string, userBId: string): Promise<string> {
  const [userLo, userHi] = [userAId, userBId].sort();
  const { data: loConvs } = await supabase
    .from('participants')
    .select('conversation_id')
    .eq('user_id', userLo);
  const convIds = (loConvs || []).map(p => p.conversation_id);
  if (convIds.length > 0) {
    const { data: matches } = await supabase
      .from('participants')
      .select('conversation_id')
      .in('conversation_id', convIds)
      .eq('user_id', userHi);
    if (matches && matches.length > 0) return matches[0].conversation_id;
  }
  const newId = uuidv4();
  const { error: convErr } = await supabase.from('conversations').insert({
    id: newId,
    is_group: false,
  });
  if (convErr) throw new Error('Failed to create direct conversation: ' + convErr.message);
  const { error: partErr } = await supabase.from('participants').insert([
    { conversation_id: newId, user_id: userAId },
    { conversation_id: newId, user_id: userBId },
  ]);
  if (partErr) {
    throw new Error('Failed to add participants to new conversation: ' + partErr.message);
  }
  return newId;
}

/**
 * Deterministic UUIDv5 message-id derived from (kind + isoDay + userId).
 * The `expiryIsoDay` should be the user's 30-day EXPIRATION date (YYYY-MM-DD),
 * NOT the cron's run date — this guarantees a single message per 30-day
 * window per user regardless of how many cron runs hit them. Re-runs of the
 * cron (or a multi-day window where multiple runs catch the same user)
 * collide on PK and we treat that as a no-op success.
 */
export function warningMessageId(userId: string, expiryIsoDay: string): string {
  return uuidv5(`echoza-security-warning:${expiryIsoDay}:${userId}`, UUID_NAMESPACE);
}
