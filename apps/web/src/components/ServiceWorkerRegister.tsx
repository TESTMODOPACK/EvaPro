'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registered, scope:', reg.scope);

        // Check for updates periodically (every 60 minutes)
        setInterval(() => {
          reg.update().catch(() => {});
        }, 60 * 60 * 1000);

        // Detect when a new SW is waiting
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — tell the waiting SW to activate
              console.log('[PWA] New version available, activating...');
              newWorker.postMessage('skipWaiting');
            }
          });
        });
      })
      .catch((err) => {
        console.log('[PWA] Service Worker registration failed:', err);
      });

    // When a new SW takes control, reload to get fresh assets
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      console.log('[PWA] New Service Worker active, reloading...');
      window.location.reload();
    });
  }, []);

  return null;
}
