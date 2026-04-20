'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * useServiceWorker — registra /sw.js y expone estado de updates.
 *
 * Comportamiento:
 *   - Registra el SW al mount si el browser lo soporta.
 *   - Llama a registration.update() cada 30 min mientras la tab está abierta.
 *   - Detecta nueva versión disponible → expone `updateAvailable=true`.
 *   - `applyUpdate()` envía SKIP_WAITING y recarga al tomar control.
 *
 * En desarrollo local Next hace hot-reload del SW manualmente puede causar
 * que el registro falle — es esperado, no es bloqueante en dev.
 */
export function useServiceWorker() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    setIsSupported(true);

    // Registro en load para no competir con el initial paint.
    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          setRegistration(reg);

          // Si ya hay un SW waiting (vino de sesión anterior), flag update.
          if (reg.waiting && navigator.serviceWorker.controller) {
            setUpdateAvailable(true);
          }

          // Listener para updates futuros.
          reg.addEventListener('updatefound', () => {
            const newSW = reg.installing;
            if (!newSW) return;
            newSW.addEventListener('statechange', () => {
              if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                setUpdateAvailable(true);
              }
            });
          });

          // Check de updates cada 30 min.
          const interval = setInterval(() => {
            reg.update().catch(() => {
              /* transient offline, ignore */
            });
          }, 30 * 60 * 1000);

          return () => clearInterval(interval);
        })
        .catch((err) => {
          console.warn('[SW] registration failed:', err);
        });
    };

    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad);
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);

  const applyUpdate = useCallback(() => {
    if (!registration?.waiting) return;
    registration.waiting.postMessage('SKIP_WAITING');

    // Cuando el nuevo SW toma control → reload para cargar nuevos assets.
    const onControllerChange = () => {
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
  }, [registration]);

  return { isSupported, registration, updateAvailable, applyUpdate };
}
