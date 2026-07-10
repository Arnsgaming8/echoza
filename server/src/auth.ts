import bcrypt from 'bcryptjs';
import { supabase, anonSupabase } from './supabase.js';

const EMAIL_DOMAIN = '@echoza.app';

function usernameToEmail(username: string): string {
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

  // Try Supabase Auth first (this works even if DB queries fail)
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

  // Legacy bcrypt fallback removed — users must log in via Supabase Auth.
  throw new Error('Invalid credentials');
}

export async function verifyAccessToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { data, error } = await anonSupabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id };
  } catch {
    return null;
  }
}
