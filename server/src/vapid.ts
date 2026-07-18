import webpush from 'web-push';
import { fetchOne, query } from './db.js';
import { env } from './env.js';

const KEYS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS public.vapid_keys (
    id TEXT PRIMARY KEY DEFAULT 'current',
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;

let cached: { publicKey: string; privateKey: string } | null = null;
let initPromise: Promise<void> | null = null;

export function getVapidKeys(): { publicKey: string; privateKey: string } | null {
  return cached;
}

export function isVapidConfigured(): boolean {
  return cached !== null;
}

export function initVapid(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function doInit(): Promise<void> {
  let resolved: { publicKey: string; privateKey: string } | null = null;
  let resolvedFrom: 'env' | 'db' | 'generated' | null = null;

  try {
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      resolved = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
      resolvedFrom = 'env';
      console.log('[vapid] using env-provided keys (VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY)');
    } else {
      try {
        await query(KEYS_TABLE_SQL);
      } catch (err: any) {
        console.warn('[vapid] CREATE TABLE IF NOT EXISTS failed:', err?.message || err);
      }

      try {
        const row = await fetchOne<{ public_key: string; private_key: string }>(
          `SELECT public_key, private_key FROM public.vapid_keys WHERE id = 'current' LIMIT 1`,
        );
        if (row?.public_key && row.private_key) {
          resolved = { publicKey: row.public_key, privateKey: row.private_key };
          resolvedFrom = 'db';
          console.log('[vapid] using persisted keys from public.vapid_keys');
        }
      } catch (err: any) {
        console.warn('[vapid] DB read failed:', err?.message || err);
      }

      if (!resolved) {
        const generated = webpush.generateVAPIDKeys();
        resolved = { publicKey: generated.publicKey, privateKey: generated.privateKey };
        resolvedFrom = 'generated';
        console.log('[vapid] auto-generated fresh VAPID keys');
      }
    }
  } catch (outerErr: any) {
    console.error('[vapid] key resolution threw:', outerErr?.message || outerErr);
  }

  if (!resolved) {
    console.warn('[vapid] push notifications will be silently dropped — no VAPID keys resolvable');
    return;
  }

  cached = resolved;
  try {
    webpush.setVapidDetails('mailto:echoza@app.com', resolved.publicKey, resolved.privateKey);
  } catch (err: any) {
    console.warn('[vapid] setVapidDetails failed (in-memory keys still usable):', err?.message || err);
  }

  if (resolvedFrom === 'generated') {
    try {
      await query(
        `INSERT INTO public.vapid_keys (id, public_key, private_key)
           VALUES ('current', $1, $2)
         ON CONFLICT (id) DO UPDATE
           SET public_key = EXCLUDED.public_key,
               private_key = EXCLUDED.private_key,
               created_at = NOW()`,
        [resolved.publicKey, resolved.privateKey],
      );
      console.log('[vapid] persisted generated keys to public.vapid_keys');
    } catch (err: any) {
      console.warn('[vapid] generated-key persistence failed (push still works in-memory for this process):', err?.message || err);
    }
  }
}
