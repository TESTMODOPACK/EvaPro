/**
 * get-client-ip.ts — Resolver seguro de IP del cliente real.
 *
 * Antes cada controller (auth, impersonation, gdpr, payments, unsubscribe)
 * tenía una copia duplicada de esta función, y todas leían el header
 * `x-forwarded-for` DIRECTAMENTE antes de `req.ip`. Eso es peligroso:
 *
 *   - Cualquier atacante puede mandar `X-Forwarded-For: 1.2.3.4` al API,
 *     y el código lo aceptaba como IP real → bypass del rate limit por IP.
 *   - Un atacante podía spammar login con diferentes headers falseados,
 *     cada uno contaba como una IP distinta, el rate limit nunca pegaba.
 *
 * Ahora:
 *   - El código usa `req.ip`, que Express resuelve CORRECTAMENTE cuando
 *     `app.set('trust proxy', ...)` está configurado en main.ts.
 *   - Si nginx es el único proxy en la red Docker y `trust proxy` está
 *     a `'loopback, linklocal, uniquelocal'`, Express solo confía en
 *     X-Forwarded-For cuando viene de IPs privadas (las de los containers),
 *     rechazando el header si un cliente externo intenta spoofearlo.
 *   - Fallback a `req.connection?.remoteAddress` por si Express no tiene
 *     req.ip resuelto (raro pero posible en tests con mocks).
 *
 * Ver también main.ts línea ~33 donde se configura trust proxy.
 */

export function getClientIp(req: any): string {
  // Priorizar req.ip (resolvido por Express con trust proxy correcto).
  // Si no está, fallback a remoteAddress de la conexión directa. NO leer
  // el header X-Forwarded-For directamente acá — Express ya lo validó.
  const ip = req?.ip || req?.connection?.remoteAddress || req?.socket?.remoteAddress;
  if (typeof ip === 'string' && ip.length > 0) {
    // Strip IPv6 prefix (::ffff:) si existe, es ruido para logs/rate limit.
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }
  return 'unknown';
}
