/**
 * add-auto-completed-fields.ts  (v3.1 Tema B — auto-close reuniones)
 *
 * Migración idempotente para:
 *   1. Agregar columna `auto_completed boolean default false` a
 *      `checkins` y `team_meetings`.
 *   2. Backfill one-shot: cerrar check-ins y team_meetings en status
 *      'scheduled' con fecha anterior a hoy-5d, marcándolos como
 *      completed con auto_completed=true y notes informativo.
 *
 * Patrón ADD COLUMN IF NOT EXISTS + UPDATE idempotente. Re-ejecutable.
 *
 * Run:
 *   docker compose exec api node dist/database/add-auto-completed-fields.js
 *
 * Nota: este script hace el primer backfill. Después el cron diario
 * se encarga. Ambas ejecuciones son idempotentes entre sí.
 */

import 'reflect-metadata';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

const AUTO_NOTE_CHECKIN =
  'Cerrado automáticamente por política de cierre de Eva360: han pasado ' +
  'más de 5 días desde la fecha programada sin registrar el resultado de la ' +
  'reunión. El encargado puede agregar retroactivamente notas, minuta, ' +
  'acuerdos y valoración desde el botón "Editar información" en esta reunión.';

const AUTO_NOTE_MEETING = AUTO_NOTE_CHECKIN.replace('Cerrado', 'Cerrada');

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
    console.log('Running migration: auto-completed fields (v3.1 Tema B)...');

    await client.query('BEGIN');

    try {
      // ─── 1. Columnas ─────────────────────────────────────────────────
      await client.query(`
        ALTER TABLE checkins
          ADD COLUMN IF NOT EXISTS auto_completed BOOLEAN NOT NULL DEFAULT FALSE;
      `);
      console.log('  [ok] checkins.auto_completed ensured');

      // team_meetings puede no existir aún si no corrieron la migración
      // previa. Verificamos antes.
      const hasTeamMeetings = await client.query(`
        SELECT to_regclass('public.team_meetings') AS exists;
      `);
      if (hasTeamMeetings.rows[0]?.exists) {
        await client.query(`
          ALTER TABLE team_meetings
            ADD COLUMN IF NOT EXISTS auto_completed BOOLEAN NOT NULL DEFAULT FALSE;
        `);
        console.log('  [ok] team_meetings.auto_completed ensured');
      } else {
        console.log(
          '  [skip] team_meetings no existe todavía (correr add-team-meetings-tables.js primero)',
        );
      }

      // ─── 2. Backfill checkins vencidos +5d ───────────────────────────
      const backfillCi = await client.query<{ count: string }>(`
        WITH stale AS (
          SELECT id FROM checkins
          WHERE status = 'scheduled'
            AND scheduled_date < CURRENT_DATE - INTERVAL '5 days'
        )
        UPDATE checkins
        SET status = 'completed',
            auto_completed = TRUE,
            completed_at = COALESCE(completed_at, NOW()),
            notes = COALESCE(notes, $1),
            updated_at = NOW()
        WHERE id IN (SELECT id FROM stale)
        RETURNING id;
      `, [AUTO_NOTE_CHECKIN]);
      console.log(
        `  [ok] backfill checkins: ${backfillCi.rowCount ?? 0} auto-cerrados`,
      );

      // ─── 3. Backfill team_meetings vencidas +5d ──────────────────────
      if (hasTeamMeetings.rows[0]?.exists) {
        const backfillTm = await client.query<{ count: string }>(`
          WITH stale AS (
            SELECT id FROM team_meetings
            WHERE status = 'scheduled'
              AND scheduled_date < CURRENT_DATE - INTERVAL '5 days'
          )
          UPDATE team_meetings
          SET status = 'completed',
              auto_completed = TRUE,
              completed_at = COALESCE(completed_at, NOW()),
              notes = COALESCE(notes, $1),
              updated_at = NOW()
          WHERE id IN (SELECT id FROM stale)
          RETURNING id;
        `, [AUTO_NOTE_MEETING]);
        console.log(
          `  [ok] backfill team_meetings: ${backfillTm.rowCount ?? 0} auto-cerradas`,
        );
      }

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
