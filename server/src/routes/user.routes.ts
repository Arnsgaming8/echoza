import { Router, Request, Response } from 'express';
import { verifyAccessToken } from '../auth.js';
import { fetchAll } from '../db.js';

const router = Router();

// ── /me (duplicate of /api/auth/me — kept for client backwards-compat) ──
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
  const profile = await fetchAll<{ id: string; username: string; avatar: string }>(
    `SELECT id, username, avatar FROM profiles WHERE id = $1`,
    [decoded.userId],
  );
  if (profile[0]) {
    res.json({ ...profile[0], online: false });
    return;
  }
  res.status(404).json({ error: 'User not found' });
});

// ── /search ──────────────────────────────────────────────────────────────
// Case-insensitive username search. Echoza usernames are 3-20 letters,
// no spaces — but users type partial matches. LOWER() on both sides hits
// the idx_profiles_username_lower index.
router.get('/search', async (req: Request, res: Response) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string') {
    res.json([]);
    return;
  }
  const like = '%' + q + '%';
  const profiles = await fetchAll<{ id: string; username: string; avatar: string }>(
    `SELECT id, username, avatar
       FROM profiles
       WHERE LOWER(username) LIKE LOWER($1)
       LIMIT 20`,
    [like],
  );
  res.json(profiles.map(p => ({ ...p, online: false })));
});

export default router;
