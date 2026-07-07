import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('echoza-token'));
  const [authLoading, setAuthLoading] = useState(!!localStorage.getItem('echoza-token'));

  useEffect(() => {
    if (!token) {
      setAuthLoading(false);
      return;
    }

    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000;

    const refreshThenCheck = async () => {
      const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (storedRefresh) {
        try {
          const refreshRes = await fetch(apiUrl('/api/auth/refresh'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: storedRefresh }),
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            if (!cancelled) {
              localStorage.setItem('echoza-token', refreshData.token);
              localStorage.setItem(REFRESH_TOKEN_KEY, refreshData.refresh_token);
              setToken(refreshData.token);
              setUser(refreshData.user);
              setAuthLoading(false);
              return;
            }
          }
        } catch {}
      }

      // Refresh failed or no refresh token — try original token
      const check = () => {
        fetch(apiUrl('/api/users/me'), {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(res => {
            if (!res.ok) throw new Error('Invalid token');
            return res.json();
          })
          .then(data => {
            if (!cancelled) {
              setUser(data);
              setAuthLoading(false);
              localStorage.setItem('echoza-token', token);
            }
          })
          .catch(() => {
            if (cancelled) return;
            retries++;
            if (retries < MAX_RETRIES) {
              setTimeout(check, RETRY_DELAY);
            } else {
              setToken(null);
              localStorage.removeItem('echoza-token');
              localStorage.removeItem(REFRESH_TOKEN_KEY);
              setAuthLoading(false);
            }
          });
      };

      check();
    };

    refreshThenCheck();
    return () => { cancelled = true; };
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

  const updateUser = (updates: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updates } : null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser, isAuthenticated: !!user, authLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
