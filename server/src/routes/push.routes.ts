import { Router, Request, Response } from 'express';
import webpush from 'web-push';
import { fetchAll, fetchOne } from '../db.js';
import { verifyAccessToken } from '../auth.js';
import { getVapidKeys } from '../vapid.js';

const router = Router();




router.get('/vapid-public-key', (_req: Request, res: Response) => {
  const keys = getVapidKeys();
  if (!keys) {
    res.status(503).json({ error: 'VAPID not configured on server' });
    return;
  }
  res.json({ publicKey: keys.publicKey });
});






router.post('/subscribe', async (req: Request, res: Response) => {
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

  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }

  await fetchOne(
    `DELETE FROM push_subscriptions
       WHERE endpoint = $1 AND user_id <> $2`,
    [endpoint, decoded.userId],
  );
  await fetchOne(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint)
       DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [decoded.userId, endpoint, keys.p256dh, keys.auth],
  );
  res.json({ success: true });
});




router.post('/test', async (req: Request, res: Response) => {
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
  if (!getVapidKeys()) {
    res.status(503).json({ error: 'VAPID not configured on server' });
    return;
  }

  const subs = await fetchAll<{ endpoint: string }>(
    `SELECT endpoint FROM push_subscriptions WHERE user_id = $1`,
    [decoded.userId],
  );
  if (!subs.length) {
    res.json({ success: false, reason: 'no_subscriptions' });
    return;
  }
  await sendPushNotification(
    decoded.userId,
    'Echoza test push',
    'Notifications are working!',
    '/',
    undefined,
    { tag: 'echoza-test', data: { isTest: true } },
  );
  res.json({ success: true, subscriptionCount: subs.length });
});



export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  url?: string,
  conversationId?: string,
  extra?: { tag?: string; data?: Record<string, any> },
): Promise<void> {
  if (!getVapidKeys()) return;

  const subs = await fetchAll<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth
       FROM push_subscriptions
       WHERE user_id = $1`,
    [userId],
  );
  if (!subs.length) return;

  const payloadData = {
    title,
    body,
    url: url || '/',
    conversationId,
    ...(extra?.data || {}),
  };
  const payload = JSON.stringify(payloadData);

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
        extra?.tag ? { headers: { Urgency: 'high', Topic: extra.tag } } : undefined,
      );
    } catch {
      
      
      await fetchOne(
        `DELETE FROM push_subscriptions WHERE endpoint = $1`,
        [sub.endpoint],
      );
    }
  }
}

export default router;
