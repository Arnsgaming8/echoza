















export interface OutboxEntry {
  
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
    
    if (entries.length > 1) safeWrite(entries.slice(-50));
  }
}

export function loadOutbox(): OutboxEntry[] {
  return safeRead();
}

export function saveOutbox(entries: OutboxEntry[]): void {
  
  
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
  
  
  
  void id;
}
