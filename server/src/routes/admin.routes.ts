import { Router, Request, Response } from 'express';
import {
  verifyAdminSecret,
  signAdminToken,
  verifyAdminToken,
  adminSearchAccounts,
  adminAccessAccount,
  ADMIN_TOKEN_TTL_SECONDS,
} from '../admin.js';

const router = Router();

const MAX_UNLOCK_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 10 * 60 * 1000;
const unlockFailures = new Map<string, { count: number; lockedUntil: number }>();

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return (typeof raw === 'string' ? raw.split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
}

function checkLocked(ip: string): boolean {
  const entry = unlockFailures.get(ip);
  return !!entry && entry.lockedUntil > Date.now();
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = unlockFailures.get(ip);
  if (!entry || entry.lockedUntil <= now) {
    unlockFailures.set(ip, { count: 1, lockedUntil: 0 });
    return;
  }
  const count = entry.count + 1;
  const lockedUntil = count >= MAX_UNLOCK_ATTEMPTS ? now + LOCK_WINDOW_MS : 0;
  unlockFailures.set(ip, { count, lockedUntil });
}

router.post('/unlock', async (req: Request, res: Response) => {
  const { secret } = req.body || {};
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > 100) {
    res.status(400).json({ error: 'Secret word required' });
    return;
  }
  const ip = clientIp(req);
  if (checkLocked(ip)) {
    res.status(429).json({ error: 'Too many attempts. Try again later.' });
    return;
  }

  await new Promise<void>((r) => setTimeout(r, 400));
  if (!verifyAdminSecret(secret)) {
    recordFailure(ip);
    res.status(401).json({ error: 'Wrong secret word' });
    return;
  }

  unlockFailures.delete(ip);
  const token = signAdminToken();
  res.json({ admin_token: token, expiresInSeconds: ADMIN_TOKEN_TTL_SECONDS });
});

function getAdminToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7);
}

router.get('/search', async (req: Request, res: Response) => {
  const token = getAdminToken(req);
  if (!token || !verifyAdminToken(token)) {
    res.status(401).json({ error: 'Invalid admin token' });
    return;
  }
  const q = req.query.q;
  if (typeof q !== 'string' || !q.trim()) {
    res.json([]);
    return;
  }
  const accounts = await adminSearchAccounts(q.trim());
  res.json(accounts);
});

router.post('/access', async (req: Request, res: Response) => {
  const token = getAdminToken(req);
  if (!token || !verifyAdminToken(token)) {
    res.status(401).json({ error: 'Invalid admin token' });
    return;
  }
  const { userId } = req.body || {};
  if (typeof userId !== 'string' || !userId) {
    res.status(400).json({ error: 'userId required' });
    return;
  }
  const result = await adminAccessAccount(userId);
  if (!result) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  res.json({
    token: result.access_token,
    refresh_token: result.refresh_token,
    user: result.user,
  });
});

export default router;
