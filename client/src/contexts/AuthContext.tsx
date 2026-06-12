import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  id: string;
  username: string;
  avatar: string;
  online: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
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

    const check = () => {
      fetch('/api/users/me', {
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
          if (retries < 5) {
            setTimeout(check, 3000);
          } else {
            setToken(null);
            localStorage.removeItem('echoza-token');
            setAuthLoading(false);
          }
        });
    };

    check();
    return () => { cancelled = true; };
  }, [token]);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    setAuthLoading(false);
    localStorage.setItem('echoza-token', newToken);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setAuthLoading(false);
    localStorage.removeItem('echoza-token');
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
