/**
 * EVA360 Service Worker
 *
 * Responsabilidades:
 *   1. Cache de assets estáticos (JS, CSS, imágenes) para arranque rápido.
 *   2. Fallback offline para navegación si no hay red.
 *   3. Recepción de web push notifications (push + notificationclick handlers).
 *
 * Versión del cache bumpeada cada release de v3.x.
 */

const VERSION = 'v3.1.0';
const STATIC_CACHE  = `eva360-static-${VERSION}`;
const RUNTIME_CACHE = `eva360-runtime-${VERSION}`;
const MAX_RUNTIME_ENTRIES = 60;

// Precache mínimo: offline fallback + ícono para notifs.
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/badge-72.png',
];

// ─── Install ────────────────────────────────────────────────────────
// NO se llama skipWaiting() acá: el SW nuevo queda en estado "waiting"
// hasta que el usuario acepte actualizar via UpdateAvailableToast (que
// envía el mensaje SKIP_WAITING al message handler). Esto evita races
// donde una tab con state vivo se encuentra con caches incompatibles.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => console.warn('[SW] install precache failed:', err))
  );
});

// ─── Activate ───────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch (estrategias según tipo) ──────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo GET same-origin.
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API y auth → network-only (NUNCA cachear data de usuario).
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.includes('/login') ||
    url.pathname.includes('/_next/data')
  ) {
    return;
  }

  // _next/static (hashed, immutable) → cache-first.
  if (url.pathname.startsWith('/_next/static')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Imágenes → cache-first con trim.
  if (request.destination === 'image') {
    event.respondWith(cacheFirstWithTrim(request, RUNTIME_CACHE));
    return;
  }

  // HTML / navegación → network-first, fallback caché, fallback offline.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Default: network-first.
  event.respondWith(networkFirst(request));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function cacheFirstWithTrim(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      trimCache(cacheName, MAX_RUNTIME_ENTRIES);
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
      trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback final: offline.html para navegación.
    if (request.mode === 'navigate' || request.destination === 'document') {
      return caches.match('/offline.html');
    }
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

// Flag anti-race: trimCache puede ser llamada por múltiples fetches
// simultáneos. Si dos instancias leen keys.length=65 y ambas borran 5,
// el cache queda en 55 pero las eliminaciones son duplicadas. Peor, en
// concurrencia alta el cache puede crecer más allá de maxEntries porque
// nuevos put() ocurren mientras otra trim está pendiente. Con el flag
// nos aseguramos que solo una trim corre a la vez por cache.
const _trimmingCaches = new Set();
async function trimCache(cacheName, maxEntries) {
  if (_trimmingCaches.has(cacheName)) return;
  _trimmingCaches.add(cacheName);
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const toDelete = keys.length - maxEntries;
    for (let i = 0; i < toDelete; i++) {
      await cache.delete(keys[i]);
    }
  } finally {
    _trimmingCaches.delete(cacheName);
  }
}

// ─── Push event handler ─────────────────────────────────────────────
// Recibe el payload del servidor (VAPID-firmado). Muestra notif del OS.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'EVA360', body: event.data.text() || 'Tienes una actualización' };
  }

  const title = payload.title || 'EVA360';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/badge-72.png',
    tag: payload.tag,
    renotify: !!payload.tag,
    data: {
      url: payload.url || '/dashboard',
      ...(payload.data || {}),
    },
    vibrate: [100, 50, 100],
    requireInteraction: payload.requireInteraction === true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification click handler ─────────────────────────────────────
// Al tocar la notif, enfoca tab existente o abre nueva en la URL target.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/dashboard';
  const targetAbsolute = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Busca una tab abierta de EVA360 (mismo origin).
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin)) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetAbsolute).catch(() => {
              return clients.openWindow(targetAbsolute);
            });
          }
          return;
        }
      }
      return clients.openWindow(targetAbsolute);
    })
  );
});

// ─── Messages from page (force update, clear cache) ─────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});
