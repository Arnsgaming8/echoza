const CACHE = 'echoza-v1';
const STATIC_ASSETS = ['/vite.svg'];
let HEARTBEAT_TOKEN = '';
let HEARTBEAT_INTERVAL = null;

const NOTIF_ICON_DATA_URI = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="32" fill="#3A7BFF"/><text x="96" y="132" text-anchor="middle" fill="white" font-size="108" font-weight="800" font-family="sans-serif">E</text></svg>');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

let HEARTBEAT_TICK_COUNT = 0;
function startHeartbeat() {
  if (HEARTBEAT_INTERVAL) clearInterval(HEARTBEAT_INTERVAL);
  HEARTBEAT_INTERVAL = setInterval(() => {
    if (!HEARTBEAT_TOKEN) return;
    fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + HEARTBEAT_TOKEN, 'Content-Type': 'application/json' },
    }).catch(() => {});

    HEARTBEAT_TICK_COUNT++;
    if (HEARTBEAT_TICK_COUNT % 5 !== 0) return;
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        client.postMessage({ type: 'presence:relay', ts: Date.now() });
      }
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
  if (!url.protocol.startsWith('http')) return;

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
  console.log('[SW] push event received, hasData=', !!event.data);
  event.waitUntil((async () => {
    if (!event.data) return;

    let title = 'Echoza';
    let body = '';
    let tag;
    let callType;
    let callerId;
    let callerUsername;
    let extraData = { url: '/', conversationId: undefined, callType: null, callerId: null, callerUsername: null };

    try {
      const data = event.data.json();
      title = data.title || 'Echoza';
      body = data.body || '';
      tag = data.tag;
      callType = data.callType;
      callerId = data.callerId;
      callerUsername = data.callerUsername;
      extraData = {
        url: data.url || '/',
        conversationId: data.conversationId,
        callType: callType || null,
        callerId: callerId || null,
        callerUsername: callerUsername || null,
      };
      console.log('[SW] push payload parsed title=', title, 'body=', body);
    } catch (parseErr) {
      console.log('[SW] push payload parse failed:', parseErr?.message || parseErr);
      try {
        body = event.data.text();
      } catch {
        console.log('[SW] push payload text() also failed, returning');
        return;
      }
    }

    const baseOptions = { body, icon: NOTIF_ICON_DATA_URI, data: extraData };
    if (tag) baseOptions.tag = tag;
    if (callType && callerId) {
      if (!baseOptions.tag) baseOptions.tag = `call-${callerId}`;
      baseOptions.renotify = true;
      baseOptions.requireInteraction = true;
    }

    let shown = false;
    try {
      await self.registration.showNotification(title, baseOptions);
      shown = true;
      console.log('[SW] showNotification OK (full options with data URI icon)');
    } catch (err1) {
      console.log('[SW] showNotification FAILED (full options):', err1?.message || err1);
    }

    if (!shown) {
      try {
        await self.registration.showNotification(title, { body, icon: NOTIF_ICON_DATA_URI });
        shown = true;
        console.log('[SW] showNotification OK (minimal with data URI icon)');
      } catch (err2) {
        console.log('[SW] showNotification FAILED (minimal with data URI icon):', err2?.message || err2);
      }
    }

    if (!shown) {
      try {
        await self.registration.showNotification(title, { body });
        shown = true;
        console.log('[SW] showNotification OK (no icon fallback)');
      } catch (err3) {
        console.log('[SW] showNotification FAILED (no icon fallback):', err3?.message || err3);
      }
    }

    if (!shown) {
      console.log('[SW] notification NOT shown — all attempts failed');
    }

    if (shown && callType && callerId) {
      try {
        const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        console.log('[SW] posted incoming-call to', windowClients.length, 'client(s)');
        for (const client of windowClients) {
          client.postMessage({
            type: 'incoming-call',
            callType,
            callerId,
            callerUsername: callerUsername || null,
          });
        }
      } catch {}
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  const conversationId = data.conversationId;
  const deepLink = conversationId
    ? `/dashboard?conv=${encodeURIComponent(conversationId)}`
    : (data.url || '/');
  const callType = data.callType;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      if (windowClients.length > 0) {
        const client = windowClients[0];
        client.focus();
        if (callType) {
          client.postMessage({
            type: 'incoming-call',
            callType,
            callerId: data.callerId || null,
            callerUsername: data.callerUsername || null,
          });
        } else if (conversationId) {
          client.postMessage({ type: 'navigate-conversation', conversationId });
        }
        return;
      }
      clients.openWindow(deepLink);
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
      icon: event.data.icon || NOTIF_ICON_DATA_URI,
      tag: event.data.tag,
      data: event.data.data || {},
    });
  }
});
