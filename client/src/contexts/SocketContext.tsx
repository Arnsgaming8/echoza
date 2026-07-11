import { createContext, useContext, useEffect, useMemo, useRef, ReactNode, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { apiUrl } from '../utils/api';
import { supabase } from '../utils/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

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

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, user, isAuthenticated } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [selfOnline, setSelfOnline] = useState(false);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Main effect: establish Socket.IO connection + Supabase Realtime presence
  // channel. Narrow deps so profile updates don't tear this down.
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
    });

    newSocket.on('disconnect', () => {
      if (cancelled) return;
      setConnected(false);
      setSelfOnline(false);
    });

    // Server sends the full online-users map on every connect — instant initial
    // state before the Realtime presence channel syncs.
    newSocket.on('online-users', (userIds: string[]) => {
      if (cancelled) return;
      setOnlineUsers(userIds);
    });

    // Supabase Realtime presence is the single source of truth for online status
    const channel = supabase.channel('online-users');
    channelRef.current = channel;
    let lastHidden = document.hidden;

    channel
      // SYNC: REPLACE onlineUsers with the server-authoritative presence
      // state. Supabase's 'sync' event always reflects the full truth after
      // any presence change (track/untrack/leave), so this is the moment
      // defunct users correctly drop out of the sidebar. Without REPLACE,
      // a user who went offline would linger in the local UI until a
      // hard refresh, because the merge-only handler never removes
      // anything.
      .on('presence', { event: 'sync' }, () => {
        if (cancelled) return;
        const state = channel.presenceState();
        const ids = new Set<string>();
        for (const row of Object.values(state).flat()) {
          const uid = (row as any)?.userId;
          if (uid) ids.add(uid);
        }
        setOnlineUsers([...ids]);
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        // Optimistic add so the green dot pops within ms of a friend
        // coming online, even before the next sync lands.
        if (cancelled) return;
        const ids = newPresences.map((p: any) => p?.userId).filter(Boolean);
        if (!ids.length) return;
        setOnlineUsers(prev => [...new Set([...prev, ...ids])]);
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        // Optimistic remove so the green dot drops within ms of a friend
        // going offline. The previous flicker-guard (skipping the removal
        // if presenceState still showed them) is no longer needed now
        // that SYNC replaces the full list as the authoritative source —
        // and that guard was the root cause of users staying "online"
        // forever instead of going offline on disconnect.
        if (cancelled) return;
        const ids = leftPresences.map((p: any) => p?.userId).filter(Boolean);
        if (!ids.length) return;
        setOnlineUsers(prev => prev.filter(id => !ids.includes(id)));
      });

    channel.subscribe((status) => {
      if (cancelled || status !== 'SUBSCRIBED') return;
      channel.track({
        userId: user.id,
        username: user.username,
        hidden: document.hidden,
      });
    });

    const handleVisibilityChange = () => {
      // Only re-track when the hidden flag actually FLIPS — track() on every
      // visibility tick was the dominant source of presence sync flicker.
      if (cancelled || document.hidden === lastHidden) return;
      lastHidden = document.hidden;
      channel.track({
        userId: user.id,
        username: user.username,
        hidden: document.hidden,
      });
      if (document.hidden) setSelfOnline(false);
      else setSelfOnline(true);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
      newSocket.disconnect();
      setSocket(null);
      setConnected(false);
      setSelfOnline(false);
      setOnlineUsers([]);
    };
  }, [isAuthenticated, token, user?.id]);

  // Re-track presence when the user edits their profile (avatar / username) so
  // other connected users see the updated meta. Doesn't tear down the socket.
  useEffect(() => {
    if (!user?.id || !channelRef.current) return;
    channelRef.current.track({
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      hidden: typeof document !== 'undefined' && document.hidden,
    }).catch(() => { /* channel may be tearing down, ignore */ });
  }, [user?.id, user?.username, user?.avatar]);

  // Memoize the context value so consumers don't re-render unless one of the
  // four pieces of state actually changed in identity (not just reference).
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
