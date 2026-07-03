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
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
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
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = undefined;
      }
      setConnected(true);
      setSelfOnline(true);
      socket.emit('user:getOnline');
      socket.emit('conversations:list');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      offlineTimerRef.current = setTimeout(() => {
        setSelfOnline(false);
      }, 2000);
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

    const hbInterval = setInterval(() => {
      socket.emit('user:heartbeat');
    }, 3000);

    const handleBeforeUnload = () => {
      socket.emit('user:going-offline');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearInterval(hbInterval);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
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
