import { Router, Request, Response } from 'express';
import { registerUser, loginUser, verifyAccessToken } from '../auth.js';
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
