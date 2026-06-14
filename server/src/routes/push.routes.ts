import { Router, Request, Response } from 'express';
import webpush from 'web-push';
import { mutate, query } from '../db.js';
import { verifyToken } from '../auth.js';

const router = Router();

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;

if (publicKey && privateKey) {
  webpush.setVapidDetails(
    'mailto:echoza@app.com',
    publicKey,
    privateKey
  );
}

router.post('/subscribe', (req: Request, res: Response) => {
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

  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }

  // Remove any stale subscription from a previous account on the same device
  mutate(
    `DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id != ?`,
    [endpoint, decoded.userId]
  );

  mutate(
    `INSERT OR IGNORE INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)`,
    [decoded.userId, endpoint, keys.p256dh, keys.auth]
  );

  res.json({ success: true });
});

export async function sendPushNotification(userId: string, title: string, body: string, url?: string, conversationId?: string) {
  if (!publicKey || !privateKey) return;

  console.log(`[Push] sendPushNotification called userId=${userId} title="${title}" body="${body}"`);

  const subs = await query(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`,
    [userId]
  );

  const endpoints = (subs[0]?.values || []).map((r: any[]) => r[0]);
  console.log(`[Push] found ${endpoints.length} subscriptions for userId=${userId}:`, endpoints.map((e: string) => e.slice(0, 40) + '...'));

  const payload = JSON.stringify({ title, body, url: url || '/', conversationId });

  for (const row of (subs[0]?.values || [])) {
    try {
      console.log(`[Push] sending to endpoint: ${(row[0] as string).slice(0, 40)}...`);
      await webpush.sendNotification({
        endpoint: row[0] as string,
        keys: { p256dh: row[1] as string, auth: row[2] as string },
      }, payload);
    } catch (err: any) {
      console.warn(`[Push] send failed for endpoint, deleting: ${err?.message || 'unknown'}`);
      mutate(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [row[0] as string]);
    }
  }
}

export default router;
