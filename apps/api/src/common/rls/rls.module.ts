import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../../modules/tenants/entities/tenant.entity';
import { TenantCronRunner } from './tenant-cron-runner';

/**
 * F4 — Modulo de utilidades para Row-Level Security.
 *
 * Exporta:
 *   - TenantCronRunner: helper para que cron jobs seteen el
 *     app.current_tenant_id explicitamente (los crons no pasan por
 *     el TenantContextInterceptor que sirve a requests HTTP).
 *
 * Modulos que tienen @Cron handlers tenant-scoped deben importar este
 * modulo para inyectar TenantCronRunner.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  providers: [TenantCronRunner],
  exports: [TenantCronRunner],
})
export class RlsModule {}
