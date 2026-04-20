'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { urlBase64ToUint8Array } from '@/lib/push-utils';

export type PermissionState = 'default' | 'granted' | 'denied';

export interface UsePushNotificationsResult {
  /** true si el browser soporta SW + PushManager + Notification. */
  isSupported: boolean;
  /** Estado de permiso del sistema operativo. */
  permission: PermissionState;
  /** Hay una subscription registrada en este device + backend. */
  isSubscribed: boolean;
  /** Operación en curso (request permission, subscribe, unsubscribe). */
  isLoading: boolean;
  /**
   * Solicita permiso al usuario + crea la subscription + la registra en
   * el backend. Retorna { ok } y en caso de error, la causa:
   *   - 'no-support'  → browser no soporta push
   *   - 'denied'      → usuario denegó el permiso
   *   - 'no-vapid'    → backend no tiene VAPID configurado
   *   - mensaje libre → otro error
   */
  subscribe: () => Promise<{ ok: boolean; error?: string }>;
  /** Desregistra del backend + browser. */
  unsubscribe: () => Promise<{ ok: boolean; error?: string }>;
  /** Re-chequea el estado del SO y backend (ej. después de cambios externos). */
  refresh: () => Promise<void>;
}

/**
 * usePushNotifications — hook principal para gestionar la subscription
 * web-push del usuario en el dispositivo actual.
 *
 * Al mount:
 *   1. Detecta soporte de browser.
 *   2. Lee Notification.permission (default/granted/denied).
 *   3. Consulta pushManager.getSubscription() → isSubscribed.
 *
 * `subscribe()`:
 *   1. Notification.requestPermission() → si granted, continúa.
 *   2. GET /notifications/push/vapid-key → obtiene publicKey.
 *   3. pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }).
 *   4. POST /notifications/push/subscribe con endpoint + keys.
 *
 * Notas:
 *   - userVisibleOnly:true es obligatorio en Chrome (spec requiere que
 *     cada push muestre una notif visible).
 *   - Safari iOS 16.4+ SOLO funciona si la PWA está instalada en home.
 *     Si se llama desde Safari navegando, pushManager.subscribe rechaza.
 */
export function usePushNotifications(): UsePushNotificationsResult {
  const token = useAuthStore((s) => s.token);
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<PermissionState>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const supported =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setIsSupported(supported);
    if (!supported) return;
    setPermission(Notification.permission as PermissionState);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setIsSubscribed(!!sub);
    } catch {
      setIsSubscribed(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const subscribe = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    if (!token) return { ok: false, error: 'no-token' };
    if (!isSupported) return { ok: false, error: 'no-support' };

    setIsLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== 'granted') {
        return { ok: false, error: 'denied' };
      }

      const reg = await navigator.serviceWorker.ready;

      // Si ya hay una subscription activa, reusarla.
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        let publicKey: string;
        try {
          const res = await api.push.getVapidKey(token);
          publicKey = res.publicKey;
        } catch {
          return { ok: false, error: 'no-vapid' };
        }
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // `as BufferSource` — TS confunde Uint8Array<ArrayBufferLike> vs
          // ArrayBuffer. Runtime-wise es equivalente.
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
      }

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        return { ok: false, error: 'invalid-subscription' };
      }

      await api.push.subscribe(token, {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      });
      setIsSubscribed(true);
      return { ok: true };
    } catch (err: any) {
      console.error('[Push] subscribe failed:', err);
      return { ok: false, error: err?.message || 'unknown' };
    } finally {
      setIsLoading(false);
    }
  }, [token, isSupported]);

  const unsubscribe = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    if (!token) return { ok: false, error: 'no-token' };
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setIsSubscribed(false);
        return { ok: true };
      }
      // Orden: browser PRIMERO, backend después.
      //   1. Si browser falla → no tocamos backend, estado queda consistente
      //      (user sigue suscrito en ambos lados, puede reintentar).
      //   2. Si browser OK pero backend falla → backend tiene una sub cuyo
      //      endpoint el browser ya invalidó. Los futuros pushes fallarán
      //      con 410/404 y el PushService las borra automáticamente. No es
      //      ideal (quedan "huérfanas" hasta el primer push), pero no hay
      //      estado incorrecto visible al usuario.
      const endpoint = sub.endpoint;
      try {
        await sub.unsubscribe();
      } catch (err: any) {
        console.error('[Push] browser unsubscribe failed:', err);
        return { ok: false, error: 'browser-unsubscribe-failed' };
      }
      // Browser listo; ahora backend. Si falla, no rollbackeamos (no
      // tenemos la sub original para re-crearla sin prompt del user).
      try {
        await api.push.unsubscribe(token, endpoint);
      } catch (err) {
        console.warn('[Push] backend unsubscribe failed (will auto-cleanup on next push attempt):', err);
      }
      setIsSubscribed(false);
      return { ok: true };
    } catch (err: any) {
      console.error('[Push] unsubscribe failed:', err);
      return { ok: false, error: err?.message || 'unknown' };
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
    refresh,
  };
}
