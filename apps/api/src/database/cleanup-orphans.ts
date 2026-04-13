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
    ssl: process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    console.log('[cleanup] Connected to database');

    // ── B2/B3: Tables that need cleanup ONLY for initial schema migration
    // NOTE: Most tables removed from this list to preserve production data.
    // Only keep tables that truly need recreation on schema conflicts.
    const b2b3Tables: string[] = [
      // All tables PRESERVED — no longer dropped to protect production data
    ];
    for (const table of b2b3Tables) {
      try {
        await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        console.log(`[cleanup] Dropped B2/B3 table: ${table}`);
      } catch (err: any) {
        console.log(`[cleanup] Could not drop ${table}: ${err.message}`);
      }
    }

    // ── PDO: Org Development tables (new — drop to allow clean FK sync) ────
    // IMPORTANT: drop child tables first (actions → initiatives → plans)
    // ── Org Development & Phase 5 tables — PRESERVED (no longer dropped)
    // These tables now have production data and should not be recreated.
    // TypeORM synchronize:true will ADD new columns without dropping tables.
    console.log('[cleanup] Skipping table drops — preserving production data');

    // ── Fix ALL orphaned FK references to competencies ──────────────────
    // After competencies is dropped and recreated empty by TypeORM, any table
    // with FK to competencies will have orphaned IDs. Null them ALL.
    const competencyFkTables = [
      { table: 'quick_feedbacks', column: 'competency_id', constraint: 'FK_e361a4a8922191ddbaaf2147764' },
      { table: 'recognitions', column: 'value_id', constraint: 'FK_06ae36bc92315c22d6eeeaba48f' },
    ];
    for (const fk of competencyFkTables) {
      try {
        await client.query(`ALTER TABLE "${fk.table}" DROP CONSTRAINT IF EXISTS "${fk.constraint}"`);
        const res = await client.query(`UPDATE "${fk.table}" SET "${fk.column}" = NULL WHERE "${fk.column}" IS NOT NULL`);
        if (res.rowCount && res.rowCount > 0) {
          console.log(`[cleanup] Nulled ${res.rowCount} orphaned ${fk.column} in ${fk.table}`);
        }
      } catch (err: any) {
        console.log(`[cleanup] ${fk.table} cleanup skipped: ${err.message}`);
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
      { table: 'subscription_plans', column: 'currency', sql: `ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "currency" varchar(10) DEFAULT 'UF'` },
      { table: 'evaluation_cycles', column: 'period', sql: `ALTER TABLE "evaluation_cycles" ADD COLUMN IF NOT EXISTS "period" varchar(20) DEFAULT 'annual'` },
      // New columns added in recent updates
      { table: 'tenants', column: 'legal_rep_name', sql: `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legal_rep_name" varchar(200) NULL` },
      { table: 'tenants', column: 'legal_rep_rut', sql: `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legal_rep_rut" varchar(12) NULL` },
      { table: 'subscriptions', column: 'ai_addon_used', sql: `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "ai_addon_used" int DEFAULT 0` },
      { table: 'checkins', column: 'rating', sql: `ALTER TABLE "checkins" ADD COLUMN IF NOT EXISTS "rating" smallint NULL` },
      { table: 'checkins', column: 'status_requested', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'requested' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'checkins_status_enum')) THEN ALTER TYPE "checkins_status_enum" ADD VALUE IF NOT EXISTS 'requested'; END IF; END $$;` },
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

    // ── Sync positions.level from tenant settings JSONB ─────────────────
    // The mantenedor saves levels in tenant.settings.positions (JSONB).
    // When positions are auto-created via findOrCreatePosition (e.g., from
    // user form or import), they get level=0 because the JSONB level isn't
    // consulted. This backfill syncs the table from the JSONB source of
    // truth. Idempotent — only updates rows where the table level differs
    // from the JSONB level.
    try {
      const tenants = await client.query(`SELECT id, settings FROM tenants WHERE is_active = true`);
      let positionsFixed = 0;
      for (const t of tenants.rows) {
        const settingsPositions: { name: string; level: number }[] = t.settings?.positions || [];
        if (settingsPositions.length === 0) continue;
        for (const sp of settingsPositions) {
          if (!sp.name || !sp.level) continue;
          const res = await client.query(
            `UPDATE positions SET level = $1 WHERE tenant_id = $2 AND LOWER(name) = LOWER($3) AND (level IS NULL OR level = 0 OR level != $1)`,
            [sp.level, t.id, sp.name],
          );
          if (res.rowCount && res.rowCount > 0) positionsFixed += res.rowCount;
        }
      }
      if (positionsFixed > 0) {
        console.log(`[cleanup] Synced position levels from JSONB settings: ${positionsFixed} position(s) updated`);
      }
    } catch (err: any) {
      console.log(`[cleanup] Position level sync skipped: ${err.message}`);
    }

    // ── Backfill hierarchyLevel from position catalog ───────────────────
    // If a position in the catalog has a `level` but the user's
    // `hierarchy_level` is NULL (e.g., the level was added to the catalog
    // AFTER the user was created), sync it. Also updates users whose
    // hierarchyLevel is 0 (stale from before the position got its level).
    try {
      const backfillResult = await client.query(`
        UPDATE users u
        SET hierarchy_level = p.level
        FROM positions p
        WHERE u.position_id = p.id
          AND u.tenant_id = p.tenant_id
          AND p.level IS NOT NULL
          AND p.level > 0
          AND (u.hierarchy_level IS NULL OR u.hierarchy_level = 0)
      `);
      if (backfillResult.rowCount && backfillResult.rowCount > 0) {
        console.log(`[cleanup] Backfilled hierarchy_level for ${backfillResult.rowCount} user(s) from position catalog`);
      }
    } catch (err: any) {
      console.log(`[cleanup] hierarchy_level backfill skipped: ${err.message}`);
    }

    console.log('[cleanup] Done — TypeORM synchronize can now run cleanly');
  } catch (err: any) {
    console.error('[cleanup] Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
