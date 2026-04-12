import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DataSource } from 'typeorm';
import * as Sentry from '@sentry/nestjs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly dataSource: DataSource) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // ─── Sentry context enrichment ────────────────────────────────────
    // Cualquier excepcion capturada durante este request va a llegar a
    // Sentry con tags de tenant/role + user.id. No mandamos el email
    // (PII, evitamos compliance risk).
    //
    // `getIsolationScope()` retorna el scope aislado del request actual
    // (creado por el HTTP instrumentation de @sentry/node v8+ en cada
    // request entrante). Usarlo explicitamente garantiza que el setUser
    // no leakea a requests concurrentes, incluso si Sentry esta
    // configurado con un scope global compartido por accidente.
    if (user) {
      const scope = Sentry.getIsolationScope();
      scope.setUser({
        id: user.userId || user.id || 'unknown',
        // NO incluimos email — lo filtramos a proposito para GDPR.
        // username es lo que aparece en la UI de Sentry sin ser PII.
        username: user.role || undefined,
      });
      scope.setTag('tenantId', user.tenantId || 'none');
      scope.setTag('role', user.role || 'none');
    }

    // super_admin operates across all tenants — skip tenant context
    if (user && user.role === 'super_admin') {
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', '', true)`,
      );
      return next.handle();
    }

    if (user && user.tenantId && UUID_REGEX.test(user.tenantId)) {
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [user.tenantId],
      );
    } else {
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', '', true)`,
      );
    }

    return next.handle();
  }
}
