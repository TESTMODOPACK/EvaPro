import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NO_IMPERSONATION_KEY } from '../decorators/no-impersonation.decorator';

/**
 * Blocks endpoints decorated with `@NoImpersonation()` when the caller's
 * JWT carries an `impersonatedBy` claim. This preserves the principle that
 * the support team can observe but NOT mutate security-sensitive state
 * (password, 2FA, GDPR, tenant auth policy) while acting as another user.
 */
@Injectable()
export class NoImpersonationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isProtected = this.reflector.getAllAndOverride<boolean>(NO_IMPERSONATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isProtected) return true;

    const req = context.switchToHttp().getRequest();
    if (req?.user?.impersonatedBy) {
      throw new ForbiddenException(
        'Esta acción no está permitida durante una sesión de impersonación.',
      );
    }
    return true;
  }
}
