import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, mutate } from '../db.js';
import { hashPassword, comparePassword, generateToken } from '../auth.js';

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  if (!/^[A-Za-z]{3,20}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3-20 letters' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const existing = await query(`SELECT id FROM users WHERE username = ?`, [username]);
  if (existing.length > 0 && existing[0].values.length > 0) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }

  const id = uuidv4();
  const hashedPassword = hashPassword(password);

  await mutate(
    `INSERT INTO users (id, username, password) VALUES (?, ?, ?)`,
    [id, username, hashedPassword]
  );

  const token = generateToken(id);
  res.status(201).json({ token, user: { id, username, avatar: '', online: false } });
});

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  const result = await query(
    `SELECT id, username, password, avatar, online FROM users WHERE username = ?`,
    [username]
  );

  if (result.length === 0 || result[0].values.length === 0) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const row = result[0].values[0];
  const [id, uname, hashedPassword, avatar, online] = row;

  if (!comparePassword(password, hashedPassword as string)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = generateToken(id as string);
  res.json({ token, user: { id, username: uname, avatar, online: !!online } });
});

export default router;
