/* ProTools service worker: network-first for app code, cached fallback for offline use. */
const CACHE_PREFIX = 'protools-shell-';
const CACHE_VERSION = 'v5';
const CACHE = CACHE_PREFIX + CACHE_VERSION;
const CORE = [
  '/',
  '/index.html',
  '/app/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/pdf-lib.min.js',
  '/jszip.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // Cache core files individually: an optional/missing path must not block SW install.
    await Promise.all(CORE.map(async path => {
      try {
        const response = await fetch(new Request(path, { cache: 'reload' }));
        if (response.ok && (response.type === 'basic' || response.type === 'default')) {
          await cache.put(path, response);
        }
      } catch (_) {
        /* Offline install: keep any available shell assets. */
      }
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys.filter(key =>
        (key.startsWith(CACHE_PREFIX) || key === 'protools-v2') &&
        key !== CACHE
      ).map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');

  const isAppCode =
    /\.(?:html|js|css|json|webmanifest)$/i.test(url.pathname) ||
    url.pathname === '/';

  if (isNavigation || isAppCode) {
    // Try the network first so a deployment is picked up on the next online load.
    // Offline clients cannot know about a deployment; use the last cached copy instead.
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(
          new Request(request, { cache: 'no-store' })
        );

        if (
          networkResponse &&
          networkResponse.ok &&
          (networkResponse.type === 'basic' || networkResponse.type === 'default')
        ) {
          const cache = await caches.open(CACHE);
          await cache.put(request, networkResponse.clone());
        }

        return networkResponse;
      } catch (_) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;

        if (isNavigation) {
          const shell =
            await caches.match('/index.html') ||
            await caches.match('/');

          if (shell) return shell;
        }

        return new Response('Offline and this resource is not cached.', {
          status: 503,
          statusText: 'Offline',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        });
      }
    })());

    return;
  }

  // Static non-code assets also use network-first with a cached offline fallback.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);

      if (
        response.ok &&
        (response.type === 'basic' || response.type === 'default')
      ) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }

      return response;
    } catch (_) {
      return (
        await caches.match(request, { ignoreSearch: true })
      ) || new Response('', {
        status: 503,
        statusText: 'Offline'
      });
    }
  })());
});
