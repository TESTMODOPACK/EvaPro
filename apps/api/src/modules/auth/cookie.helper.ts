/**
 * Helpers para la cookie httpOnly del access_token.
 *
 * Decisión arquitectónica (F3):
 * - Cookie httpOnly elimina la superficie XSS — el JS de la página NO
 *   puede leer el JWT, contrasta con localStorage donde cualquier script
 *   inyectado lo extrae trivialmente.
 * - sameSite: 'lax' permite navegación normal entre subdominios y bloquea
 *   CSRF básico (POST/PUT desde sitios externos no envían la cookie).
 *   Mitigación adicional contra CSRF: double-submit token (Fase 3).
 * - secure: true en producción (solo HTTPS) — false en dev permite
 *   localhost sin TLS.
 * - maxAge: matchea el TTL del JWT para que cookie y token expiren juntos.
 *   Se calcula del claim `exp` del JWT (que ya respeta JWT_EXPIRATION o
 *   el sessionTimeoutMinutes del tenant).
 */

import type { Response } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';

const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000; // 30min — fallback si exp no se puede leer

/**
 * Decodifica el claim `exp - iat` del JWT (en segundos) y devuelve el
 * delta en milisegundos. Si el JWT no tiene esos claims o no es parseable,
 * retorna DEFAULT_MAX_AGE_MS. NO valida la firma — solo parsea el payload
 * para alimentar el maxAge de la cookie. La validación real de la firma
 * la hace JwtStrategy en cada request.
 */
function jwtTtlMs(accessToken: string): number {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return DEFAULT_MAX_AGE_MS;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    ) as { exp?: number; iat?: number };
    if (typeof payload.exp === 'number' && typeof payload.iat === 'number') {
      return Math.max(1000, (payload.exp - payload.iat) * 1000);
    }
  } catch {
    // ignore — usamos default
  }
  return DEFAULT_MAX_AGE_MS;
}

function baseCookieOptions(isProd: boolean) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
  };
}

/**
 * Setea la cookie del access_token con maxAge que matchea el TTL del JWT.
 * El isProd se obtiene de NODE_ENV en el controller para mantener este
 * helper agnóstico al ConfigService.
 */
export function setAccessTokenCookie(
  res: Response,
  accessToken: string,
  isProd: boolean,
): void {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...baseCookieOptions(isProd),
    maxAge: jwtTtlMs(accessToken),
  });
}

/**
 * Limpia la cookie del access_token (logout). Importante: pasar las MISMAS
 * options que setAccessTokenCookie excepto maxAge — Express necesita el
 * mismo path/sameSite/secure para hacer match.
 */
export function clearAccessTokenCookie(res: Response, isProd: boolean): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, baseCookieOptions(isProd));
}
