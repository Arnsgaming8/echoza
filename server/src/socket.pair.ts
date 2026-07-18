import { Server as SocketServer, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { fetchOne } from './db.js';
import { signAccessToken, signRefreshToken, recordDeviceFingerprint } from './auth.js';
import { env } from './env.js';

interface AuthSocket extends Socket {
  userId?: string;
  username?: string;
  avatar?: string;
  pairSessionId?: string;
  pairGuestUa?: string | null;
  pairGuestIp?: string | null;
}

interface PairSession {
  id: string;
  code: string;
  ownerUserId: string;
  ownerSocketId: string;
  guestSocketId: string | null;
  guestUa: string | null;
  guestIp: string | null;
  status: 'pending' | 'awaiting_approval' | 'approved' | 'denied' | 'cancelled' | 'expired';
  attempts: number;
  attemptsWindowResetAt: number;
  createdAt: number;
  expiresAt: number;
}

const pairSessions = new Map<string, PairSession>();

const PAIR_TTL_MS = 5 * 60 * 1000;
const PAIR_SWEEP_MS = 30 * 1000;
const PAIR_MAX_ATTEMPTS = 5;
const PAIR_ATTEMPT_WINDOW_MS = 60 * 1000;
const CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generatePairCode(): string {
  let code = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

function purgeExpiredPairSessions(): number {
  const now = Date.now();
  let purged = 0;
  for (const [id, s] of Array.from(pairSessions.entries())) {
    if (s.expiresAt < now) {
      pairSessions.delete(id);
      purged++;
    }
  }
  return purged;
}

function sanitizeDeviceLabel(ua: string | null, ip: string | null): string {
  const safeUa = (ua || '').replace(/[^\x20-\x7e]/g, '').slice(0, 80) || 'Unknown browser';
  const safeIp = (ip || 'unknown-ip').replace(/[^\x20-\x7e]/g, '').slice(0, 45);
  return `${safeUa} (${safeIp})`;
}

function pairBaseUrlFromHandshake(socket: Socket): string {
  if (env.PAIR_BASE_URL) return env.PAIR_BASE_URL;
  const headers = socket.handshake.headers || {};
  const host = (headers['x-forwarded-host'] as string) || (headers.host as string) || '';
  const proto =
    ((headers['x-forwarded-proto'] as string) || '')
      .toString()
      .split(',')[0]
      .trim() || (headers.referer && (headers.referer as string).startsWith('http://') ? 'http' : 'https');
  return host ? `${proto}://${host}` : '';
}

export function applyPairMiddleware(io: SocketServer): void {
  io.use(async (socket: AuthSocket, next) => {
    const auth = (socket.handshake.auth || {}) as { token?: unknown; pairSessionId?: unknown };
    const tokenPresent = typeof auth.token === 'string' && auth.token.length > 0;
    const pairIdRaw = typeof auth.pairSessionId === 'string' ? auth.pairSessionId : '';

    if (!pairIdRaw || tokenPresent) {
      return next();
    }

    purgeExpiredPairSessions();
    const session = pairSessions.get(pairIdRaw);
    if (!session) return next(new Error('Pair session not found'));
    if (session.expiresAt < Date.now()) {
      pairSessions.delete(pairIdRaw);
      return next(new Error('Pair session expired'));
    }
    if (session.status !== 'pending' && session.status !== 'awaiting_approval') {
      return next(new Error('Pair session no longer accepting connections'));
    }

    socket.pairSessionId = pairIdRaw;
    socket.pairGuestUa = ((socket.handshake.headers['user-agent'] as string) || '').slice(0, 200) || null;
    socket.pairGuestIp = socket.handshake.address || null;
    next();
  });
}

function setupPairGuestSocket(io: SocketServer, socket: AuthSocket): void {
  const sessionId = socket.pairSessionId!;
  const session = pairSessions.get(sessionId);
  if (!session) {
    socket.emit('pair:connected', { ok: false, reason: 'session_not_found' });
    socket.disconnect(true);
    return;
  }
  session.guestSocketId = socket.id;
  session.guestUa = socket.pairGuestUa ?? session.guestUa;
  session.guestIp = socket.pairGuestIp ?? session.guestIp;

  socket.emit('pair:connected', {
    ok: true,
    sessionId,
    expiresAt: session.expiresAt,
    msRemaining: Math.max(0, session.expiresAt - Date.now()),
  });

  socket.on('pair:code-submit', ({ code }: { code: string }) => {
    handleCodeSubmit(io, socket, sessionId, code).catch((err) => {
      console.error('[pair:code-submit]', err?.message || err);
    });
  });

  socket.on('disconnect', () => {
    const s = pairSessions.get(sessionId);
    if (s && s.guestSocketId === socket.id) {
      s.guestSocketId = null;
    }
  });
}

async function handleCodeSubmit(
  io: SocketServer,
  socket: AuthSocket,
  sessionId: string,
  rawCode: string,
): Promise<void> {
  const now = Date.now();
  const s = pairSessions.get(sessionId);
  if (!s) {
    socket.emit('pair:result', { ok: false, reason: 'session_not_found' });
    socket.disconnect(true);
    return;
  }
  if (s.status !== 'pending') {
    socket.emit('pair:result', { ok: false, reason: 'not_pending', currentStatus: s.status });
    return;
  }
  if (s.expiresAt < now) {
    pairSessions.delete(sessionId);
    socket.emit('pair:result', { ok: false, reason: 'expired' });
    socket.disconnect(true);
    return;
  }

  if (now > s.attemptsWindowResetAt) {
    s.attempts = 0;
    s.attemptsWindowResetAt = now + PAIR_ATTEMPT_WINDOW_MS;
  }
  s.attempts += 1;
  if (s.attempts > PAIR_MAX_ATTEMPTS) {
    pairSessions.delete(sessionId);
    socket.emit('pair:result', { ok: false, reason: 'too_many_attempts' });
    socket.disconnect(true);
    return;
  }

  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  if (code.length !== 6 || code !== s.code) {
    const remaining = Math.max(0, PAIR_MAX_ATTEMPTS - s.attempts);
    socket.emit('pair:code-error', { reason: 'invalid', remaining });
    console.log(JSON.stringify({
      t: 'pair', event: 'code-invalid', sessionId,
      guestIp: s.guestIp, attemptsRemaining: remaining,
    }));
    return;
  }

  s.status = 'awaiting_approval';
  const deviceLabel = sanitizeDeviceLabel(s.guestUa, s.guestIp);

  const ownerSocket = io.sockets.sockets.get(s.ownerSocketId) as AuthSocket | undefined;
  if (ownerSocket) {
    ownerSocket.emit('pair:request', { sessionId, deviceLabel, waitMs: 60_000 });
  }

  socket.emit('pair:code-accepted', { sessionId });
  console.log(JSON.stringify({
    t: 'pair', event: 'code-accepted', sessionId,
    ownerUserId: s.ownerUserId, guestIp: s.guestIp,
  }));
}
function handlePairStart(io: SocketServer, socket: AuthSocket): void {
  const userId = socket.userId!;
  purgeExpiredPairSessions();
  const sessionId = uuidv4();
  const code = generatePairCode();
  const now = Date.now();
  const session: PairSession = {
    id: sessionId,
    code,
    ownerUserId: userId,
    ownerSocketId: socket.id,
    guestSocketId: null,
    guestUa: null,
    guestIp: null,
    status: 'pending',
    attempts: 0,
    attemptsWindowResetAt: now + PAIR_ATTEMPT_WINDOW_MS,
    createdAt: now,
    expiresAt: now + PAIR_TTL_MS,
  };
  pairSessions.set(sessionId, session);
  const pairingUrl = `${pairBaseUrlFromHandshake(socket)}/pair?session=${sessionId}`;
  socket.emit('pair:started', {
    sessionId,
    code,
    pairingUrl,
    expiresAt: session.expiresAt,
  });
  console.log(JSON.stringify({
    t: 'pair', event: 'start', sessionId,
    ownerUserId: userId, expiresAt: session.expiresAt,
  }));
}
async function handlePairApprove(
  io: SocketServer,
  socket: AuthSocket,
  sessionId: string,
): Promise<void> {
  const userId = socket.userId!;
  const s = pairSessions.get(sessionId);
  if (!s || s.ownerUserId !== userId) {
    socket.emit('pair:completed', { ok: false, sessionId, reason: 'session_not_found' });
    return;
  }
  if (s.status !== 'awaiting_approval') {
    socket.emit('pair:completed', { ok: false, sessionId, reason: 'invalid_state', currentStatus: s.status });
    return;
  }

  s.status = 'approved';

  try {
    const profile = await fetchOne<{ username: string; avatar: string; last_sign_in_at: string | null }>(
      `SELECT username, avatar, last_sign_in_at FROM profiles WHERE id = $1`,
      [s.ownerUserId],
    );
    if (!profile) {
      pairSessions.delete(sessionId);
      socket.emit('pair:completed', { ok: false, sessionId, reason: 'user_no_longer_exists' });
      return;
    }

    const refresh = signRefreshToken(s.ownerUserId);
    await fetchOne(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
      [s.ownerUserId, refresh.hash, refresh.expiresAt],
    );
    const access = signAccessToken(s.ownerUserId, profile.username, profile.last_sign_in_at);

    const guestSocket = s.guestSocketId
      ? (io.sockets.sockets.get(s.guestSocketId) as AuthSocket | undefined)
      : undefined;
    if (guestSocket) {
      guestSocket.emit('pair:result', {
        ok: true,
        access_token: access,
        refresh_token: refresh.plaintext,
        user: {
          id: s.ownerUserId,
          username: profile.username,
          avatar: profile.avatar,
          online: false,
        },
      });
    }

    if (s.guestUa) {
      try {
        await recordDeviceFingerprint(s.ownerUserId, `pair:${s.id}`, s.guestUa);
      } catch (err: any) {
        console.warn('[pair:approve] device fingerprint skipped:', err?.message || err);
      }
    }

    socket.emit('pair:completed', { ok: true, sessionId });
    console.log(JSON.stringify({
      t: 'pair', event: 'approved', sessionId,
      ownerUserId: s.ownerUserId, guestIp: s.guestIp,
    }));

    setTimeout(() => {
      if (s.guestSocketId) {
        const gs = io.sockets.sockets.get(s.guestSocketId);
        gs?.disconnect(true);
      }
      pairSessions.delete(sessionId);
    }, 2_000);
  } catch (err: any) {
    console.error('[pair:approve] error', err?.message || err);
    s.status = 'pending';
    socket.emit('pair:completed', { ok: false, sessionId, reason: 'server_error' });
  }
}

function handlePairDeny(io: SocketServer, socket: AuthSocket, sessionId: string): void {
  const userId = socket.userId!;
  const s = pairSessions.get(sessionId);
  if (!s || s.ownerUserId !== userId) return;
  if (s.status === 'approved') return;
  s.status = 'denied';
  const guestSocket = s.guestSocketId
    ? (io.sockets.sockets.get(s.guestSocketId) as AuthSocket | undefined)
    : undefined;
  if (guestSocket) {
    guestSocket.emit('pair:result', { ok: false, reason: 'denied' });
  }
  socket.emit('pair:completed', { ok: false, sessionId, denied: true });
  console.log(JSON.stringify({ t: 'pair', event: 'deny', sessionId, ownerUserId: s.ownerUserId }));
  setTimeout(() => pairSessions.delete(sessionId), 2_000);
}

function handlePairCancel(io: SocketServer, socket: AuthSocket, sessionId: string): void {
  const userId = socket.userId!;
  const s = pairSessions.get(sessionId);
  if (!s || s.ownerUserId !== userId) return;
  const guestSocket = s.guestSocketId
    ? (io.sockets.sockets.get(s.guestSocketId) as AuthSocket | undefined)
    : undefined;
  if (guestSocket) {
    guestSocket.emit('pair:result', { ok: false, reason: 'cancelled' });
  }
  pairSessions.delete(sessionId);
  socket.emit('pair:completed', { ok: false, sessionId, cancelled: true });
  console.log(JSON.stringify({ t: 'pair', event: 'cancel', sessionId, ownerUserId: s.ownerUserId }));
}

export function registerPairHandlersForSocket(io: SocketServer, socket: AuthSocket): void {
  if (socket.pairSessionId) {
    setupPairGuestSocket(io, socket);
    return;
  }
  if (!socket.userId) return;

  socket.on('pair:start', () => {
    try { handlePairStart(io, socket); } catch (err: any) { console.error('[pair:start]', err?.message || err); }
  });
  socket.on('pair:approve', async ({ sessionId }: { sessionId: string }) => {
    await handlePairApprove(io, socket, String(sessionId || ''));
  });
  socket.on('pair:deny', ({ sessionId }: { sessionId: string }) => {
    handlePairDeny(io, socket, String(sessionId || ''));
  });
  socket.on('pair:cancel', ({ sessionId }: { sessionId: string }) => {
    handlePairCancel(io, socket, String(sessionId || ''));
  });
}

export function startPairSessionSweeper(): NodeJS.Timeout {
  return setInterval(() => {
    const n = purgeExpiredPairSessions();
    if (n > 0) console.log(`[pair] swept ${n} expired sessions`);
  }, PAIR_SWEEP_MS);
}

