import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Clear stale storage once per version bump
const STORAGE_VERSION = '2';
const storedVersion = localStorage.getItem('echoza-storage-version');
if (storedVersion !== STORAGE_VERSION) {
  localStorage.removeItem('echoza-token');
  localStorage.removeItem('echoza-refresh-token');
  localStorage.setItem('echoza-storage-version', STORAGE_VERSION);
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
