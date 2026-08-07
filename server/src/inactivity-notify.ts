import { fetchAll, fetchOne } from './db.js';
import { sendPushNotification } from './routes/push.routes.js';
import { SYSTEM_ACCOUNT_USERNAME } from './bootstrap.js';

export const INACTIVITY_NOTIFY_DAYS = 7;
export const INACTIVITY_NOTIFY_INTERVAL_MS = 60 * 60 * 1000;

export async function runInactivityNotifySweep(): Promise<number> {
  const days = INACTIVITY_NOTIFY_DAYS;
  const candidates = await fetchAll<{ id: string }>(
    `SELECT DISTINCT p.id
       FROM profiles p
       JOIN push_subscriptions ps ON ps.user_id = p.id
      WHERE p.is_system = FALSE
        AND (
          (p.last_sign_in_at IS NOT NULL
            AND p.last_sign_in_at < NOW() - ($1 || ' days')::interval)
          OR (p.last_sign_in_at IS NULL
            AND p.created_at < NOW() - ($1 || ' days')::interval)
        )
        AND (
          p.last_inactive_notified_at IS NULL
          OR p.last_inactive_notified_at < COALESCE(p.last_sign_in_at, p.created_at)
        )`,
    [String(days)],
  );

  let notified = 0;
  for (const cand of candidates) {
    const results = await sendPushNotification(
      cand.id,
      SYSTEM_ACCOUNT_USERNAME,
      "You haven't been on Echoza in a while — your friends miss you! Come say hi.",
      '/',
      undefined,
      { tag: 'echoza-inactive' },
    );
    if (results.some(r => r.ok)) {
      await fetchOne(
        `UPDATE profiles SET last_inactive_notified_at = NOW() WHERE id = $1`,
        [cand.id],
      );
      notified++;
    }
  }
  if (notified > 0) {
    console.log(`[inactivity-notify] sweep: notified=${notified}`);
  }
  return notified;
}

let notifyInterval: NodeJS.Timeout | null = null;
export function startInactivityNotifySweeper(): void {
  if (notifyInterval) return;
  setTimeout(() => {
    void runInactivityNotifySweep();
  }, 10_000);
  notifyInterval = setInterval(() => {
    void runInactivityNotifySweep();
  }, INACTIVITY_NOTIFY_INTERVAL_MS);
  console.log(
    `[inactivity-notify] sweeper started, interval=${INACTIVITY_NOTIFY_INTERVAL_MS}ms (${INACTIVITY_NOTIFY_DAYS}d threshold)`,
  );
}
