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
      .on('presence', { event: 'sync' }, () => {
        if (cancelled) return;
        const state = channel.presenceState();
        const ids = Object.values(state)
          .flat()
          .map((p: any) => p?.userId)
          .filter(Boolean);
        setOnlineUsers(prev => {
          // Merge with existing state instead of replacing — the socket
          // online-users event already gave us the full list.  Realtime
          // presence sync should only ADD users we haven't seen yet.
          // Without this merge, the first sync after track() (which only
          // contains the current user) would overwrite everyone else.
          if (ids.length === 0) return prev;
          const merged = new Set([...prev, ...ids]);
          return [...merged];
        });
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        if (cancelled) return;
        const ids = newPresences.map((p: any) => p?.userId).filter(Boolean);
        if (!ids.length) return;
        setOnlineUsers(prev => [...new Set([...prev, ...ids])]);
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        if (cancelled) return;
        // A single 'leave' doesn't necessarily mean the user is offline —
        // they may have another tab open, or StrictMode may be tearing
        // down and re-mounting this same channel. Validate against the
        // current presence state before removing anyone, so the green
        // dot doesn't flicker on first visit.
        const current = channel.presenceState();
        const stillPresent = new Set<string>();
        for (const row of Object.values(current).flat()) {
          const uid = (row as any)?.userId;
          if (uid) stillPresent.add(uid);
        }
        const ids = leftPresences
          .map((p: any) => p?.userId)
          .filter((uid: string | undefined): uid is string =>
            Boolean(uid) && !stillPresent.has(uid!)
          );
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
