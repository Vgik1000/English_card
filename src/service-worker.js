// Replaced with the complete production file list and content hash during build.
const PRECACHE_FILES = __PRECACHE_FILES__;
const BUILD_ID = '__BUILD_ID__';
const scopeUrl = new URL('./', self.location.href);
const CACHE_PREFIX = `lexika:${scopeUrl.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const urls = PRECACHE_FILES.map((file) => new URL(file, scopeUrl).href);
const assets = new Set(urls);
const indexUrl = new URL('index.html', scopeUrl).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll is atomic: one missing file prevents installation of this version.
    await cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })));
    // Let an update wait for existing tabs to close; never mix running versions.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;
  const isNavigation = request.mode === 'navigate';
  // Only serve this release's files; do not cache unrelated requests or errors.
  if (!isNavigation && !assets.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(isNavigation ? indexUrl : request);
    if (cached) return cached;
    // Recover from browser eviction when online. Failed responses never enter the cache.
    const resource = new Request(isNavigation ? indexUrl : request, { cache: 'reload' });
    const response = await fetch(resource);
    if (response.ok) await cache.put(resource, response.clone());
    return response;
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CHECK_OFFLINE_READY' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const present = await Promise.all(urls.map((url) => cache.match(url)));
    event.ports[0].postMessage({ type: 'OFFLINE_STATUS', ready: present.every(Boolean) });
  })());
});
