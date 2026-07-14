// Service Worker for Push Notifications + fresh-content caching
// family-reminder-cloud v4 (network-first so mobile never shows stale HTML)

const CACHE_NAME = 'frc-push-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for same-origin GET (always serve fresh index.html / assets)
// Cross-origin (api.github.com) and non-GET requests pass through untouched.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let GitHub API calls go straight to network

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// ===== Push notifications =====
self.addEventListener('push', (event) => {
  let data = { title: 'HomeMemo', body: '你有新的提醒！', icon: '/family-reminder-cloud/icon-192.png', badge: '/family-reminder-cloud/icon-72.png', tag: 'reminder', url: '/family-reminder-cloud/' };

  try {
    if (event.data) {
      const payload = event.data.json();
      if (payload.title) data.title = payload.title;
      if (payload.body) data.body = payload.body;
      if (payload.url) data.url = payload.url;
      if (payload.tag) data.tag = payload.tag;
    }
  } catch (e) {
    data.body = event.data ? event.data.text() : data.body;
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: data.tag,
    vibrate: [200, 100, 200],
    requireInteraction: true,
    data: { url: data.url },
    actions: [
      { action: 'open', title: '打開' },
      { action: 'close', title: '關閉' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const url = event.notification.data.url || '/family-reminder-cloud/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
