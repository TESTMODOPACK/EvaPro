import { SetMetadata } from '@nestjs/common';

/**
 * Marca un endpoint como público — el `JwtAuthGuard` global registrado en
 * app.module.ts lo bypassa y deja la request pasar sin auth.
 *
 * Uso:
 *   @Public()
 *   @Post('login')
 *   login() { ... }
 *
 * Postura por default desde F2 Paso 8: TODO endpoint requiere JWT salvo
 * que se marque explícitamente con `@Public()`. Reemplaza el patrón viejo
 * de `@UseGuards(AuthGuard('jwt'))` por endpoint, que dejaba abierto cualquier
 * endpoint nuevo si el desarrollador olvidaba el guard.
 *
 * Aplica también a endpoints que usan otra estrategia (ej. `jwt-refresh`):
 * marcarlos `@Public()` para bypassar el global y dejar que el
 * method-level `@UseGuards(AuthGuard('jwt-refresh'))` haga su propio check.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
