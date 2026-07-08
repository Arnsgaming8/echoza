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
    refresh_token: sessionData.session?.refresh_token || '',
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
  if (createError || !authData.user) {
    console.error('[migrate] createUser failed:', createError?.message);
    return null;
  }

  const newId = authData.user.id;
  if (newId !== userId) {
    // Rename old user to avoid UNIQUE conflict, insert new row, then delete old
    await supabase.from('users').update({ username: username + '_old' }).eq('id', userId);

    const { data: oldUser } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!oldUser) return null;

    const { error: insErr } = await supabase.from('users').insert({
      id: newId, username, password: '', avatar: oldUser.avatar, online: oldUser.online,
    });
    if (insErr) { console.error('[migrate] insert failed:', insErr.message); return null; }

    await supabase.from('messages').update({ sender_id: newId }).eq('sender_id', userId);
    await supabase.from('conversations').update({ user1_id: newId }).eq('user1_id', userId);
    await supabase.from('conversations').update({ user2_id: newId }).eq('user2_id', userId);
    await supabase.from('group_members').update({ user_id: newId }).eq('user_id', userId);
    await supabase.from('push_subscriptions').update({ user_id: newId }).eq('user_id', userId);

    const { error: delErr } = await supabase.from('users').delete().eq('id', userId);
    if (delErr) console.error('[migrate] delete old user failed:', delErr.message);
  } else {
    await supabase.from('users').update({ password: '' }).eq('id', userId);
  }
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
  console.error('[Login] debug:', JSON.stringify({ username, hasError: !!signInError, errMsg: signInError?.message, hasSession: !!sessionData?.session, uid: sessionData?.user?.id?.slice(0,8), pwLen: userData.password?.length, hasPw: !!userData.password }));
  if (!signInError && sessionData?.session) {
    return {
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token || '',
      user: { id: userData.id, username: userData.username, avatar: userData.avatar, online: !!userData.online },
    };
  }

  // Fall back to bcrypt (legacy users migrated from RiveStack)
  if (userData.password && comparePassword(password, userData.password)) {
    await migrateToSupabaseAuth(userData.id, username, password);

    const { data: newSession } = await anonSupabase.auth.signInWithPassword({ email, password });
    if (!newSession?.session) throw new Error('Invalid credentials');

    const { data: migratedUser } = await supabase
      .from('users')
      .select('id, username, avatar, online')
      .eq('id', newSession.user.id)
      .single();

    return {
      access_token: newSession.session.access_token,
      refresh_token: newSession.session.refresh_token || '',
      user: { id: migratedUser?.id || userData.id, username: migratedUser?.username || userData.username, avatar: migratedUser?.avatar || userData.avatar, online: !!migratedUser?.online || !!userData.online },
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
