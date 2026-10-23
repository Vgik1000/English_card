const VERSION = 'lexika-v1';
const CACHE_PREFIX = 'lexika-';
const scopeUrl = new URL('./', self.location.href);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.add(scopeUrl.href);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(VERSION);
        cache.put(scopeUrl.href, response.clone());
        return response;
      } catch {
        return (await caches.match(request)) || (await caches.match(scopeUrl.href));
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && url.href.startsWith(scopeUrl.href)) {
      const cache = await caches.open(VERSION);
      cache.put(request, response.clone());
    }
    return response;
  })());
});