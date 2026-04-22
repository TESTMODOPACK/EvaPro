/**
 * add-recruitment-auto-closed.ts  (v3.1 — Recruitment date flow fix)
 *
 * Migración idempotente para:
 *   1. Agregar columna `auto_closed boolean default false` en
 *      `recruitment_processes` — distingue cierres manuales del cron
 *      de auto-cierre.
 *   2. Backfill one-shot: procesos actuales en status='active' con
 *      end_date < hoy se cierran (status='closed', auto_closed=true).
 *      Esto limpia la data histórica acumulada por la ausencia de
 *      validación previa.
 *
 * Patrón estándar: ADD COLUMN IF NOT EXISTS. Se puede correr múltiples
 * veces sin efectos colaterales.
 *
 * Run:
 *   ts-node -r tsconfig-paths/register src/database/add-recruitment-auto-closed.ts
 */

import 'reflect-metadata';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

async function runMigration() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl:
      isProduction && process.env.DB_SSL !== 'false'
        ? { rejectUnauthorized: false }
        : false,
  });

  try {
    await client.connect();
    console.log('Running migration: recruitment auto_closed (v3.1)...');

    await client.query('BEGIN');

    try {
      // ─── 1. Agregar columna auto_closed ────────────────────────────────
      await client.query(`
        ALTER TABLE recruitment_processes
          ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT FALSE;
      `);
      console.log('  [ok] recruitment_processes.auto_closed ensured');

      // ─── 2. Backfill: cerrar procesos activos vencidos ─────────────────
      //
      // Criterio: status = 'active' AND end_date < CURRENT_DATE.
      // Marcar auto_closed = true para poder distinguirlos en UI y
      // reportes. No tocamos procesos sin end_date (NULL) porque son
      // casos abiertos intencionalmente.
      const backfill = await client.query<{ count: string }>(`
        WITH expired AS (
          SELECT id FROM recruitment_processes
          WHERE status = 'active'
            AND end_date IS NOT NULL
            AND end_date < CURRENT_DATE
        )
        UPDATE recruitment_processes
        SET status = 'closed', auto_closed = TRUE, updated_at = NOW()
        WHERE id IN (SELECT id FROM expired)
        RETURNING id;
      `);
      const backfillCount = backfill.rowCount ?? 0;
      console.log(
        `  [ok] backfill: ${backfillCount} proceso(s) activo(s) con end_date vencida cerrado(s) con auto_closed=true`,
      );

      await client.query('COMMIT');
      console.log('Migration complete.');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

runMigration();
