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

  const { error: dbError } = await supabase.from('users').insert({
    id: authData.user.id,
    username,
    password: '',
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
    user: {
      id: authData.user.id,
      username,
      avatar: '',
      online: false,
    },
  };
}

async function migrateToSupabaseAuth(userId: string, username: string, password: string) {
  const email = usernameToEmail(username);
  const { data: authData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (createError || !authData.user) return null;

  await supabase.from('users').update({ password: '' }).eq('id', userId);
  return authData;
}

export async function loginUser(username: string, password: string) {
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id, username, avatar, online, password')
    .eq('username', username)
    .single();

  if (userError || !userData) {
    throw new Error('Invalid credentials');
  }

  const email = usernameToEmail(username);

  // Try Supabase Auth first (for users registered via Supabase)
  const { data: sessionData, error: signInError } = await anonSupabase.auth.signInWithPassword({ email, password });
  if (!signInError && sessionData?.session) {
    return {
      access_token: sessionData.session.access_token,
      user: { id: userData.id, username: userData.username, avatar: userData.avatar, online: !!userData.online },
    };
  }

  // Fall back to bcrypt (legacy users migrated from RiveStack)
  if (userData.password && comparePassword(password, userData.password)) {
    const authData = await migrateToSupabaseAuth(userData.id, username, password);
    if (!authData) throw new Error('Migration failed');

    const { data: newSession } = await anonSupabase.auth.signInWithPassword({ email, password });
    if (!newSession?.session) throw new Error('Invalid credentials');

    return {
      access_token: newSession.session.access_token,
      user: { id: userData.id, username: userData.username, avatar: userData.avatar, online: !!userData.online },
    };
  }

  throw new Error('Invalid credentials');
}

export async function verifyAccessToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id };
  } catch {
    return null;
  }
}
