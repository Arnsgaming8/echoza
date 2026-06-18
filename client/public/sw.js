const CACHE = 'echoza-v1';
const STATIC_ASSETS = ['/vite.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, API, and WebSocket
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.protocol === 'ws:' || url.protocol === 'wss:') return;

  // Cache-first for hashed static assets (JS, CSS, fonts, images)
  if (/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(request).then(cached => {
          const fetchPromise = fetch(request).then(res => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          });
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Network-first for HTML navigation, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then(cached => cached || caches.match('/')))
    );
    return;
  }
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
    event.waitUntil(self.registration.showNotification('Echoza', {
      body: event.data.text(),
      icon: '/vite.svg',
    }));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  const conversationId = event.notification.data?.conversationId;
  const callType = event.notification.data?.callType;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      if (windowClients.length > 0) {
        const client = windowClients[0];
        client.focus();
        if (callType) {
          client.postMessage({ type: 'focus-app' });
        } else if (conversationId) {
          client.postMessage({ type: 'navigate-conversation', conversationId });
        }
        return;
      }
      clients.openWindow(urlToOpen);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'show-notification') {
    self.registration.showNotification(event.data.title, {
      body: event.data.body,
      icon: event.data.icon || '/vite.svg',
      tag: event.data.tag,
      data: event.data.data || {},
    });
  }
});
