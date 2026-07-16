import { Router, Request, Response } from 'express';
import {
  registerUser,
  loginUser,
  verifyAccessToken,
  rotateRefreshToken,
  revokeRefreshToken,
  comparePassword,
  startForgotPassword,
  completeForgotPassword,
} from '../auth.js';
import { fetchOne } from '../db.js';
import { isUserConnected } from '../socket.js';

const router = Router();

/**
 * Extract the client-supplied device id from the `X-Device-Id` header.
 * Falls back to a request-scoped placeholder if missing, so existing
 * very-old clients (pre-deviceId rollout) still work — but their
 * fingerprints never get recorded so they can't use forgot-password.
 * The fallback string is unique per request, so the per-user top-2
 * prune logic still shrinks correctly for old clients within a single
 * session (each request looks like a "new device").
 */
function getDeviceIdFromRequest(req: Request): string {
  const headerVal = req.headers['x-device-id'];
  const raw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (raw && typeof raw === 'string' && raw.length > 0 && raw.length <= 256) {
    return raw;
  }
  // Anonymous placeholder; safe to skip fingerprinting for these.
  return '';
}

function getUserAgentFromRequest(req: Request): string {
  const headerVal = req.headers['user-agent'];
  const raw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  return typeof raw === 'string' ? raw.slice(0, 512) : '';
}

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
    const result = await registerUser(
      username,
      password,
      getDeviceIdFromRequest(req),
      getUserAgentFromRequest(req),
    );
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
    const result = await loginUser(
      username,
      password,
      getDeviceIdFromRequest(req),
      getUserAgentFromRequest(req),
    );
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

// ── /forgot-password/start ─────────────────────────────────────────────────
// Step 1 of the forgot-password flow. Client posts { username } and the
// X-Device-Id header; server checks if (username, device_id) matches one of
// the user’s last 2 device_fingerprints rows. If so, returns a short-lived
// challenge JWT. If not, returns a uniform "unable_to_verify_device"
// response so an attacker can’t enumerate usernames.
//
// allowPasswordSet narrows the failure message so the UI can help legacy
// users (migrated with NULL password_hash) bootstrap their first local
// password — but only IF their current device is on the trusted list.
router.post('/forgot-password/start', async (req: Request, res: Response) => {
  const { username } = req.body || {};
  const deviceId = getDeviceIdFromRequest(req);

  if (!username || !deviceId) {
    // Don't differentiate missing-input from not-found-from-DB: return
    // 400 uniformly so callers without a valid device-id get a clean
    // error without leaking whether the user exists.
    res.status(400).json({ error: 'username and device required' });
    return;
  }
  if (typeof username !== 'string' || !/^[A-Za-z_]{3,20}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3-20 letters' });
    return;
  }

  try {
    const result = await startForgotPassword(username, deviceId, getUserAgentFromRequest(req));
    if (!result.ok) {
      res.json({
        success: false,
        reason: result.reason,
        allowPasswordSet: result.allowPasswordSet ?? false,
      });
      return;
    }
    res.json({
      success: true,
      challenge: result.challenge,
      expiresInSeconds: result.expiresInSeconds,
    });
  } catch (err: any) {
    console.error('[Auth] forgot-password/start error:', err);
    res.status(500).json({ error: 'Forgot-password start failed' });
  }
});

// ── /forgot-password/change ───────────────────────────────────────────────
// Step 2 of the forgot-password flow. Client posts { challenge, new_password }
// and the X-Device-Id header. Server verifies the challenge (signature,
// scope, device bind, single-use nonce), bcrypt-hashes the new password,
// invalidates all pre-reset access tokens via password_changed_at, revokes
// every other refresh token for the user, then returns a fresh token pair
// so the user lands logged-in on this device.
router.post('/forgot-password/change', async (req: Request, res: Response) => {
  const { challenge, new_password } = req.body || {};
  const deviceId = getDeviceIdFromRequest(req);

  if (!challenge || !new_password || !deviceId) {
    res.status(400).json({ error: 'challenge, new_password, and device required' });
    return;
  }
  if (typeof challenge !== 'string' || typeof new_password !== 'string') {
    res.status(400).json({ error: 'Invalid input shape' });
    return;
  }

  try {
    const result = await completeForgotPassword(challenge, deviceId, new_password);
    if (!result.ok) {
      const status = result.reason === 'password_too_short' ? 400 : 401;
      res.status(status).json({ error: result.reason });
      return;
    }
    res.json({
      token: result.access_token,
      refresh_token: result.refresh_token,
      user: result.user,
    });
  } catch (err: any) {
    console.error('[Auth] forgot-password/change error:', err);
    res.status(500).json({ error: 'Forgot-password change failed' });
  }
});

export default router;
