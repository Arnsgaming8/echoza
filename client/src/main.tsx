import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Bump this value ON PURPOSE when you need to force a one-time hard reset of
// cached bundles for all users (e.g. after a breaking change shipped only to
// cached service-worker bundles). Auth tokens are NOT touched — only the
// service-worker / cache layer is wiped so the next load picks up fresh JS.
const STORAGE_VERSION = '6';
const storedVersion = localStorage.getItem('echoza-storage-version');
if (storedVersion !== STORAGE_VERSION) {
  localStorage.setItem('echoza-storage-version', STORAGE_VERSION);
  console.info('[Echoza] storage version bump detected — clearing SW + caches');
  if ('serviceWorker' in navigator) {
    caches.keys().then(names => names.forEach(n => caches.delete(n)));
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
