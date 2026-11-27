// Service worker: offline app shell + "is it finished?" notifications
const CACHE = 'smc-log-v1';
const SHELL = [
  '/', '/index.html', '/css/app.css',
  '/js/app.js', '/js/store.js', '/js/util.js', '/js/lists.js', '/js/config.js',
  '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/badge-72.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first for our own files (always fresh when online), cache as fallback offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});

// Push from the Netlify scheduled function (app closed / phone locked)
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data?.text() }; }
  const id = data.id || 'reminder';
  e.waitUntil(self.registration.showNotification(data.title || 'Intervention still open', {
    body: data.body || 'Is the intervention finished?',
    tag: `iv-${id}`,
    renotify: true,
    requireInteraction: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    vibrate: [200, 100, 200],
    data: { id },
    actions: [
      { action: 'finish', title: 'Yes, finish it' },
      { action: 'later', title: 'Not yet' },
    ],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'later') return;
  const id = e.notification.data?.id;
  const finish = e.action === 'finish';
  const target = id && id !== 'test' && id !== 'reminder' ? `/?${finish ? 'finish' : 'open'}=${id}` : '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => new URL(c.url).origin === location.origin);
    if (client) {
      await client.focus();
      if (id) client.postMessage({ type: 'open-intervention', id, finish });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
