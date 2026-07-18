import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';





const STORAGE_VERSION = '7';
const storedVersion = localStorage.getItem('echoza-storage-version');
if (storedVersion !== STORAGE_VERSION) {
  localStorage.setItem('echoza-storage-version', STORAGE_VERSION);
  console.info('[Echoza] storage version bump detected — clearing SW + caches + auth tokens');
  try {
    localStorage.removeItem('echoza-token');
    localStorage.removeItem('echoza-refresh-token');
  } catch { /* ignore */ }
  if ('serviceWorker' in navigator) {
    caches.keys().then(names => names.forEach(n => caches.delete(n)));
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
  }
}



if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
