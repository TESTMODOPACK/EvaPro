/**
 * backfill-kpi-to-recurring-metric.ts — Audit P2, Tarea 10.3.
 *
 * Migración OPCIONAL de KPIs legacy a la nueva entidad RecurringMetric.
 * Por cada `objective WHERE type='KPI' AND status NOT IN
 * ('cancelled','abandoned')`:
 *   1. Crea una RecurringMetric con: name=title, description, unit='%',
 *      targetValue=100, frequency=monthly, ownerUserId=objective.userId,
 *      migratedFromObjectiveId=objective.id (preserva linaje).
 *   2. Crea una MetricMeasurement inicial con value=objective.progress,
 *      observedAt=NOW, observedBy=objective.userId.
 *   3. Marca el objective KPI como CANCELLED con razón
 *      "Migrado a RecurringMetric — usar dashboard de Métricas".
 *
 * Operación NO automática: cada tenant decide cuándo correrla. Es
 * destructiva en el sentido que el KPI legacy queda CANCELLED — pero
 * preserva todo el data via migratedFromObjectiveId + cancellation_reason.
 *
 * Idempotente: re-corridas filtran KPIs ya migrados (los CANCELLED no
 * matchean el WHERE).
 *
 * Filtro por tenant: si TENANT_ID está seteado en el env, solo procesa
 * ese tenant. Útil para migración progresiva por cliente.
 *
 * Run:
 *   docker compose exec api node dist/database/backfill-kpi-to-recurring-metric.js
 *   # solo un tenant:
 *   TENANT_ID=xxx docker compose exec api node dist/database/backfill-kpi-to-recurring-metric.js
 */

import 'reflect-metadata';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const TENANT_ID = process.env.TENANT_ID;
const isProduction = process.env.NODE_ENV === 'production';
const MIGRATION_REASON =
  'Migrado a RecurringMetric (KPI ahora es métrica recurrente con mediciones periódicas).';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

interface CandidateRow {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  description: string | null;
  progress: number;
}

async function runBackfill(): Promise<void> {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl:
      isProduction && process.env.DB_SSL !== 'false'
        ? { rejectUnauthorized: false }
        : false,
  });

  try {
    await client.connect();
    console.log('Running backfill: KPI legacy → RecurringMetric (T10.3)...');
    if (TENANT_ID) {
      console.log(`  [info] scope: tenant=${TENANT_ID}`);
    }

    await client.query('BEGIN');

    try {
      const tenantClause = TENANT_ID ? 'AND tenant_id = $1' : '';
      const params = TENANT_ID ? [TENANT_ID] : [];

      const candidates = await client.query<CandidateRow>(
        `
          SELECT id, tenant_id, user_id, title, description, progress
          FROM objectives
          WHERE type = 'KPI'
            AND status NOT IN ('cancelled', 'abandoned')
            ${tenantClause}
        `,
        params,
      );

      console.log(`  [info] KPIs candidatos: ${candidates.rows.length}`);

      if (candidates.rows.length === 0) {
        await client.query('COMMIT');
        console.log('  [ok] nada que migrar.');
        return;
      }

      let migratedCount = 0;
      const failures: Array<{ id: string; reason: string }> = [];

      for (const row of candidates.rows) {
        try {
          // 1. Crear RecurringMetric
          const metricResult = await client.query<{ id: string }>(
            `
              INSERT INTO recurring_metrics (
                id, tenant_id, owner_user_id, name, description, unit,
                target_value, higher_is_better, frequency, is_active,
                migrated_from_objective_id, created_at, updated_at
              ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4, '%',
                100, TRUE, 'monthly', TRUE,
                $5, NOW(), NOW()
              )
              RETURNING id
            `,
            [row.tenant_id, row.user_id, row.title, row.description, row.id],
          );
          const metricId = metricResult.rows[0].id;

          // 2. Medición inicial con el progress actual
          await client.query(
            `
              INSERT INTO metric_measurements (
                id, tenant_id, recurring_metric_id, value, observed_at,
                observed_by, notes, created_at
              ) VALUES (
                gen_random_uuid(), $1, $2, $3, NOW(),
                $4, $5, NOW()
              )
            `,
            [
              row.tenant_id,
              metricId,
              row.progress,
              row.user_id,
              `Migración inicial: progress del KPI legacy ${row.id.slice(0, 8)} al momento de la migración.`,
            ],
          );

          // 3. Cancelar el KPI legacy
          await client.query(
            `
              UPDATE objectives
              SET status = 'cancelled',
                  cancellation_reason = $2,
                  cancelled_by = user_id,
                  cancelled_at = NOW(),
                  updated_at = NOW()
              WHERE id = $1
            `,
            [row.id, MIGRATION_REASON],
          );

          // 4. Audit
          await client.query(
            `
              INSERT INTO audit_logs (
                id, tenant_id, user_id, action, entity_type, entity_id, metadata, created_at
              ) VALUES (
                gen_random_uuid(), $1, $2, 'kpi.migrated_to_recurring_metric',
                'recurring_metric', $3, $4::jsonb, NOW()
              )
            `,
            [
              row.tenant_id,
              row.user_id,
              metricId,
              JSON.stringify({
                sourceObjectiveId: row.id,
                title: row.title,
                progressAtMigration: row.progress,
              }),
            ],
          );

          migratedCount++;
        } catch (itemErr: unknown) {
          const msg =
            itemErr instanceof Error ? itemErr.message : String(itemErr);
          failures.push({ id: row.id, reason: msg });
        }
      }

      console.log(`  [ok] KPIs migrados: ${migratedCount}`);
      if (failures.length > 0) {
        console.warn(`  [warn] fallos: ${failures.length}`);
        for (const f of failures.slice(0, 10)) {
          console.warn(`    ${f.id.slice(0, 8)}: ${f.reason}`);
        }
      }

      await client.query('COMMIT');
      console.log('\nBackfill complete.');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Backfill failed:', msg);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

void runBackfill();
