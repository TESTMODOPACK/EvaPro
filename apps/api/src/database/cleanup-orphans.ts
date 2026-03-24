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

    // ── B3.14: Cycle stages (FK → evaluation_cycles) ──────────────────────
    const stagesTables = ['cycle_stages'];
    for (const table of stagesTables) {
      try {
        await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        console.log(`[cleanup] Dropped B3 table: ${table}`);
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

    console.log('[cleanup] Done — TypeORM synchronize can now run cleanly');
  } catch (err: any) {
    console.error('[cleanup] Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
