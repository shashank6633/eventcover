/**
 * EventCover service worker.
 *
 * Strategy:
 *   • Static assets (Next.js _next/static/*) — stale-while-revalidate
 *   • Pages (HTML) — network-first, fall back to cache, then to /offline page
 *   • API calls — always network (no caching of mutable wallet data)
 *
 * Goal: app remains installable + opens instantly on cold start. We deliberately
 * do NOT cache /api/* — captains must always hit the source of truth.
 */
const STATIC_CACHE = 'ec-static-v1';
const PAGE_CACHE = 'ec-pages-v1';

const OFFLINE_FALLBACK = '/login';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop old versioned caches
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't touch cross-origin
  if (url.origin !== self.location.origin) return;

  // Always network for API + auth + dev
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/webpack-hmr') ||
    url.pathname.startsWith('/_next/static/development')
  ) {
    return;
  }

  // Static build assets — stale-while-revalidate
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/static/')) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // HTML / navigation requests — network-first
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(req, PAGE_CACHE));
    return;
  }
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    const fallback = await cache.match(OFFLINE_FALLBACK);
    if (fallback) return fallback;
    return new Response('You are offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
