import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { runInTransaction } from 'typeorm-transactional';
import { Tenant } from '../../modules/tenants/entities/tenant.entity';

/**
 * Helper para cron jobs en F4 (Row-Level Security).
 *
 * Los crons no pasan por el `TenantContextInterceptor` (no hay request
 * HTTP), asi que necesitan setear el `app.current_tenant_id`
 * explicitamente. Sin esto, cuando RLS se active en Fase B/C, las
 * queries de los crons retornarian 0 rows porque no hay tenant
 * context configurado.
 *
 * Dos APIs:
 *
 *   1. `runForEachTenant(callback)` — itera sobre tenants ACTIVOS y
 *      ejecuta el callback una vez por cada uno, dentro de una tx con
 *      `app.current_tenant_id = tenantId`. Errores en un tenant NO
 *      paran al siguiente — se loguean pero el cron sigue.
 *
 *      Patron de uso: crons que aplican logica per-tenant (ej.
 *      remindPendingEvaluations, autoCompleteStaleCheckIns).
 *
 *   2. `runAsSystem(callback)` — ejecuta el callback con
 *      `app.current_tenant_id = ''` (marker de "sistema" / cross-tenant).
 *      Las RLS policies en Fase B/C reconoceran este valor para
 *      permitir bypass en operaciones admin/sistema legitimas
 *      (cleanup, dunning, expiracion de trials).
 *
 *      Patron de uso: crons globales (cleanup notifications, expirar
 *      subscriptions, escalar invoices vencidas).
 *
 * Sin uso vs interceptor: el interceptor abre una tx por request HTTP.
 * Aqui abrimos una tx por tenant (en runForEachTenant) o una sola
 * (en runAsSystem). Dentro de la tx, `set_config(... true)` es
 * transaction-local — el COMMIT/ROLLBACK auto-resetea, no hay leak
 * entre tenants ni entre crons.
 */
@Injectable()
export class TenantCronRunner {
  private readonly logger = new Logger(TenantCronRunner.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
  ) {}

  /**
   * Ejecuta el callback una vez por cada tenant activo. Cada ejecucion
   * va en su propia transaccion, con `app.current_tenant_id` seteado
   * al UUID del tenant. El COMMIT al final de la callback resetea las
   * session vars (set_config con is_local=true).
   *
   * @returns array con los results de cada tenant en el orden en que
   *   se procesaron. Tenants donde la callback throwea reciben
   *   `undefined` en su slot — el error se loguea pero NO detiene el
   *   procesamiento de otros tenants (los crons no deben caerse por
   *   un solo tenant problematico).
   */
  async runForEachTenant<T>(
    label: string,
    callback: (tenantId: string) => Promise<T>,
  ): Promise<Array<T | undefined>> {
    const tenants = await this.tenantRepo.find({
      where: { isActive: true },
      select: ['id'],
    });

    this.logger.log(
      `[${label}] processing ${tenants.length} active tenants`,
    );

    const results: Array<T | undefined> = [];
    for (const tenant of tenants) {
      try {
        const result = await runInTransaction(async () => {
          await this.dataSource.query(
            `SELECT set_config('app.current_tenant_id', $1, true)`,
            [tenant.id],
          );
          return callback(tenant.id);
        });
        results.push(result);
      } catch (err) {
        // Aislar fallas per-tenant para que un tenant problematico
        // no rompa el cron entero. Loguea + sigue. Sentry captura el
        // stack via el global filter.
        this.logger.warn(
          `[${label}] tenant=${tenant.id.slice(0, 8)} fallo: ${(err as Error).message}`,
        );
        results.push(undefined);
      }
    }

    this.logger.log(
      `[${label}] completed (${results.filter((r) => r !== undefined).length}/${tenants.length} ok)`,
    );
    return results;
  }

  /**
   * Ejecuta el callback en modo sistema — sin tenant context. Para
   * operaciones que cross-tenant legitimamente: cleanup admin,
   * dunning de invoices, expirar trials.
   *
   * IMPORTANTE: cuando RLS este activo (Fase B/C), las policies deben
   * reconocer `app.current_tenant_id = ''` como "system context" Y
   * permitir bypass para operaciones de mantenimiento. Si la policy
   * NO permite bypass con valor vacio, este cron retornara 0 rows.
   * Esto se valida en Fase B con el primer rollout.
   */
  async runAsSystem<T>(
    label: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    return runInTransaction(async () => {
      this.logger.log(`[${label}] running as system (no tenant context)`);
      await this.dataSource.query(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        [''],
      );
      return callback();
    });
  }
}
