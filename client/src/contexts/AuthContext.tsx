import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { apiUrl } from '../utils/api';
import { supabase } from '../utils/supabase';

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

/**
 * Synchronously decode the cached Supabase JWT into a stub User. Runs
 * entirely on the client — no network — and lets us authenticate the
 * user INSTANTLY on app reopen even when the Render backend is still
 * cold-starting. Returns null if the token is malformed or missing the
 * `sub` claim (in which case ProtectedRoute will route to /login).
 *
 * Flags `needsRefresh: true` when the access token is within 5 minutes
 * of expiry. Supabase refresh tokens are SINGLE-USE, so we must NOT
 * refresh on every mount — only when the access token is actually close
 * to expiring, otherwise we'd burn the refresh_token on cold-mount.
 */
function decodeLocalUser(token: string): {
  user: User;
  isExpired: boolean;
  needsRefresh: boolean;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // JWT base64url → standard base64 (Supabase tokens are URL-safe).
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const payloadJson = atob(b64 + padding);
    const payload = JSON.parse(payloadJson);
    if (!payload?.sub || typeof payload.sub !== 'string') return null;
    // Treat missing/non-positive exp as -1 ('unknown') and gate both flags
    // on a known exp.  Otherwise we'd proactively refresh on every mount
    // for any token with no exp claim (e.g. hand-rolled test JWTs) and
    // burn Supabase's single-use refresh token.
    const expMs = typeof payload.exp === 'number' && payload.exp > 0
      ? payload.exp * 1000
      : -1;
    const now = Date.now();
    return {
      user: {
        id: payload.sub,
        username: payload.user_metadata?.username || '',
        avatar: '',
        online: false,
      },
      isExpired: expMs > 0 && expMs < now,
      needsRefresh: expMs > 0 && expMs < now + 60_000,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Synchronously derive the initial user from the cached JWT — NO
  // network round-trip — so ProtectedRoute never sees an unauthenticated
  // user just because the Render backend is cold-starting. The Dashboard
  // renders with a stub user within ~5 ms of mount; a background effect
  // then refines avatar/username via /api/users/me. If the cached token
  // is malformed we fall through to user=null (login screen).
  const initialStoredToken = localStorage.getItem('echoza-token');
  const initialDecoded = initialStoredToken
    ? decodeLocalUser(initialStoredToken)
    : null;

  const [user, setUser] = useState<User | null>(initialDecoded?.user ?? null);
  const [token, setToken] = useState<string | null>(initialStoredToken);
  const [authLoading, setAuthLoading] = useState(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Background refinement + proactive refresh (background-only — UI is
  // already authenticated via the stub user from localStorage at mount).
  // Failures here DO NOT bounce the user to /login; the cached token lets
  // a hard refresh re-attempt validation safely.
  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    let retries = 0;
    const MAX_RETRIES = 35;
    const RETRY_DELAY = 2000;

    const decoded = decodeLocalUser(token);

    const runCheck = async (): Promise<void> => {
      if (cancelled) return;

      // Step 1: refresh proactively only when the access token is near
      // expiry. setToken(new) re-runs this effect with the fresh token.
      if (decoded?.needsRefresh) {
        const refreshData = await tryRefreshSession();
        if (refreshData) {
          localStorage.setItem('echoza-token', refreshData.token);
          localStorage.setItem(REFRESH_TOKEN_KEY, refreshData.refresh_token);
          setToken(refreshData.token);
          setUser(prev => prev ? { ...prev, ...refreshData.user } : refreshData.user);
          return;
        }
        // Refresh failed. If the token is genuinely expired, force re-login.
        // If the token is still valid by clock (just below 5-min buffer),
        // fall through and try /me with the original token.
        if (decoded.isExpired) {
          localStorage.removeItem('echoza-token');
          localStorage.removeItem(REFRESH_TOKEN_KEY);
          setToken(null);
          setUser(null);
          return;
        }
      }

      // Step 2: best-effort /api/users/me to refine avatar/username.
      // Stand on a 401 with a refresh-and-retry once; otherwise treat as
      // transient and retry up to 35×2s = ~70s (Render cold-start budget).
      try {
        const activeToken = localStorage.getItem('echoza-token') || token;
        const res = await fetch(apiUrl('/api/users/me'), {
          headers: { Authorization: `Bearer ${activeToken}` },
        });          if (!res.ok) {
            if (res.status === 401) {
            const refreshData = await tryRefreshSession();
            if (refreshData) {
              localStorage.setItem('echoza-token', refreshData.token);
              localStorage.setItem(REFRESH_TOKEN_KEY, refreshData.refresh_token);
              setToken(refreshData.token);
              setUser(prev => prev ? { ...prev, ...refreshData.user } : refreshData.user);
              return;
            }
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
        // Out of retries on transient error — KEEP the stub user from
        // localStorage. Tokens preserved so a hard refresh re-attempts.
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

  // Populate the Supabase JS session whenever the access token rotates (login,
  // refresh, page reload). Without this, any `supabase.channel('…')` opened by
  // the client connects with the ANON role and RLS denies every row event
  // (causing `postgres_changes` to deliver nothing). With setSession, the
  // underlying Realtime WebSocket authenticates with the user's JWT and
  // server-side policies like `auth.uid() = is_participant(...)` let the
  // matching events through.
  useEffect(() => {
    if (!token) {
      supabase.auth.signOut().catch(() => { /* already signed out */ });
      return;
    }
    const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refresh) return;
    supabase.auth
      .setSession({ access_token: token, refresh_token: refresh })
      .catch((err) => console.warn('[Auth] supabase.setSession failed:', err));
  }, [token]);

  const logout = () => {
    setToken(null);
    setUser(null);
    setAuthLoading(false);
    localStorage.removeItem('echoza-token');
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    // Clear the message outbox so a queued message from this user
    // doesn't get re-emitted under a different identity (or a fresh
    // registration) after the next login. The outbox is durable across
    // iOS PWA background-kill, which is its job — but it should NOT
    // survive an explicit logout.
    try { localStorage.removeItem('echoza-message-outbox'); } catch { /* ignore */ }
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
