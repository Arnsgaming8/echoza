import { Router, Request, Response } from 'express';
import webpush from 'web-push';
import { env } from '../env.js';
import { fetchAll, fetchOne } from '../db.js';
import { verifyAccessToken } from '../auth.js';

const router = Router();

// VAPID is configured once at boot. If missing, every send is a silent
// no-op (we never want to 500 on a push miss).
const vapidConfigured =
  !!env.VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY;
if (vapidConfigured) {
  webpush.setVapidDetails('mailto:echoza@app.com', env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

// ── /vapid-public-key ────────────────────────────────────────────────────
router.get('/vapid-public-key', (_req: Request, res: Response) => {
  // Single source of truth for the client. Eliminates silent-failure
  // mode where client hardcodes a key that drifts from server env.
  if (!env.VAPID_PUBLIC_KEY) {
    res.status(503).json({ error: 'VAPID not configured on server' });
    return;
  }
  res.json({ publicKey: env.VAPID_PUBLIC_KEY });
});

// ── /subscribe ───────────────────────────────────────────────────────────
// Idempotent: drop any prior subscription with the same endpoint that
// belongs to ANOTHER user, then upsert for THIS user. (iPhone can change
// its subscription endpoint on reinstall, so two devices from the same
// user can race here.)
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

// ── /test ─────────────────────────────────────────────────────────────────
// Self-test push. Confirms end-to-end push delivery to this user's
// devices; idempotent auth requirement identical to /subscribe.
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
  if (!vapidConfigured) {
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

// ── sendPushNotification — exported helper used elsewhere ───────────────
/**
 * Send a Web Push notification to every device this user has subscribed.
 * Best-effort: web-push errors quietly drop the stale subscription so a
 * failed endpoint doesn't keep firing forever.
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  url?: string,
  conversationId?: string,
  extra?: { tag?: string; data?: Record<string, any> },
): Promise<void> {
  if (!vapidConfigured) return;

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
      // Quiet tombstone: failed endpoints get dropped so we don't keep
      // calling them. Real users will re-subscribe on their next install.
      await fetchOne(
        `DELETE FROM push_subscriptions WHERE endpoint = $1`,
        [sub.endpoint],
      );
    }
  }
}

export default router;
