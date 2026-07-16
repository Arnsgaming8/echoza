import { Router, Request, Response } from 'express';
import {
  registerUser,
  loginUser,
  verifyAccessToken,
  rotateRefreshToken,
  revokeRefreshToken,
  comparePassword,
} from '../auth.js';
import { fetchOne } from '../db.js';
import { isUserConnected } from '../socket.js';

const router = Router();

// ── /register ────────────────────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  const { username, password } = req.body || {};

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

  try {
    const result = await registerUser(username, password);
    res.status(201).json({
      token: result.access_token,
      refresh_token: result.refresh_token,
      user: result.user,
    });
  } catch (err: any) {
    console.error('[Auth] register error:', err);
    // `Username already taken` is a 409; everything else is a 500.
    // FIX #15: Check structured error code first, fall back to string match.
    const msg = (err?.message || 'Registration failed').toString();
    if (err?.code === 'USERNAME_TAKEN' || msg.toLowerCase().includes('already taken')) {
      res.status(409).json({ error: 'Username already taken' });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ── /login ──────────────────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  try {
    const result = await loginUser(username, password);
    res.json({
      token: result.access_token,
      refresh_token: result.refresh_token,
      user: result.user,
    });
  } catch (err: any) {
    // Pass through specific messages ("Account does not exist" vs
    // "Invalid credentials") so the client can render a helpful error.
    const msg = (err?.message || 'Invalid credentials').toString();
    res.status(401).json({ error: msg });
  }
});

// ── /me ─────────────────────────────────────────────────────────────────────
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

  const profile = await fetchOne<{ id: string; username: string; avatar: string }>(
    `SELECT id, username, avatar FROM profiles WHERE id = $1`,
    [decoded.userId],
  );

  if (profile) {
    // FIX #6: Use actual socket presence instead of hardcoded online: false.
    res.json({ ...profile, online: isUserConnected(profile.id) });
    return;
  }
  res.status(404).json({ error: 'User not found' });
});

// ── /delete-account ─────────────────────────────────────────────────────────
// Re-verifies the password locally before nuking the user + cascades
// (messages, participants, push_subscriptions, read_receipts cascade;
// conversations.* referenced fields SET NULL via the FK definitions).
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

  const { password } = req.body || {};
  if (!password) {
    res.status(400).json({ error: 'Password required' });
    return;
  }

  const profile = await fetchOne<{ id: string; username: string; password_hash: string | null }>(
    `SELECT id, username, password_hash FROM profiles WHERE id = $1`,
    [decoded.userId],
  );
  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }
  if (!profile.password_hash || !comparePassword(password, profile.password_hash)) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  try {
    // FKs do the rest:
    //   participants, messages, read_receipts, push_subscriptions → CASCADE
    //   refresh_tokens → CASCADE
    //   conversations.created_by / last_message_sender_id → SET NULL
    await fetchOne(`DELETE FROM profiles WHERE id = $1`, [decoded.userId]);
    // Best-effort revoke of any outstanding refresh tokens. (DELETE on
    // profile already removed them via CASCADE, but this makes the
    // intent explicit.)
    try {
      await revokeRefreshToken(token);
    } catch {
      /* token was an access token, not refresh — nothing to revoke */
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Delete Account] error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete account' });
  }
});

// ── /refresh ────────────────────────────────────────────────────────────────
// Swap a valid refresh token for a fresh (access, refresh) pair. The old
// refresh is rotated and replaced in the DB transaction so replay is blocked.
router.post('/refresh', async (req: Request, res: Response) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token) {
    res.status(400).json({ error: 'Refresh token required' });
    return;
  }

  try {
    const result = await rotateRefreshToken(refresh_token);
    if (!result.ok) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }
    const profile = await fetchOne<{ id: string; username: string; avatar: string }>(
      `SELECT id, username, avatar FROM profiles WHERE id = $1`,
      [result.userId],
    );
    if (!profile) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }
    // FIX #6: Use actual socket presence instead of hardcoded online: false.
    res.json({
      token: result.access,
      refresh_token: result.refresh,
      user: { ...profile, online: isUserConnected(profile.id) },
    });
  } catch (err: any) {
    console.error('[Auth] refresh error:', err);
    res.status(500).json({ error: err?.message || 'Refresh failed' });
  }
});

export default router;
