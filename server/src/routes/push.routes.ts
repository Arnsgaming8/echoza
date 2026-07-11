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
