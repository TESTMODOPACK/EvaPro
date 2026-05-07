/**
 * add-recurring-metrics.ts — Audit P2, Tarea 10.1.
 *
 * Crea las tablas `recurring_metrics` y `metric_measurements` para la
 * nueva entidad de métricas recurrentes. KPI legacy (objectives.type='KPI')
 * sigue funcionando — esta migración es additive.
 *
 * Idempotente — re-ejecutable.
 *
 * Run:
 *   docker compose exec api node dist/database/add-recurring-metrics.js
 */

import 'reflect-metadata';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

async function runMigration(): Promise<void> {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl:
      isProduction && process.env.DB_SSL !== 'false'
        ? { rejectUnauthorized: false }
        : false,
  });

  try {
    await client.connect();
    console.log(
      'Running migration: recurring_metrics + metric_measurements (T10.1)...',
    );

    // 1. Enum frequency (fuera de transacción explícita)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recurring_metrics_frequency_enum') THEN
          CREATE TYPE recurring_metrics_frequency_enum AS ENUM ('daily', 'weekly', 'monthly', 'quarterly');
        END IF;
      END $$;
    `);
    console.log('  [ok] enum recurring_metrics_frequency_enum ensured');

    // 2. Tablas en transacción
    await client.query('BEGIN');
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS recurring_metrics (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL,
          owner_user_id UUID NOT NULL,
          name VARCHAR(200) NOT NULL,
          description TEXT NULL,
          unit VARCHAR(50) NOT NULL,
          target_value DECIMAL(14,4) NOT NULL,
          higher_is_better BOOLEAN NOT NULL DEFAULT TRUE,
          threshold_green DECIMAL(14,4) NULL,
          threshold_yellow DECIMAL(14,4) NULL,
          frequency recurring_metrics_frequency_enum NOT NULL DEFAULT 'monthly',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          migrated_from_objective_id UUID NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

          CONSTRAINT fk_rm_tenant
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_rm_owner
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
      console.log('  [ok] table recurring_metrics ensured');

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rm_tenant_owner
          ON recurring_metrics (tenant_id, owner_user_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rm_tenant_active
          ON recurring_metrics (tenant_id, is_active);
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS metric_measurements (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL,
          recurring_metric_id UUID NOT NULL,
          value DECIMAL(14,4) NOT NULL,
          observed_at TIMESTAMPTZ NOT NULL,
          observed_by UUID NOT NULL,
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

          CONSTRAINT fk_mm_tenant
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_mm_metric
            FOREIGN KEY (recurring_metric_id) REFERENCES recurring_metrics(id) ON DELETE CASCADE,
          CONSTRAINT fk_mm_observer
            FOREIGN KEY (observed_by) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
      console.log('  [ok] table metric_measurements ensured');

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_mm_metric_observed
          ON metric_measurements (recurring_metric_id, observed_at DESC);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_mm_tenant
          ON metric_measurements (tenant_id);
      `);
      console.log('  [ok] indexes ensured');

      await client.query('COMMIT');
      console.log('Migration complete.');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Migration failed:', msg);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

void runMigration();
