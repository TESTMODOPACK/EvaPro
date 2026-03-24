/**
 * cleanup-orphans.ts
 *
 * Drops tables that can block TypeORM synchronize due to FK/PK dependencies,
 * and any orphaned tables from previous schema versions.
 * Safe to run multiple times — uses DROP IF EXISTS throughout.
 *
 * Runs automatically before `node dist/main` via the start:prod script.
 */
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  if (!DATABASE_URL) {
    console.log('[cleanup] No DATABASE_URL — skipping');
    return;
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    console.log('[cleanup] Connected to database');

    // ── B2/B3: Tables with new columns that conflict on ALTER (existing rows lack new NOT NULL cols)
    const b2b3Tables = [
      'key_results',        // B2.10: new entity, has tenant_id NOT NULL
      'notifications',      // B3.16: new entity
      'cycle_stages',       // B3.14: new entity
      'meeting_locations',  // Check-in meeting locations
      'checkins',           // CheckIn has new columns (scheduledTime, locationId, etc.)
    ];
    for (const table of b2b3Tables) {
      try {
        await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        console.log(`[cleanup] Dropped B2/B3 table: ${table}`);
      } catch (err: any) {
        console.log(`[cleanup] Could not drop ${table}: ${err.message}`);
      }
    }

    // ── Phase 5: Development tables (new — may not exist yet) ─────────────
    const phase5Tables = [
      'development_comments',
      'development_actions',
      'development_plans',
      'competencies',
    ];

    for (const table of phase5Tables) {
      try {
        await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        console.log(`[cleanup] Dropped Phase 5 table: ${table}`);
      } catch (err: any) {
        console.log(`[cleanup] Could not drop ${table}: ${err.message}`);
      }
    }

    // ── Phase 4: Calibration tables (FK dependency causes pkey conflict) ──
    // Drop calibration_entries first (FK → calibration_sessions),
    // then calibration_sessions. Using CASCADE as safety net.
    const calibrationTables = [
      'calibration_entries',
      'calibration_sessions',
    ];

    for (const table of calibrationTables) {
      try {
        await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        console.log(`[cleanup] Dropped calibration table: ${table}`);
      } catch (err: any) {
        console.log(`[cleanup] Could not drop ${table}: ${err.message}`);
      }
    }

    // ── Legacy: Orphaned tables from very old schema versions ─────────────
    const legacyTables = [
      'calibration_adjustments',
      'calibration_participants',
    ];

    for (const table of legacyTables) {
      try {
        await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        console.log(`[cleanup] Dropped legacy table: ${table}`);
      } catch (err: any) {
        console.log(`[cleanup] Could not drop ${table}: ${err.message}`);
      }
    }

    // ── Pre-add nullable/default columns to avoid TypeORM ALTER conflicts on existing data
    const columnFixes = [
      { table: 'objectives', column: 'parent_objective_id', sql: 'ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "parent_objective_id" uuid NULL' },
      { table: 'objectives', column: 'weight', sql: 'ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "weight" numeric(5,2) DEFAULT 0' },
      { table: 'quick_feedbacks', column: 'visibility', sql: `ALTER TABLE "quick_feedbacks" ADD COLUMN IF NOT EXISTS "visibility" varchar DEFAULT 'public'` },
      { table: 'calibration_entries', column: 'change_log', sql: `ALTER TABLE "calibration_entries" ADD COLUMN IF NOT EXISTS "change_log" jsonb DEFAULT '[]'` },
      { table: 'evaluation_cycles', column: 'status_cancelled', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cancelled' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'evaluation_cycles_status_enum')) THEN ALTER TYPE "evaluation_cycles_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'; END IF; END $$;` },
    ];

    for (const fix of columnFixes) {
      try {
        await client.query(fix.sql);
        console.log(`[cleanup] Pre-fixed column: ${fix.table}.${fix.column}`);
      } catch (err: any) {
        // Ignore if column/type already exists
        console.log(`[cleanup] Column fix skipped (${fix.table}.${fix.column}): ${err.message}`);
      }
    }

    console.log('[cleanup] Done — TypeORM synchronize can now run cleanly');
  } catch (err: any) {
    console.error('[cleanup] Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
