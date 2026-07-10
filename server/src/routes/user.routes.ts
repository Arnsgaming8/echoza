import { Router, Request, Response } from 'express';
import { supabase, anonSupabase } from '../supabase.js';
import { verifyAccessToken } from '../auth.js';

const router = Router();

router.get('/me', async (req: Request, res: Response) => {
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, avatar')
    .eq('id', decoded.userId)
    .maybeSingle();

  if (profile) {
    res.json({ ...profile, online: false });
    return;
  }

  // Fallback to Auth metadata if DB is unreachable or profile row missing
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

router.get('/search', async (req: Request, res: Response) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string') {
    res.json([]);
    return;
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, avatar')
    .ilike('username', `%${q}%`)
    .limit(20);

  res.json((profiles || []).map(p => ({ ...p, online: false })));
});

export default router;
