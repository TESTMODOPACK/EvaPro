import { Injectable, CanActivate, ExecutionContext, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuditService } from '../../modules/audit/audit.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }
    const req = context.switchToHttp().getRequest();
    const { user } = req;
    const allowed = requiredRoles.some((role) => user?.role?.includes(role));
    if (!allowed) {
      // access.denied — logueo asíncrono, no bloquea el 403
      // Solo el rol del actor determina el scope: super_admin → tenantId=null
      this.auditService
        ?.logFailure('access.denied', {
          tenantId: user?.role === 'super_admin' ? null : (user?.tenantId ?? null),
          userId: user?.userId ?? null,
          entityType: 'Endpoint',
          entityId: req.method + ' ' + (req.route?.path || req.originalUrl || req.url),
          metadata: {
            requiredRoles,
            actualRole: user?.role || null,
            method: req.method,
            path: req.route?.path || req.originalUrl || req.url,
          },
          ipAddress: req.ip || req.headers?.['x-forwarded-for'] || undefined,
        })
        .catch(() => {});
    }
    return allowed;
  }
}
