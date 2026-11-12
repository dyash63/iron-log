/* Iron Log service worker — scoped, offline-first caching. */
'use strict';

const CACHE_PREFIX = 'iron-log-';
const CACHE_NAME = `${CACHE_PREFIX}v1.4.1`;
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './iron-intelligence-engine.js',
  './exercise-knowledge-base.js',
  './iron-log-platform.js',
  './iron-log-advanced.js',
  './icons/apple-touch-icon.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isInAppScope(url) {
  const scope = new URL(self.registration.scope);
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
}

function isCacheableStaticRequest(request, url) {
  if (request.method !== 'GET' || !isInAppScope(url)) return false;
  if (request.headers.has('authorization')) return false;
  // Do not cache arbitrary same-origin endpoints or user-generated/query URLs.
  return request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    /\.(?:js|css|png|jpe?g|svg|webp|ico|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isInAppScope(url)) return;

  if (request.mode === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch (error) {
        return (await caches.match('./index.html')) ||
          new Response('Iron Log is unavailable offline. Reconnect and try again.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  if (!isCacheableStaticRequest(request, url)) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && response.ok && response.type !== 'opaque') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      return cached || new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
