import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { DataSource } from 'typeorm';
import * as Sentry from '@sentry/nestjs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Interceptor que setea `app.current_tenant_id` en la sesion de Postgres
 * para cada request, alimentando las (futuras) RLS policies.
 *
 * F4 — Fase A0 (preparatorio, RLS aun no enforzado).
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ LIMITACION ARQUITECTONICA CONOCIDA — connection pool leakage     ║
 * ║                                                                  ║
 * ║ Postgres session vars son por-conexion. Con TypeORM connection   ║
 * ║ pool default, cada query puede usar una conexion distinta del    ║
 * ║ pool. Esto significa que:                                        ║
 * ║                                                                  ║
 * ║   1. Esta interceptor query corre en conexion A → SET en A       ║
 * ║   2. Controller query 1 puede correr en conexion B → no ve var   ║
 * ║   3. Controller query 2 puede correr en conexion A → si ve var   ║
 * ║                                                                  ║
 * ║ Sin connection pinning real, RLS NO ES CONFIABLE. Por eso este   ║
 * ║ codigo es preparatorio — Fase A2 (proximo paso) implementa el    ║
 * ║ connection pinning via AsyncLocalStorage + dataSource.transaction║
 * ║ wrapper antes de habilitar RLS en ninguna tabla (Fase B).        ║
 * ║                                                                  ║
 * ║ Mientras tanto este interceptor entrega:                         ║
 * ║   ✓ Sentry context enrichment (tenantId/role tags)               ║
 * ║   ✓ Best-effort tenant context (mejor que nada para diagnostico) ║
 * ║   ✓ Reset on request end (defense in depth si las cosas fallan)  ║
 * ║   ✗ NO entrega aislamiento confiable hasta Fase A2                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantContextInterceptor.name);

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

    // ─── Tenant context para RLS (best-effort, ver banner arriba) ─────
    // Determinar el valor a setear:
    //   - super_admin: '' (string vacia → policy debe permitir bypass)
    //   - tenantId UUID valido: el UUID
    //   - sin user / sin tenantId / formato invalido: '' (fail-safe)
    const tenantValue = this.resolveTenantValue(user);

    try {
      // F4-A0: cambio de is_local=true (transaction-local, se perdia
      // tras la query del interceptor) a is_local=false (session-level,
      // persiste hasta RESET o fin de conexion). Esto al menos hace que
      // queries del controller que reusen la MISMA conexion vean el
      // valor. Connection pool puede dar conexiones distintas — eso se
      // resuelve en Fase A2 con connection pinning.
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', $1, false)`,
        [tenantValue],
      );
    } catch (err) {
      // No fallar el request por un problema seteando el GUC.
      // Sentry capturara el error si esta configurado (via setTag).
      this.logger.warn(
        `set_config failed (tenantValue=${tenantValue || 'empty'}): ${(err as Error).message}`,
      );
    }

    // Reset al fin del request — defense in depth contra connection
    // pool leakage. Si la conexion vuelve al pool con un valor stale,
    // la siguiente request en esa conexion arrancara desde un estado
    // limpio antes de que su propio interceptor setee el suyo.
    return next.handle().pipe(
      finalize(() => {
        this.dataSource
          .query(`SELECT set_config('app.current_tenant_id', '', false)`)
          .catch((err) => {
            this.logger.warn(`set_config reset failed: ${(err as Error).message}`);
          });
      }),
    );
  }

  /**
   * Determina el valor a setear en `app.current_tenant_id`:
   * - super_admin: '' (el RLS policy debe permitir bypass cuando el
   *   valor es vacio Y el role es super_admin — que viene del JWT, no
   *   del GUC)
   * - tenantId UUID valido: el UUID literal
   * - cualquier otro caso: '' (fail-safe; las queries no deberian ver
   *   datos cross-tenant)
   */
  private resolveTenantValue(user: any): string {
    if (!user) return '';
    if (user.role === 'super_admin') return '';
    if (user.tenantId && UUID_REGEX.test(user.tenantId)) return user.tenantId;
    return '';
  }
}
