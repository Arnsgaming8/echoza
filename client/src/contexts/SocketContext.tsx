import { createContext, useContext, useEffect, useRef, ReactNode, useState } from 'react';
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
  const socketRef = useRef<Socket | null>(null);
  const presenceRef = useRef<RealtimeChannel | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [selfOnline, setSelfOnline] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !token || !user) return;

    // Socket.IO for calls, typing, messages
    const socket = io(apiUrl('/'), {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      setConnected(true);
      setSelfOnline(true);
      socket.emit('conversations:list');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setSelfOnline(false);
    });

    socketRef.current = socket;

    // Supabase Realtime presence for online tracking
    const channel = supabase.channel('online-users');
    presenceRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setOnlineUsers(Object.keys(state));
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        setOnlineUsers(prev => [...new Set([...prev, key])]);
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        setOnlineUsers(prev => prev.filter(id => id !== key));
      });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          userId: user.id,
          username: user.username,
          avatar: user.avatar,
        });
      }
    });

    const handleVisibilityChange = () => {
      if (document.hidden) {
        channel.track({ userId: user.id, username: user.username, avatar: user.avatar, hidden: true });
      } else {
        channel.track({ userId: user.id, username: user.username, avatar: user.avatar });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleBeforeUnload = () => {
      channel.untrack();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      channel.untrack();
      supabase.removeChannel(channel);
      presenceRef.current = null;
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      setSelfOnline(false);
    };
  }, [isAuthenticated, token, user?.id, user?.username, user?.avatar]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, onlineUsers, selfOnline, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
