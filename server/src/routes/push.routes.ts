import { Router, Request, Response } from 'express';
import webpush from 'web-push';
import { fetchAll, fetchOne } from '../db.js';
import { verifyAccessToken } from '../auth.js';
import { getVapidKeys } from '../vapid.js';

const router = Router();

const MAX_PUSH_SUBS_PER_USER = 10;




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
  await fetchOne(
    `DELETE FROM push_subscriptions
       WHERE user_id = $1
         AND endpoint NOT IN (
           SELECT endpoint FROM push_subscriptions
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT $2
         )`,
    [decoded.userId, MAX_PUSH_SUBS_PER_USER],
  );
  res.json({ success: true });
});

router.post('/unsubscribe', async (req: Request, res: Response) => {
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

  const { endpoint } = req.body || {};
  if (!endpoint || typeof endpoint !== 'string') {
    res.status(400).json({ error: 'endpoint required' });
    return;
  }

  await fetchOne(
    `DELETE FROM push_subscriptions
       WHERE endpoint = $1 AND user_id = $2`,
    [endpoint, decoded.userId],
  );
  res.json({ success: true });
});

router.get('/subscriptions', async (req: Request, res: Response) => {
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

  const subs = await fetchAll<{ endpoint: string; p256dh: string; created_at: string }>(
    `SELECT endpoint, p256dh, created_at
       FROM push_subscriptions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
    [decoded.userId],
  );

  res.json({
    count: subs.length,
    subscriptions: subs.map(s => ({
      endpoint: s.endpoint,
      endpointPrefix: s.endpoint.slice(0, 60),
      p256dhPrefix: s.p256dh.slice(0, 16),
      created_at: s.created_at,
    })),
  });
});

router.post('/subscriptions/cleanup', async (req: Request, res: Response) => {
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

  const { keepEndpoint } = req.body || {};
  if (keepEndpoint !== undefined && (typeof keepEndpoint !== 'string' || keepEndpoint.length === 0)) {
    res.status(400).json({ error: 'keepEndpoint must be a non-empty string when provided' });
    return;
  }

  const result = keepEndpoint
    ? await fetchOne<{ deleted_count: number }>(
        `WITH deleted AS (
           DELETE FROM push_subscriptions
             WHERE user_id = $1 AND endpoint <> $2
             RETURNING 1
         )
         SELECT COUNT(*)::int AS deleted_count FROM deleted`,
        [decoded.userId, keepEndpoint],
      )
    : await fetchOne<{ deleted_count: number }>(
        `WITH deleted AS (
           DELETE FROM push_subscriptions
             WHERE user_id = $1
             RETURNING 1
         )
         SELECT COUNT(*)::int AS deleted_count FROM deleted`,
        [decoded.userId],
      );

  res.json({ success: true, deletedCount: result?.deleted_count ?? 0 });
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
  const results = await sendPushNotification(
    decoded.userId,
    'Echoza test push',
    'Notifications are working!',
    '/',
    undefined,
    { tag: 'echoza-test', data: { isTest: true } },
  );
  res.json({
    success: results.some(r => r.ok),
    subscriptionCount: subs.length,
    successCount: results.filter(r => r.ok).length,
    failureCount: results.filter(r => !r.ok).length,
    results: results.map(r => ({
      ok: r.ok,
      statusCode: r.statusCode,
      error: r.error,
      endpoint: r.endpoint.slice(0, 60) + '...',
    })),
  });
});



export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  url?: string,
  conversationId?: string,
  extra?: { tag?: string; data?: Record<string, any> },
): Promise<Array<{ endpoint: string; ok: boolean; error?: string; statusCode?: number }>> {
  console.log('[push] sending userId=', userId, 'title=', title, 'subCount lookup...');
  if (!getVapidKeys()) return [];

  const subs = await fetchAll<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth
       FROM push_subscriptions
       WHERE user_id = $1`,
    [userId],
  );
  if (!subs.length) return [];

  const payloadData = {
    title,
    body,
    url: url || '/',
    conversationId,
    ...(extra?.data || {}),
  };
  const payload = JSON.stringify(payloadData);

  const results: Array<{ endpoint: string; ok: boolean; error?: string; statusCode?: number }> = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
        { headers: { Urgency: 'high', ...(extra?.tag ? { Topic: extra.tag } : {}) } },
      );
      results.push({ endpoint: sub.endpoint, ok: true });
    } catch (err: any) {
      const statusCode = typeof err?.statusCode === 'number'
        ? err.statusCode
        : (typeof err?.status === 'number' ? err.status : undefined);
      const errorBody = err?.body || err?.message || String(err);
      console.error('[push] send failed endpoint=', sub.endpoint.slice(0, 60), 'statusCode=', statusCode, 'err=', String(errorBody).slice(0, 200));
      if (statusCode === 404 || statusCode === 410) {
        await fetchOne(
          `DELETE FROM push_subscriptions WHERE endpoint = $1`,
          [sub.endpoint],
        );
      }
      results.push({ endpoint: sub.endpoint, ok: false, error: String(errorBody).slice(0, 200), statusCode });
    }
  }

  return results;
}

export default router;
