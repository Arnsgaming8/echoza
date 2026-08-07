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


function getDeviceIdFromRequest(req: Request): string {
  const headerVal = req.headers['x-device-id'];
  const raw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (raw && typeof raw === 'string' && raw.length > 0 && raw.length <= 256) {
    return raw;
  }
  
  return '';
}

function getUserAgentFromRequest(req: Request): string {
  const headerVal = req.headers['user-agent'];
  const raw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  return typeof raw === 'string' ? raw.slice(0, 512) : '';
}


router.post('/register', async (req: Request, res: Response) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }
  if (!/^.{3,20}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3-20 characters' });
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
    
    
    const msg = (err?.message || 'Registration failed').toString();
    if (err?.code === 'USERNAME_TAKEN' || msg.toLowerCase().includes('already taken')) {
      res.status(409).json({ error: 'Username already taken' });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});


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
    
    
    const msg = (err?.message || 'Invalid credentials').toString();
    res.status(401).json({ error: msg });
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

  const profile = await fetchOne<{ id: string; username: string; avatar: string }>(
    `SELECT id, username, avatar FROM profiles WHERE id = $1`,
    [decoded.userId],
  );

  if (profile) {
    
    res.json({ ...profile, online: isUserConnected(profile.id) });
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
  
  
  
  const cleanPassword = password.trim();
  if (!profile.password_hash || !comparePassword(cleanPassword, profile.password_hash)) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  try {
    
    
    
    
    await fetchOne(`DELETE FROM profiles WHERE id = $1`, [decoded.userId]);
    
    
    
    try {
      await revokeRefreshToken(token);
    } catch {
      
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Delete Account] error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete account' });
  }
});




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











router.post('/forgot-password/start', async (req: Request, res: Response) => {
  const { username } = req.body || {};
  const deviceId = getDeviceIdFromRequest(req);

  if (!username || !deviceId) {
    
    
    
    res.status(400).json({ error: 'username and device required' });
    return;
  }
  if (typeof username !== 'string' || !/^.{3,20}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3-20 characters' });
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
