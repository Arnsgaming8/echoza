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
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
  updateUser: () => {},
  isAuthenticated: false,
  authLoading: true,
});

const REFRESH_TOKEN_KEY = 'echoza-refresh-token';

/**
 * Try to refresh the session via the server endpoint.
 * Returns the new session data or null on failure.
 */
async function tryRefreshSession(): Promise<{
  token: string;
  refresh_token: string;
  user: User;
} | null> {
  const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!storedRefresh) return null;
  try {
    const res = await fetch(apiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: storedRefresh }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('echoza-token'));
  const [authLoading, setAuthLoading] = useState(!!localStorage.getItem('echoza-token'));
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Initial auth check ──────────────────────────────────────────────────
  // Strategy: try /api/users/me FIRST with the stored access token.
  // The old approach of calling /api/auth/refresh on EVERY page load always
  // fails because Supabase refresh tokens expire and are single-use.  That
  // wasted HTTP call also logged a confusing 401 in the console every time.
  //
  // If /api/users/me fails (access token expired), THEN try refresh as a
  // recovery mechanism.  If both fail, the user is shown the login screen.
  useEffect(() => {
    if (!token) {
      setAuthLoading(false);
      return;
    }

    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000;

    const runCheck = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const res = await fetch(apiUrl('/api/users/me'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const err: any = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        const data = await res.json();
        if (!cancelled) {
          setUser(data);
          setAuthLoading(false);
        }
      } catch (err: any) {
        if (cancelled) return;

        // ── Access token expired — try refresh as recovery ──
        if (err?.status === 401) {
          const refreshData = await tryRefreshSession();
          if (refreshData && !cancelled) {
            localStorage.setItem('echoza-token', refreshData.token);
            localStorage.setItem(REFRESH_TOKEN_KEY, refreshData.refresh_token);
            setToken(refreshData.token);
            setUser(refreshData.user);
            setAuthLoading(false);
            return;
          }

          // Both access token AND refresh failed — nuke everything
          localStorage.removeItem('echoza-token');
          localStorage.removeItem(REFRESH_TOKEN_KEY);
          setToken(null);
          setUser(null);
          setAuthLoading(false);
          return;
        }

        // Transient error — retry a few times
        retries += 1;
        if (retries < MAX_RETRIES) {
          retryTimeoutRef.current = setTimeout(runCheck, RETRY_DELAY);
          return;
        }

        // Out of retries on transient error — show login but keep tokens so
        // a hard refresh can recover.
        setToken(null);
        setUser(null);
        setAuthLoading(false);
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

  // ── Background token refresh ────────────────────────────────────────────
  // Proactively refresh the session every 30 minutes so the access token
  // never expires.  This keeps the user logged in indefinitely without
  // needing to re-enter credentials, even across page loads.
  useEffect(() => {
    if (!token) return;

    const refresh = async () => {
      const refreshData = await tryRefreshSession();
      if (!refreshData) return;
      localStorage.setItem('echoza-token', refreshData.token);
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshData.refresh_token);
      setToken(refreshData.token);
      setUser(prev => prev ? { ...prev, ...refreshData.user } : refreshData.user);
    };

    // Refresh every 30 minutes (Supabase access tokens default to 1 hour)
    refreshIntervalRef.current = setInterval(refresh, 30 * 60 * 1000);

    return () => {
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
    localStorage.setItem('echoza-token', newToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
  };

  // Send token to service worker for background heartbeat
  useEffect(() => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'heartbeat-token',
        token: token || '',
      });
    }
  }, [token]);

  const logout = () => {
    setToken(null);
    setUser(null);
    setAuthLoading(false);
    localStorage.removeItem('echoza-token');
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  };

  const updateUser = (updates: Partial<User>): void => {
    setUser(prev => (prev ? { ...prev, ...updates } : null));
  };

  return (
    <AuthContext.Provider
      value={{ user, token, login, logout, updateUser, isAuthenticated: !!user, authLoading }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
