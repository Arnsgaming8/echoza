import { Router, Request, Response } from 'express';
import { registerUser, loginUser, verifyAccessToken, checkSessionExpiry, usernameToEmail } from '../auth.js';
import { supabase, anonSupabase } from '../supabase.js';

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  if (!/^[A-Za-z_]{3,20}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3-20 letters' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (existing) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }

  try {
    const result = await registerUser(username, password);
    res.status(201).json({ token: result.access_token, refresh_token: result.refresh_token, user: result.user });
  } catch (err: any) {
    console.error('[Auth] register error:', err);
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  try {
    const result = await loginUser(username, password);
    res.json({ token: result.access_token, refresh_token: result.refresh_token, user: result.user });
  } catch (err: any) {
    console.error('[Login] error:', err?.message || err);
    // Pass through the specific error message ("Account does not exist" vs "Invalid credentials")
    const message = err?.message || 'Invalid credentials';
    res.status(401).json({ error: message });
  }
});

router.get('/me', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const decoded = await verifyAccessToken(token);
  if (!decoded) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  // ── 30-day rolling session-expiry check (security policy). ──
  // Server returns 401 with `reason: 'session_expired_30_days'` when
  // now > last_sign_in_at + 30d; the client AuthContext catches this,
  // nuke-tokens, and hard-redirects to Landing for the banner UI.
  const expiry = checkSessionExpiry(decoded.lastSignInAt);
  if (expiry) {
    res.status(401).json({
      error: 'Session expired after 30 days for security',
      ...expiry,
    });
    return;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, avatar')
    .eq('id', decoded.userId)
    .maybeSingle();

  if (profile) {
    res.json({ ...profile, online: false });
    return;
  }

  // Fallback to Auth token metadata if DB is unreachable
  const { data: { user: authUser } } = await anonSupabase.auth.getUser(token);
  if (authUser) {
    res.json({
      id: authUser.id,
      username: authUser.user_metadata?.username || '',
      avatar: '',
      online: false,
    });
    return;
  }

  res.status(404).json({ error: 'User not found' });
});

router.post('/delete-account', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const decoded = await verifyAccessToken(token);
  if (!decoded) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const { password } = req.body;
  if (!password) {
    res.status(400).json({ error: 'Password required' });
    return;
  }

  const userId = decoded.userId;

  // Fetch the profile to get the username
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  // Verify password by trying to log in
  const email = usernameToEmail(profile.username);
  const { error: signInError } = await anonSupabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  try {
    // Delete user data in FK-safe order
    await supabase.from('read_receipts').delete().eq('user_id', userId);
    // Delete messages sent by this user
    await supabase.from('messages').delete().eq('sender_id', userId);
    // Remove from participants
    await supabase.from('participants').delete().eq('user_id', userId);
    // Delete push subscriptions
    await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    // Nullify conversation references (two separate queries to avoid clearing the wrong field)
    await Promise.all([
      supabase.from('conversations').update({ created_by: null }).eq('created_by', userId),
      supabase.from('conversations').update({ last_message_sender_id: null }).eq('last_message_sender_id', userId),
    ]);
    // Delete profile
    await supabase.from('profiles').delete().eq('id', userId);
    // Delete auth user (this triggers cascade on everything else)
    await supabase.auth.admin.deleteUser(userId);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[Delete Account] error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete account' });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    res.status(400).json({ error: 'Refresh token required' });
    return;
  }

  try {
    const { data, error } = await anonSupabase.auth.refreshSession({ refresh_token });
    if (error || !data.session || !data.user) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const refreshUser = data.user;

    const { data: dbProfile } = await supabase
      .from('profiles')
      .select('id, username, avatar')
      .eq('id', refreshUser.id)
      .maybeSingle();

    res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: dbProfile
        ? { ...dbProfile, online: false }
        : {
            id: refreshUser.id,
            username: refreshUser.user_metadata?.username || '',
            avatar: '',
            online: false,
          },
    });
  } catch {
    res.status(500).json({ error: 'Refresh failed' });
  }
});

export default router;
