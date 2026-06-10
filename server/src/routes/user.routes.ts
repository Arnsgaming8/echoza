import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { verifyToken } from '../auth.js';

const router = Router();

router.get('/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const result = query(
    `SELECT id, username, avatar, online FROM users WHERE id = ?`,
    [decoded.userId]
  );

  if (result.length === 0 || result[0].values.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const row = result[0].values[0];
  res.json({ id: row[0], username: row[1], avatar: row[2], online: !!row[3] });
});

router.get('/search', (req: Request, res: Response) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string') {
    res.json([]);
    return;
  }

  const result = query(
    `SELECT id, username, avatar, online FROM users WHERE username LIKE ? LIMIT 20`,
    [`%${q}%`]
  );

  const users = result[0]?.values.map((row: any[]) => ({
    id: row[0], username: row[1], avatar: row[2], online: !!row[3],
  })) || [];

  res.json(users);
});

export default router;
