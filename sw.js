/* Iron Log Service Worker — offline-first caching for PWA */
const CACHE_NAME = 'iron-log-v1.2.1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './iron-intelligence-engine.js',
  './apple-touch-icon.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

// Install: pre-cache core shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Navigation / HTML → network-first, fall back to cache
// - Same-origin static assets → cache-first
// - External (Firebase, fonts, CDNs) → network-only (or opaque)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET
  if (req.method !== 'GET') return;

  // Cross-origin: let the browser handle (Firebase, Google Fonts, etc.)
  if (url.origin !== self.location.origin) {
    return;
  }

  // HTML navigations: network first
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Static assets: cache first, then network
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Only cache successful same-origin responses
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
