self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || 'Echoza';
    const options = {
      body: data.body || '',
      icon: '/vite.svg',
      badge: '/vite.svg',
      data: { url: data.url || '/' },
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    const title = 'Echoza';
    const options = {
      body: event.data.text(),
      icon: '/vite.svg',
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
