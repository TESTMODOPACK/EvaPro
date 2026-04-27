import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Logger } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { DataSource } from 'typeorm';
import { runInTransaction } from 'typeorm-transactional';
import * as Sentry from '@sentry/nestjs';
import { firstValueFrom } from 'rxjs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Interceptor que setea `app.current_tenant_id` en la transaccion de
 * Postgres para cada request, alimentando las (futuras) RLS policies.
 *
 * F4 — Fase A2 (connection pinning via typeorm-transactional).
 *
 * Como funciona:
 *   1. El interceptor setea Sentry context con tenantId/role.
 *   2. Wrappea next.handle() en runInTransaction de typeorm-transactional.
 *   3. Al inicio de la tx: `set_config('app.current_tenant_id', uuid, true)`
 *      — el `true` es transaction-local, ahora correcto porque estamos
 *      DENTRO de una tx explicita.
 *   4. typeorm-transactional propaga la tx via AsyncLocalStorage a todas
 *      las queries que el controller dispara via @InjectRepository — sin
 *      tener que refactorizar ningun service. Todas ven el mismo
 *      app.current_tenant_id.
 *   5. El COMMIT/ROLLBACK al final de la tx auto-resetea las session
 *      vars (ese es el comportamiento de SET LOCAL) — no hay leak entre
 *      requests aunque el connection pool reuse la conexion.
 *
 * Tradeoffs:
 *   - Cada request ahora es una transaccion explicita: +1-2ms overhead
 *     por BEGIN/COMMIT.
 *   - Requests largos retienen una conexion del pool por mas tiempo.
 *     Mitigado por idle_in_transaction_session_timeout=60s en Postgres.
 *   - Las 13 instancias existentes de dataSource.transaction() se
 *     convierten en transactions anidadas → savepoints. TypeORM lo
 *     maneja correctamente.
 *
 * Pre-requisitos:
 *   - typeorm-transactional@0.5.x instalado y inicializado en main.ts
 *     (initializeTransactionalContext) ANTES de NestFactory.create.
 *   - DataSource registrado con addTransactionalDataSource en
 *     database.module.ts.
 *
 * Sin RLS activo aun (Fase B), este interceptor solo propaga el var
 * pero ninguna policy lo consume todavia. Es preparatorio.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantContextInterceptor.name);

  constructor(private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // ─── Sentry context enrichment ────────────────────────────────────
    // Cualquier excepcion capturada durante este request va a llegar a
    // Sentry con tags de tenant/role + user.id. No mandamos el email
    // (PII, evitamos compliance risk).
    if (user) {
      const scope = Sentry.getIsolationScope();
      scope.setUser({
        id: user.userId || user.id || 'unknown',
        username: user.role || undefined,
      });
      scope.setTag('tenantId', user.tenantId || 'none');
      scope.setTag('role', user.role || 'none');
    }

    const tenantValue = this.resolveTenantValue(user);

    // Wrappear el controller en una transaccion. typeorm-transactional
    // propaga el contexto via AsyncLocalStorage; todas las queries de
    // @InjectRepository dentro de next.handle() participan en la misma
    // tx automaticamente. El SET LOCAL es valido porque estamos en tx.
    return from(
      runInTransaction(async () => {
        try {
          await this.dataSource.query(
            `SELECT set_config('app.current_tenant_id', $1, true)`,
            [tenantValue],
          );
        } catch (err) {
          // No fallar el request por un problema seteando el GUC. El
          // controller puede seguir, RLS no esta activo todavia.
          this.logger.warn(
            `set_config failed (tenantValue=${tenantValue || 'empty'}): ${(err as Error).message}`,
          );
        }
        // Ejecutar el controller dentro de la tx. firstValueFrom drena
        // el Observable. Si el controller throwea, el throw propaga
        // hacia arriba y typeorm-transactional hace ROLLBACK automatico.
        return firstValueFrom(next.handle());
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
