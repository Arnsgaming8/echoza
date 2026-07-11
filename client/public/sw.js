const CACHE = 'echoza-v1';
const STATIC_ASSETS = ['/vite.svg'];
let HEARTBEAT_TOKEN = '';
let HEARTBEAT_INTERVAL = null;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

function startHeartbeat() {
  if (HEARTBEAT_INTERVAL) clearInterval(HEARTBEAT_INTERVAL);
  HEARTBEAT_INTERVAL = setInterval(() => {
    if (!HEARTBEAT_TOKEN) return;
    fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + HEARTBEAT_TOKEN, 'Content-Type': 'application/json' },
    }).catch(() => {});
  }, 1000);
}

function stopHeartbeat() {
  if (HEARTBEAT_INTERVAL) { clearInterval(HEARTBEAT_INTERVAL); HEARTBEAT_INTERVAL = null; }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.protocol === 'ws:' || url.protocol === 'wss:') return;

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

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then(cached => cached || caches.match('/')))
    );
    return;
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    event.waitUntil(self.registration.showNotification('Echoza', {
      body: event.data.text(),
      icon: '/vite.svg',
    }));
    return;
  }
  const title = data.title || 'Echoza';
  const callType = data.callType;
  const callerId = data.callerId;
  const callerUsername = data.callerUsername;
  const options = {
    body: data.body || '',
    icon: '/vite.svg',
    badge: '/vite.svg',
    // tag + renotify collapses repeated calls from same caller instead of
    // stacking. Missing tag falls back to a per-message unique id.
    tag: data.tag || (callType ? `call-${callerId || 'unknown'}` : undefined),
    renotify: !!callType,
    data: {
      url: data.url || '/',
      conversationId: data.conversationId,
      callType: callType || null,
      callerId: callerId || null,
      callerUsername: callerUsername || null,
    },
  };
  event.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      // Broadcast the call payload to any open Echoza tab so Dashboard can
      // render its IncomingCall UI without requiring the user to click the
      // notification first. If a socket `call:offer` is also in flight the
      // full SDP version will arrive milliseconds later — Dashboard dedupes
      // by caller id, so the second `setIncomingCall` is a no-op.
      if (callType && callerId) {
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
          for (const client of windowClients) {
            client.postMessage({
              type: 'incoming-call',
              callType,
              callerId,
              callerUsername: callerUsername || null,
            });
          }
        });
      }
      return undefined;
    })
  );
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
  const data = event.data;
  if (data?.type === 'heartbeat-token') {
    HEARTBEAT_TOKEN = data.token || '';
    if (HEARTBEAT_TOKEN) {
      startHeartbeat();
    } else {
      stopHeartbeat();
    }
  }
  if (data?.type === 'show-notification') {
    self.registration.showNotification(event.data.title, {
      body: event.data.body,
      icon: event.data.icon || '/vite.svg',
      tag: event.data.tag,
      data: event.data.data || {},
    });
  }
});
