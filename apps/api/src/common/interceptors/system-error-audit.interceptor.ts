import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Optional,
  HttpException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuditService } from '../../modules/audit/audit.service';

/**
 * SystemErrorAuditInterceptor
 * ---------------------------
 * Escribe un `system.error` en el audit log cada vez que un handler HTTP
 * lanza una excepción inesperada (5xx o error no-HTTP). No intercepta 4xx
 * de cliente (Bad Request, Not Found, Unauthorized, Forbidden, Conflict),
 * ni `access.denied` que ya registra RolesGuard.
 *
 * El audit queda scopeado al tenant del usuario autenticado; si no hay
 * usuario o el usuario es super_admin, se guarda con tenantId=null
 * (entrada system-level sólo visible para super_admin).
 *
 * Este interceptor NO reemplaza a Sentry — corre en paralelo: Sentry
 * sigue reportando el error al dashboard externo, y aquí dejamos el
 * rastro para búsqueda forense desde el propio panel de auditoría.
 */
@Injectable()
export class SystemErrorAuditInterceptor implements NestInterceptor {
  constructor(@Optional() private readonly auditService?: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((err) => {
        const status =
          err instanceof HttpException ? err.getStatus() : undefined;
        // Sólo auditamos 5xx o errores no-HTTP (inesperados).
        // 4xx son comportamiento esperado del cliente.
        const is5xx = status !== undefined && status >= 500;
        const isNonHttp = status === undefined;
        if (is5xx || isNonHttp) {
          try {
            const req = context.switchToHttp().getRequest();
            const user = req?.user;
            this.auditService
              ?.logFailure('system.error', {
                tenantId:
                  user?.role === 'super_admin'
                    ? null
                    : user?.tenantId ?? null,
                userId: user?.userId ?? null,
                entityType: 'Endpoint',
                entityId:
                  (req?.method || '') +
                  ' ' +
                  (req?.route?.path || req?.originalUrl || req?.url || ''),
                error: err,
                metadata: {
                  status: status ?? 'unknown',
                  method: req?.method,
                  path: req?.route?.path || req?.originalUrl || req?.url,
                  name: (err as any)?.name,
                },
                ipAddress:
                  req?.ip || req?.headers?.['x-forwarded-for'] || undefined,
              })
              .catch(() => {});
          } catch {
            // Never let auditing break the error flow.
          }
        }
        return throwError(() => err);
      }),
    );
  }
}
