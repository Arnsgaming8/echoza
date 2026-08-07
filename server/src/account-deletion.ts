import { fetchAll, tx } from './db.js';

export const ACCOUNT_INACTIVITY_DAYS = 14;

export const ACCOUNT_DELETION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let emitFn: ((userId: string, event: string, data: any) => void) | null = null;

export function setNotifyDeletedAccount( fn: (userId: string, event: string, data: any) => void ): void {
  emitFn = fn;
}

export async function touchLastSignIn(userId: string): Promise<void> {
  try {
    await fetchAll(
      `UPDATE profiles SET last_sign_in_at = NOW() WHERE id = $1`,
      [userId],
    );
  } catch (err: any) {
    console.warn('[account-deletion] touchLastSignIn failed:', err?.message || err);
  }
}

export interface AccountDeletionResult {
  deleted: number;
  orphanConversations: number;
}

export async function runAccountDeletionSweep(): Promise<AccountDeletionResult> {
  const days = ACCOUNT_INACTIVITY_DAYS;
  let deleted = 0;
  let orphanConversations = 0;
  try {
    await tx(async (client) => {
      const cand = await client.query<{ id: string }>(
        `SELECT id FROM profiles
          WHERE is_system = FALSE
            AND (
              (last_sign_in_at IS NOT NULL
                AND last_sign_in_at < NOW() - ($1 || ' days')::interval)
              OR (last_sign_in_at IS NULL
                AND created_at < NOW() - ($1 || ' days')::interval)
            )`,
        [String(days)],
      );
      const candidateIds = cand.rows.map(r => r.id);
      if (candidateIds.length === 0) return;

      const affectedRows = await client.query<{
        conversation_id: string;
        remaining_user_id: string | null;
      }>(
        `SELECT p.conversation_id,
                (SELECT p2.user_id FROM participants p2
                  WHERE p2.conversation_id = p.conversation_id
                    AND NOT (p2.user_id = ANY($1::uuid[]))
                  LIMIT 1) AS remaining_user_id
           FROM participants p
           JOIN conversations c ON c.id = p.conversation_id AND c.is_group = FALSE
          WHERE p.user_id = ANY($1::uuid[])`,
        [candidateIds],
      );

      const notifyMap = new Map<string, string[]>();
      for (const row of affectedRows.rows) {
        if (row.remaining_user_id) {
          const arr = notifyMap.get(row.remaining_user_id) || [];
          arr.push(row.conversation_id);
          notifyMap.set(row.remaining_user_id, arr);
        }
      }

      const convR = await client.query(
        `DELETE FROM conversations
          WHERE NOT EXISTS (
            SELECT 1 FROM participants p
              WHERE p.conversation_id = conversations.id
                AND NOT (p.user_id = ANY($1::uuid[]))
          )`,
        [candidateIds],
      );
      orphanConversations = convR.rowCount ?? 0;

      const profR = await client.query(
        `DELETE FROM profiles WHERE id = ANY($1::uuid[])`,
        [candidateIds],
      );
      deleted = profR.rowCount ?? 0;

      if (emitFn && notifyMap.size > 0) {
        for (const [remainingUserId, convIds] of notifyMap) {
          for (const convId of convIds) {
            emitFn(remainingUserId, 'conversation:deleted', { conversationId: convId });
          }
        }
      }
    });
  } catch (err: any) {
    console.error('[account-deletion] sweep failed:', err?.message || err);
    return { deleted, orphanConversations };
  }
  if (deleted > 0) {
    console.log(
      `[account-deletion] sweep: users_deleted=${deleted}, orphan_conversations_removed=${orphanConversations}`,
    );
  }
  return { deleted, orphanConversations };
}

let sweepInterval: NodeJS.Timeout | null = null;
export function startAccountDeletionSweeper(): void {
  if (sweepInterval) return;
  setTimeout(() => {
    void runAccountDeletionSweep();
  }, 5_000);
  sweepInterval = setInterval(() => {
    void runAccountDeletionSweep();
  }, ACCOUNT_DELETION_SWEEP_INTERVAL_MS);
  console.log(
    `[account-deletion] sweeper started, interval=${ACCOUNT_DELETION_SWEEP_INTERVAL_MS}ms (${ACCOUNT_INACTIVITY_DAYS}d threshold)`,
  );
}
