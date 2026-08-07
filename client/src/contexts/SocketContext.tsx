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

const PRESENCE_HEARTBEAT_MS = 15_000;


export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, user, isAuthenticated } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [selfOnline, setSelfOnline] = useState(false);
  const [connected, setConnected] = useState(false);

  
  
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



    
    
    
    
    
    newSocket.on('online-users', (userIds: string[]) => {
      if (cancelled) return;
      setOnlineUsers(Array.isArray(userIds) ? userIds : []);
      if (user?.id) {
        setSelfOnline(userIds.includes(user.id));
      }
    });

    
    
    
    
    
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
