/**
 * Helpers para CSRF protection (Fase 3 de F3).
 *
 * Patron: double-submit cookie.
 * - Backend genera un token aleatorio (32 bytes hex), lo setea en una
 *   cookie NO-httpOnly (asi el JS del frontend la puede leer) y rota el
 *   token en cada login/refresh.
 * - Frontend lee la cookie (document.cookie) y la envia en cada request
 *   mutante como header `X-CSRF-Token`.
 * - Backend (CsrfGuard) compara: header debe coincidir con cookie. Si
 *   no, 403.
 *
 * Por que funciona contra CSRF: un atacante en otra origen NO puede
 * leer la cookie csrf_token (salvo via XSS, pero entonces ya hay un
 * problema mas grave). El navegador adjunta automaticamente la cookie
 * de sesion (access_token) en cualquier request al backend, pero NO el
 * header X-CSRF-Token — eso lo hace el frontend explicitamente. Sin
 * el header, el guard rechaza.
 *
 * sameSite='none' en prod (mismo que access_token cookie) permite
 * cross-site fetch desde el frontend; secure=true requiere HTTPS.
 */

import { randomBytes } from 'crypto';
import type { Response } from 'express';

export const CSRF_TOKEN_COOKIE = 'csrf_token';
/** Header en lower-case (Express normaliza headers). */
export const CSRF_TOKEN_HEADER = 'x-csrf-token';

/** 32 bytes = 64 chars hex. Suficiente entropia para no ser adivinable. */
const CSRF_TOKEN_LENGTH = 32;

export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

function baseCsrfCookieOptions(isProd: boolean) {
  return {
    // CRUCIAL: NO httpOnly — el JS del frontend tiene que leerla para
    // mandarla en el header X-CSRF-Token. La proteccion CSRF NO depende
    // del httpOnly (cualquier sitio puede leer SUS PROPIAS cookies; lo
    // que un atacante cross-site no puede hacer es LEER las del victim).
    httpOnly: false,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
  };
}

export function setCsrfTokenCookie(
  res: Response,
  token: string,
  isProd: boolean,
): void {
  res.cookie(CSRF_TOKEN_COOKIE, token, baseCsrfCookieOptions(isProd));
}

export function clearCsrfTokenCookie(res: Response, isProd: boolean): void {
  res.clearCookie(CSRF_TOKEN_COOKIE, baseCsrfCookieOptions(isProd));
}
