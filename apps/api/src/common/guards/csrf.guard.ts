import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CSRF_TOKEN_COOKIE,
  CSRF_TOKEN_HEADER,
} from '../../modules/auth/csrf.helper';

/**
 * Decorator opt-out — handler/clase con @SkipCsrf saltea la validacion.
 * Se usa para endpoints publicos especiales (webhooks, healthchecks)
 * que no son CSRF-vulnerable. La mayoria no lo necesita: el guard skip
 * naturalmente cuando no hay cookie csrf_token (request unauthenticated).
 */
export const SKIP_CSRF_KEY = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

/**
 * Metodos HTTP seguros (RFC 7231) — no causan side effects, no requieren
 * CSRF protection.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * F3 Fase 3 — CSRF guard global.
 *
 * Algoritmo:
 *   1. Si el metodo es safe (GET/HEAD/OPTIONS) → permitir (no hay state
 *      change que un atacante pueda explotar).
 *   2. Si el handler tiene @SkipCsrf → permitir.
 *   3. Si NO hay cookie csrf_token → permitir (request unauthenticated o
 *      pre-login bootstrap; no hay sesion para abusar). El login en si
 *      mismo cae en este caso — no necesita @SkipCsrf decorator porque
 *      el victim no tiene csrf_token cookie todavia.
 *   4. Si HAY cookie pero el header X-CSRF-Token no existe o no
 *      coincide → 403 Forbidden.
 *
 * El guard se registra como APP_GUARD DESPUES de JwtAuthGuard, asi:
 *   - Endpoints @Public con metodo mutante sin sesion → JWT skip + CSRF
 *     skip (no cookie). Funciona.
 *   - Endpoints autenticados → JWT valida + CSRF valida.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method: string;
      cookies?: Record<string, string>;
      headers: Record<string, string | string[] | undefined>;
    }>();

    if (SAFE_METHODS.has(request.method)) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const cookieToken = request.cookies?.[CSRF_TOKEN_COOKIE];
    if (!cookieToken) {
      // Request sin sesion (no hay cookie) — nada que CSRF abuse.
      return true;
    }

    const headerRaw =
      request.headers[CSRF_TOKEN_HEADER] ?? request.headers['X-CSRF-Token'];
    const headerToken = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

    if (!headerToken) {
      throw new ForbiddenException('CSRF token requerido');
    }
    if (headerToken !== cookieToken) {
      throw new ForbiddenException('CSRF token invalido');
    }
    return true;
  }
}
