import { Router, Request, Response } from 'express';
import { supabase } from '../supabase.js';
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

  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, avatar, online')
    .eq('id', decoded.userId)
    .single();

  if (error || !user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(user);
});

router.get('/search', async (req: Request, res: Response) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string') {
    res.json([]);
    return;
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, username, avatar, online')
    .ilike('username', `%${q}%`)
    .limit(20);

  res.json(users || []);
});

export default router;
