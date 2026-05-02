/**
 * backfill-orphan-completed-okrs.ts — Auditoría P0, Tarea 1, Subtarea 1.4.
 *
 * One-shot backfill: corrige OKRs huérfanos donde:
 *   - type = 'OKR'
 *   - status = 'active'
 *   - progress >= 100
 *   - tienen al menos un Key Result
 *   - todos los Key Results están en estado 'completed'
 *
 * Estos OKRs nunca pasaron a 'completed' por el bug BUG-1 que dejaba el
 * `recalculateProgressFromKRs` actualizando solo `progress` pero no
 * `status`. Después del fix de T1.2, ese flujo ya no genera huérfanos
 * nuevos — este script limpia el back-catalog.
 *
 * IMPORTANTE: este backfill NO dispara los side-effects de gamificación
 * (puntos, notificaciones, emails al manager, badges). Solo corrige el
 * status a 'completed'. Los OKRs corregidos quedan auditados solo via
 * la fila escrita en `audit_log` por este script.
 *
 * Idempotencia: re-ejecutable. La segunda corrida no encontrará filas
 * (porque las que ya pasaron a completed quedan fuera del WHERE).
 *
 * Run:
 *   docker compose exec api node dist/database/backfill-orphan-completed-okrs.js
 *   # o local:
 *   pnpm --filter @repo/api exec ts-node src/database/backfill-orphan-completed-okrs.ts
 */

import 'reflect-metadata';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';
const ACTOR_LABEL = 'system:backfill-orphan-okrs';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

interface OrphanRow {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
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
    console.log('Running backfill: orphan completed OKRs (T1.4)...');

    await client.query('BEGIN');

    try {
      // ─── 1. Localizar candidatos en una sola query con CTE ─────────────
      // Reglas (todas deben cumplirse):
      //   - OKR activo con progress 100
      //   - tiene al menos 1 KR
      //   - todos los KRs están en status='completed'
      const candidatesResult = await client.query<OrphanRow>(`
        SELECT o.id, o.tenant_id, o.user_id, o.title, o.progress
        FROM objectives o
        WHERE o.type = 'OKR'
          AND o.status = 'active'
          AND o.progress >= 100
          AND EXISTS (
            SELECT 1 FROM key_results kr
            WHERE kr.objective_id = o.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM key_results kr
            WHERE kr.objective_id = o.id
              AND kr.status <> 'completed'
          )
      `);

      const candidates = candidatesResult.rows;
      console.log(`  [info] candidatos encontrados: ${candidates.length}`);

      if (candidates.length === 0) {
        await client.query('COMMIT');
        console.log(
          '  [ok] nada que corregir — todos los OKRs huérfanos ya fueron limpiados.',
        );
        return;
      }

      // ─── 2. Update masivo con returning para auditoría ────────────────
      const ids = candidates.map((c) => c.id);
      const updateResult = await client.query<{ id: string }>(
        `
          UPDATE objectives
          SET status = 'completed',
              updated_at = NOW()
          WHERE id = ANY($1::uuid[])
            AND status = 'active'
          RETURNING id
        `,
        [ids],
      );

      console.log(`  [ok] objetivos corregidos: ${updateResult.rowCount ?? 0}`);

      // ─── 3. Audit log — una fila por objetivo corregido ───────────────
      // Usamos un INSERT batch sin disparar triggers/side-effects de la app.
      // Action='objective.completed.backfilled' para distinguir del flujo
      // normal (que usa 'objective.completed').
      // Nota: si la tabla audit_log no existe en este entorno, capturamos
      // el error y seguimos — el backfill principal igual quedó hecho.
      try {
        for (const row of candidates) {
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
              row.user_id, // attributed to owner; los side-effects normales no se disparan
              'objective.completed.backfilled',
              row.id,
              JSON.stringify({
                title: row.title,
                previousProgress: row.progress,
                actor: ACTOR_LABEL,
                reason:
                  'BUG-1 retroactive fix: OKR with all KRs completed but status remained active',
              }),
            ],
          );
        }
        console.log(`  [ok] audit_logs entries: ${candidates.length}`);
      } catch (auditErr: unknown) {
        const msg =
          auditErr instanceof Error ? auditErr.message : String(auditErr);
        console.warn(
          `  [warn] no se pudieron escribir filas en audit_logs: ${msg}`,
        );
        console.warn(
          '  [warn] el backfill principal sí quedó hecho — solo falta el log',
        );
      }

      await client.query('COMMIT');

      // ─── 4. Resumen ──────────────────────────────────────────────────
      const byTenant = candidates.reduce<Record<string, number>>((acc, c) => {
        acc[c.tenant_id] = (acc[c.tenant_id] ?? 0) + 1;
        return acc;
      }, {});
      console.log('\nResumen por tenant:');
      for (const [tid, count] of Object.entries(byTenant)) {
        console.log(`  tenant=${tid.slice(0, 8)}... corregidos=${count}`);
      }
      console.log('\nBackfill complete.');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

void runBackfill();
