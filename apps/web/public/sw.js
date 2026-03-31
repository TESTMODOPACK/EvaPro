// Ascenda Performance — Service Worker
// Provides offline support and caching for the PWA

const CACHE_NAME = 'ascenda-v1';
const MAX_CACHED_ASSETS = 100; // Limit cache size to prevent unbounded growth

// Only cache truly static assets during install (not SSR routes)
const STATIC_ASSETS = [
  '/offline.html',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/manifest.json',
];

// Install: cache static assets only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Don't skipWaiting — let the new SW wait until all tabs close
  // This prevents mid-session asset mismatches
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Helper: trim cache to max size (evict oldest entries)
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    await trimCache(cacheName, maxItems);
  }
}

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API calls and external requests — always go to network
  if (url.pathname.startsWith('/api') || url.origin !== self.location.origin) return;

  // For navigation (HTML pages): network first, fallback to cache, then offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a copy of successful navigations
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone);
              trimCache(CACHE_NAME, MAX_CACHED_ASSETS);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return cached || caches.match('/offline.html');
          });
        })
    );
    return;
  }

  // For static assets (JS, CSS, images, fonts): cache first, fallback to network
  if (url.pathname.match(/\.(js|css|svg|png|jpg|woff2?)$/) || url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, clone);
              trimCache(CACHE_NAME, MAX_CACHED_ASSETS);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else: network only
});

// Listen for messages from the app (e.g., force update)
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
