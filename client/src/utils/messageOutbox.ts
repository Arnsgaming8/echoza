// Persistent localStorage-backed outbox for outgoing chat messages.
//
// iOS PWA suspends JS after ~30s of background, killing the socket.
// The next message:send emit is silently lost when the JS context is
// killed and a fresh React tree remounts with no in-memory message
// queue. The outbox is the durability layer that survives the kill.
//
// On `socket.on('connect')` we drain the outbox by re-emitting each
// entry as `message:send` with its original `clientId`; the server
// echoes `clientId` back in the `message:sent` ack so the client can
// dedupe optimistic local messages against the authoritative server
// message (which has a different server-generated `id`).
//
// Capped at 100 entries (FIFO) so a user who's offline for days
// doesn't blow past iOS Safari's ~5MB localStorage quota.

export interface OutboxEntry {
  /** Client-generated UUID. Also the optimistic local message id. */
  id: string;
  content: string;
  receiverId?: string;
  groupId?: string;
  attachments?: any[];
  createdAt: string;
}

const KEY = 'echoza-message-outbox';
const MAX_ENTRIES = 100;

function safeRead(): OutboxEntry[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function safeWrite(entries: OutboxEntry[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded (very rare given FIFO cap) — drop the oldest.
    if (entries.length > 1) safeWrite(entries.slice(-50));
  }
}

export function loadOutbox(): OutboxEntry[] {
  return safeRead();
}

export function saveOutbox(entries: OutboxEntry[]): void {
  // Trim to the most recent MAX_ENTRIES so a long-offline session
  // doesn't push us over the localStorage quota on iOS Safari (~5MB).
  const trimmed = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;
  safeWrite(trimmed);
}

export function addToOutbox(entry: OutboxEntry): void {
  const current = loadOutbox();
  current.push(entry);
  saveOutbox(current);
}

export function removeFromOutbox(id: string): void {
  const filtered = loadOutbox().filter((e) => e.id !== id);
  saveOutbox(filtered);
}

export function markOutboxFailed(id: string): void {
  // Reserved for a future server-side reject path. For now, just
  // bubble the failure to the UI via a parallel `failedIds` set in
  // the caller's React state. The actual retry UI lives in Dashboard.
  void id;
}
