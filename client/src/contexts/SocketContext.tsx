import { createContext, useContext, useEffect, useRef, ReactNode, useState } from 'react';
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

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, user, isAuthenticated } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [selfOnline, setSelfOnline] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !token) return;

    const socket = io(apiUrl('/'), {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      setConnected(true);
      setSelfOnline(true);
      socket.emit('user:getOnline');
      socket.emit('conversations:list');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setSelfOnline(false);
    });

    socket.on('user:onlineList', (users: { userId: string }[]) => {
      setOnlineUsers(users.map(u => u.userId));
    });

    socket.on('user:online', ({ userId }: { userId: string }) => {
      setOnlineUsers(prev => [...new Set([...prev, userId])]);
    });

    socket.on('user:offline', ({ userId }: { userId: string }) => {
      setOnlineUsers(prev => prev.filter(id => id !== userId));
    });

    socketRef.current = socket;

    let hbInterval: ReturnType<typeof setInterval> | undefined;
    let onlinePoll: ReturnType<typeof setInterval> | undefined;

    const startIntervals = () => {
      clearInterval(hbInterval);
      clearInterval(onlinePoll);
      hbInterval = setInterval(() => socket.emit('user:heartbeat'), 3000);
      onlinePoll = setInterval(() => socket.emit('user:getOnline'), 15000);
    };

    const stopIntervals = () => {
      clearInterval(hbInterval);
      clearInterval(onlinePoll);
      hbInterval = undefined;
      onlinePoll = undefined;
    };

    startIntervals();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopIntervals();
        socket.emit('user:going-offline');
      } else {
        socket.emit('user:getOnline');
        socket.emit('user:heartbeat');
        startIntervals();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleBeforeUnload = () => {
      stopIntervals();
      socket.emit('user:going-offline');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      stopIntervals();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      setSelfOnline(false);
    };
  }, [isAuthenticated, token, user?.id]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, onlineUsers, selfOnline, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
