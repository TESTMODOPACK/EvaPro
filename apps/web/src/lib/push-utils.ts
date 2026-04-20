/**
 * Convierte una VAPID public key en formato base64url (como la devuelve
 * el backend) a Uint8Array — el formato que pushManager.subscribe espera
 * en `applicationServerKey`.
 *
 * base64url: como base64 pero reemplazando `+` → `-` y `/` → `_`, y sin
 * padding `=`. Esta función revierte ambas transformaciones y luego usa
 * `atob()` + conversión a bytes.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Padded = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64Padded);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    bytes[i] = rawData.charCodeAt(i);
  }
  return bytes;
}
