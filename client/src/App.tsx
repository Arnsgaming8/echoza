import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import Landing from './pages/Landing';
import Signup from './pages/Signup';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Pair from './pages/Pair';
import LoadingScreen from './components/LoadingScreen';
import DbPausedOverlay from './components/DbPausedOverlay';
import { ReactNode, useState, useEffect } from 'react';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    
    
    
    
    
    
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppContent() {
  const { isAuthenticated, authLoading } = useAuth();
  const [ready, setReady] = useState(false);
  const [showLoader, setShowLoader] = useState(true);
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    const handler = () => setAppReady(true);
    window.addEventListener('echoza:app-ready', handler, { once: true });
    return () => window.removeEventListener('echoza:app-ready', handler);
  }, []);

  useEffect(() => {
    if (!authLoading && (appReady || !isAuthenticated)) {
      setReady(true);
    }
  }, [authLoading, appReady, isAuthenticated]);

  const fallbackMs = isAuthenticated ? 10000 : 1000;
  useEffect(() => {
    const fallback = setTimeout(() => setReady(true), fallbackMs);
    return () => clearTimeout(fallback);
  }, [fallbackMs]);

  useEffect(() => {
    if (ready) {
      const timer = setTimeout(() => setShowLoader(false), 350);
      return () => clearTimeout(timer);
    }
  }, [ready]);

  return (
    <>
      {showLoader && <LoadingScreen visible={!ready} />}
      {!authLoading && (
        <SocketProvider>
          <DbPausedOverlay>
            <Routes>
            <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
            <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/pair" element={<Pair />} />
            <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/'} replace />} />
            </Routes>
          </DbPausedOverlay>
        </SocketProvider>
      )}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
