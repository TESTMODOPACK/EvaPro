/**
 * backfill-abandoned-to-cancelled.ts — Audit P1, Tarea 7.4.
 *
 * Antes de T7, ABANDONED se usaba como cubo semántico para CUALQUIER
 * cierre no-completado: cancelaciones de negocio, scope-changes, soft-
 * deletes admin, abandonos por owner. Después de T7, ABANDONED queda
 * reservado para soft-delete admin y CANCELLED es el estado de cierre
 * por decisión de negocio.
 *
 * Hipótesis razonable: la mayoría de los ABANDONED históricos son
 * cancelaciones de negocio (no soft-deletes admin reales) — el flujo
 * actual no distingue, así que asumimos buena fe del usuario.
 *
 * Estrategia: pasar TODOS los ABANDONED actuales a CANCELLED con
 * razón genérica de backfill, EXCEPTO los que tengan audit_log
 * 'objective.cancelled' disparado por un super_admin/tenant_admin
 * (que muy probablemente sí eran soft-deletes técnicos).
 *
 * En la práctica: hacerlo manual-aware — cualquier ABANDONED es
 * sospechoso de ser una cancelación de negocio. Backfill conservador:
 * lo movemos a CANCELLED con `cancellationReason='Backfill T7:
 * abandoned histórico re-clasificado a cancelado'` y `cancelledBy`
 * = userId del owner (no podemos saber quién canceló sin audit
 * granular). Si un admin necesita re-clasificar como ABANDONED
 * puede correr DELETE manualmente.
 *
 * Idempotente: re-ejecutable. La segunda corrida no encuentra filas
 * porque las que ya quedaron en CANCELLED no califican.
 *
 * Run:
 *   docker compose exec api node dist/database/backfill-abandoned-to-cancelled.js
 */

import 'reflect-metadata';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';
const BACKFILL_REASON =
  'Backfill T7 — Audit P1: re-clasificado de abandonado a cancelado tras separación semántica de los estados.';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

interface CandidateRow {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
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
    console.log('Running backfill: abandoned → cancelled (T7.4)...');

    await client.query('BEGIN');

    try {
      const candidates = await client.query<CandidateRow>(`
        SELECT id, tenant_id, user_id, title
        FROM objectives
        WHERE status = 'abandoned'
          -- Re-clasificamos solo los ABANDONED sin razón de cancelación
          -- previa (defensa: si el script ya corrió y los movió, no
          -- los volvemos a tocar — re-corrida idempotente).
          AND cancellation_reason IS NULL
      `);

      console.log(`  [info] candidatos encontrados: ${candidates.rows.length}`);

      if (candidates.rows.length === 0) {
        await client.query('COMMIT');
        console.log(
          '  [ok] nada que reclasificar — backfill ya aplicado o tabla limpia.',
        );
        return;
      }

      const ids = candidates.rows.map((r) => r.id);
      const result = await client.query<{ id: string }>(
        `
          UPDATE objectives
          SET status = 'cancelled',
              cancellation_reason = $2,
              cancelled_by = user_id,
              cancelled_at = COALESCE(updated_at, NOW()),
              updated_at = NOW()
          WHERE id = ANY($1::uuid[])
            AND status = 'abandoned'
          RETURNING id
        `,
        [ids, BACKFILL_REASON],
      );

      console.log(`  [ok] reclasificados a cancelled: ${result.rowCount ?? 0}`);

      // Audit por tenant
      const byTenant = candidates.rows.reduce<Record<string, number>>(
        (acc, r) => {
          acc[r.tenant_id] = (acc[r.tenant_id] ?? 0) + 1;
          return acc;
        },
        {},
      );
      console.log('\nResumen por tenant:');
      for (const [tid, count] of Object.entries(byTenant)) {
        console.log(`  tenant=${tid.slice(0, 8)}... reclasificados=${count}`);
      }

      // Una fila de audit_logs por reclassification
      try {
        for (const row of candidates.rows) {
          await client.query(
            `
              INSERT INTO audit_logs (
                id, tenant_id, user_id, action, entity_type, entity_id, metadata, created_at
              ) VALUES (
                gen_random_uuid(), $1, $2, $3, 'objective', $4, $5::jsonb, NOW()
              )
            `,
            [
              row.tenant_id,
              row.user_id,
              'objective.reclassified.abandoned_to_cancelled',
              row.id,
              JSON.stringify({
                title: row.title,
                actor: 'system:backfill-T7',
                reason: BACKFILL_REASON,
              }),
            ],
          );
        }
        console.log(`  [ok] audit_logs entries: ${candidates.rows.length}`);
      } catch (auditErr: unknown) {
        const msg =
          auditErr instanceof Error ? auditErr.message : String(auditErr);
        console.warn(`  [warn] audit_logs insert falló: ${msg}`);
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
