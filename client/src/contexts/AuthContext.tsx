import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { apiUrl } from '../utils/api';

interface User {
  id: string;
  username: string;
  avatar: string;
  online: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, refreshToken: string, user: User) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  isAuthenticated: boolean;
  authLoading: boolean;
  authGeneration: number;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
  updateUser: () => {},
  isAuthenticated: false,
  authLoading: true,
  authGeneration: 0,
});

const REFRESH_TOKEN_KEY = 'echoza-refresh-token';

async function tryRefreshSession(): Promise<{
  token: string;
  refresh_token: string;
  user: User;
} | null> {
  const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!storedRefresh) return null;
  const delays = [0, 500, 1000, 2000, 4000, 8000, 8000, 8000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
    try {
      const res = await fetch(apiUrl('/api/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: storedRefresh }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.token) return data;
      continue;
    } catch {
      continue;
    }
  }
  return null;
}

function decodeLocalUser(token: string): {
  user: User;
  isExpired: boolean;
  needsRefresh: boolean;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const payloadJson = atob(b64 + padding);
    const payload = JSON.parse(payloadJson);
    if (!payload?.sub || typeof payload.sub !== 'string') return null;
    const expMs = typeof payload.exp === 'number' && payload.exp > 0
      ? payload.exp * 1000
      : -1;
    const now = Date.now();
    return {
      user: {
        id: payload.sub,
        username: payload.username || '',
        avatar: '',
        online: false,
      },
      isExpired: expMs > 0 && expMs < now,
      needsRefresh: expMs > 0 && expMs < now + 300_000,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialStoredToken = localStorage.getItem('echoza-token');
  const initialDecoded = initialStoredToken
    ? decodeLocalUser(initialStoredToken)
    : null;

  const [user, setUser] = useState<User | null>(initialDecoded?.user ?? null);
  const [token, setToken] = useState<string | null>(initialStoredToken);
  const [authLoading, setAuthLoading] = useState(false);
  const [authGeneration, setAuthGeneration] = useState(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2000;

    const decoded = decodeLocalUser(token);

    const runCheck = async (): Promise<void> => {
      if (cancelled) return;

      if (decoded?.needsRefresh) {
        const refreshData = await tryRefreshSession();
        if (refreshData) {
          localStorage.setItem('echoza-token', refreshData.token);
          localStorage.setItem(REFRESH_TOKEN_KEY, refreshData.refresh_token);
          setToken(refreshData.token);
          setUser(prev => prev ? { ...prev, ...refreshData.user } : refreshData.user);
          return;
        }
        if (decoded.isExpired) {
          for (const delay of [5000, 10000, 20000]) {
            if (cancelled) return;
            await new Promise(r => setTimeout(r, delay));
            const retryData = await tryRefreshSession();
            if (retryData) {
              localStorage.setItem('echoza-token', retryData.token);
              localStorage.setItem(REFRESH_TOKEN_KEY, retryData.refresh_token);
              setToken(retryData.token);
              setUser(prev => prev ? { ...prev, ...retryData.user } : retryData.user);
              return;
            }
          }
          logout();
          return;
        }
      }

      try {
        const activeToken = localStorage.getItem('echoza-token') || token;
        const res = await fetch(apiUrl('/api/users/me'), {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        if (!res.ok) {
          if (res.status === 401) {
            let refreshData = await tryRefreshSession();
            if (!refreshData) {
              for (const delay of [5000, 10000, 20000]) {
                if (cancelled) return;
                await new Promise(r => setTimeout(r, delay));
                refreshData = await tryRefreshSession();
                if (refreshData) break;
              }
            }
            if (refreshData) {
              localStorage.setItem('echoza-token', refreshData.token);
              localStorage.setItem(REFRESH_TOKEN_KEY, refreshData.refresh_token);
              setToken(refreshData.token);
              setUser(prev => prev ? { ...prev, ...refreshData.user } : refreshData.user);
              return;
            }
            logout();
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled && data?.id) {
          setUser(prev => prev ? { ...prev, ...data } : data);
        }
      } catch {
        if (cancelled) return;
        retries += 1;
        if (retries < MAX_RETRIES) {
          retryTimeoutRef.current = setTimeout(runCheck, RETRY_DELAY);
          return;
        }
        logout();
      }
    };

    runCheck();

    return () => {
      cancelled = true;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;

    let intervalCancelled = false;

    const refresh = async () => {
      if (intervalCancelled) return;
      const refreshData = await tryRefreshSession();
      if (refreshData) {
        localStorage.setItem('echoza-token', refreshData.token);
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshData.refresh_token);
        setToken(refreshData.token);
        setUser(prev => prev ? { ...prev, ...refreshData.user } : refreshData.user);
      }
    };

    refreshIntervalRef.current = setInterval(refresh, 30 * 60 * 1000);

    return () => {
      intervalCancelled = true;
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [token]);

  const login = (newToken: string, newRefreshToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    setAuthLoading(false);
    setAuthGeneration(g => g + 1);
    localStorage.setItem('echoza-token', newToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
  };

  useEffect(() => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'heartbeat-token',
        token: token || '',
      });
    }
  }, [token]);

  const logout = () => {
    const tokenAtLogout = token;
    if (tokenAtLogout && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      void (async () => {
        try {
          const reg = (await navigator.serviceWorker.getRegistration().catch(() => null)) ?? null;
          if (!reg) return;
          const sub = await reg.pushManager.getSubscription();
          if (!sub) return;
          const endpoint = sub.endpoint;
          const cleanupFetch = endpoint
            ? fetch(apiUrl('/api/push/unsubscribe'), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${tokenAtLogout}`,
                },
                body: JSON.stringify({ endpoint }),
                keepalive: true,
              }).catch(() => {})
            : Promise.resolve();
          await sub.unsubscribe().catch(() => {});
          await cleanupFetch;
        } catch {
        }
      })();
    }

    setToken(null);
    setUser(null);
    setAuthLoading(false);
    setAuthGeneration(g => g + 1);
    localStorage.removeItem('echoza-token');
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    try { localStorage.removeItem('echoza-message-outbox'); } catch { }
  };

  const updateUser = (updates: Partial<User>): void => {
    setUser(prev => (prev ? { ...prev, ...updates } : null));
  };

  return (
    <AuthContext.Provider
      value={{ user, token, login, logout, updateUser, isAuthenticated: !!user, authLoading, authGeneration }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
