import { Router, Request, Response } from 'express';
import webpush from 'web-push';
import { supabase } from '../supabase.js';
import { verifyAccessToken } from '../auth.js';

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

router.get('/vapid-public-key', (_req: Request, res: Response) => {
  // Single source of truth for the client. Eliminates the silent-failure
  // mode where the client hardcodes a key that drifts from the server's
  // VAPID_PUBLIC_KEY env var — push.subscribe() succeeds in-browser but
  // webpush.sendNotification() rejects with BadJwt on the server.
  if (!publicKey) {
    res.status(503).json({ error: 'VAPID not configured on server' });
    return;
  }
  res.json({ publicKey });
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

  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }

  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .neq('user_id', decoded.userId);

  await supabase
    .from('push_subscriptions')
    .insert({
      user_id: decoded.userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });

  res.json({ success: true });
});

router.post('/test', async (req: Request, res: Response) => {
  // Self-test endpoint — confirms end-to-end push delivery from server to
  // this user's subscribed device. Useful for verifying iOS PWA installs
  // actually receive notifications (the user-installed PWA might have a
  // working subscribe but a stale endpoint, or permission might be revoked
  // silently). Idempotent: requires the same auth as /subscribe.
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

  if (!publicKey || !privateKey) {
    res.status(503).json({ error: 'VAPID not configured on server' });
    return;
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('user_id', decoded.userId);

  if (!subs?.length) {
    res.json({ success: false, reason: 'no_subscriptions' });
    return;
  }

  await sendPushNotification(
    decoded.userId,
    'Echoza test push',
    'Notifications are working!',
    '/',
    undefined,
    { tag: 'echoza-test', data: { isTest: true } }
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
) {
  if (!publicKey || !privateKey) return;

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subs?.length) return;

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
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', sub.endpoint);
    }
  }
}

export default router;
