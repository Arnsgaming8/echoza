import { createContext, useContext, useEffect, useMemo, ReactNode, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { apiUrl } from '../utils/api';

interface SocketContextType {
  socket: Socket | null;
  onlineUsers: string[];
  selfOnline: boolean;
  connected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  onlineUsers: [],
  selfOnline: false,
  connected: false,
});

const PRESENCE_HEARTBEAT_MS = 25_000;

/**
 * SocketContext is now the SOLE source of truth for both app-level events
 * AND online presence. It supersedes the previous dual-channel design
 * (Socket.IO + Supabase Realtime presence) — the user explicitly asked
 * for "websocket for anything that can use it" to improve accuracy.
 *
 * Presence strategy:
 *   • Server tracks `onlineUsers` + a per-user heartbeat timestamp
 *     (see server/src/socket.ts `userHeartbeats`).
 *   • Server emits `online-users` to ALL sockets on every connect or
 *     disconnect, AND on a 15s heartbeat-stale sweep.
 *   • Client emits `presence:heartbeat` every 25s while connected, and
 *     flips visibility on focus/blur (so coming back to the tab is an
 *     instant refresh of "I am here").
 *   • Server treats any user with no heartbeat for 60s as offline and
 *     force-disconnects their sockets to evict them.
 *
 * Previous Supabase Realtime presence has been removed:
 *   • One fewer websocket connection per client (was 2 → 1).
 *   • Online state survives Supabase free-tier pauses / DB-paused.
 *   • No more "presence channel still alive after socket is dead"
 *     ghost-online bug (commit history mentions this regression).
 *
 * iOS PWA background caveat: when iOS Safari suspends the JS context for
 * more than ~30s, the heartbeat loop stops. The service worker has a
 * 1s keep-alive that POSTs to /api/heartbeat every second while the SW
 * is alive — that's enough to keep the SW (and the user's heartbeat
 * emulation in the SW) from being garbage-collected. For precise
 * "stay-online while backgrounded" behavior in the PWA, the SW relays
 * user-agent intent via the postMessage bridge; the Socket.IO-level
 * heartbeat is best-effort within the foregrounded lifetime.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, user, isAuthenticated } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [selfOnline, setSelfOnline] = useState(false);
  const [connected, setConnected] = useState(false);

  // Main effect: establish Socket.IO connection. Narrow deps so profile
  // updates don't tear this down.
  useEffect(() => {
    if (!isAuthenticated || !token || !user?.id) {
      setSocket(null);
      setConnected(false);
      setSelfOnline(false);
      setOnlineUsers([]);
      return;
    }

    let cancelled = false;

    const newSocket = io(apiUrl('/'), {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      if (cancelled) return;
      setConnected(true);
      setSelfOnline(true);
      setSocket(newSocket);
      // Send an immediate presence beat so the server's freshness timer
      // doesn't evict us during the 25 s gap before the first interval
      // fires. Idempotent — the handler updates a Map.
      newSocket.emit('presence:heartbeat', {
        hidden: typeof document !== 'undefined' && document.hidden,
        online: true,
      });
    });

    newSocket.on('disconnect', () => {
      if (cancelled) return;
      setConnected(false);
      setSelfOnline(false);
    });

    // Server sends the full online-users map on every connect / disconnect
    // and on heartbeat-stale evictions. REPLACE the local list — partial
    // merges previously caused "stuck online" ghosts when disconnect was
    // missed. Source of truth is the server's onlineUsers registry.
    newSocket.on('online-users', (userIds: string[]) => {
      if (cancelled) return;
      setOnlineUsers(Array.isArray(userIds) ? userIds : []);
    });

    // 25s presence heartbeat. While the socket is open this keeps our
    // freshness timestamp on the server below the 60s eviction threshold.
    // We do NOT pause on document.hidden — "in another tab" is still
    // genuinely online. We also re-beat on visibility flip so the moment
    // the user comes back to Echoza, the server-side freshness is fresh.
    const heartbeat = () => {
      if (!newSocket.connected || cancelled) return;
      newSocket.emit('presence:heartbeat', {
        hidden: typeof document !== 'undefined' && document.hidden,
        online: true,
      });
    };
    let lastHidden = typeof document !== 'undefined' ? document.hidden : false;
    const handleVisibilityChange = () => {
      if (cancelled || typeof document === 'undefined') return;
      if (document.hidden !== lastHidden) {
        lastHidden = document.hidden;
        heartbeat();
        setSelfOnline(!document.hidden);
      }
    };
    const interval = setInterval(heartbeat, PRESENCE_HEARTBEAT_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // Service-worker → client presence relay. sw.js posts
    // { type: 'presence:relay', ts } ~every 5s (even when the JS context
    // is suspended by iOS in the PWA background). Treat it as a heartbeat
    // proxy: if our socket is connected and alive, forward one
    // presence:heartbeat to the server. The server's 60s eviction
    // threshold is preserved.
    const onSwPresenceRelay = (event: MessageEvent) => {
      if (cancelled) return;
      if (!event.data || event.data.type !== 'presence:relay') return;
      if (!newSocket.connected) return;
      newSocket.emit('presence:heartbeat', {
        hidden: typeof document !== 'undefined' && document.hidden,
        online: true,
        via: 'sw-relay',
      });
    };
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwPresenceRelay);
    }

    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwPresenceRelay);
      }
      clearInterval(interval);
      newSocket.disconnect();
      setSocket(null);
      setConnected(false);
      setSelfOnline(false);
      setOnlineUsers([]);
    };
  }, [isAuthenticated, token, user?.id]);

  const value = useMemo<SocketContextType>(
    () => ({ socket, onlineUsers, selfOnline, connected }),
    [socket, onlineUsers, selfOnline, connected]
  );

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
