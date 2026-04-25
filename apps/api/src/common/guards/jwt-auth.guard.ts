import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * JwtAuthGuard global (APP_GUARD en app.module.ts).
 *
 * Postura: secure-by-default. Cualquier endpoint requiere un JWT válido
 * salvo que esté marcado con `@Public()` (decorator que setea metadata
 * `isPublic=true`). El reflector lee esa metadata desde el handler O la
 * clase, así `@Public()` puede aplicarse a un método individual o a todo
 * el controller.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
