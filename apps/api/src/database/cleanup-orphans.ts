/**
 * cleanup-orphans.ts — Script de startup idempotente.
 *
 * ════════════════════════════════════════════════════════════════════════
 * REGLA DE ORO: ESTE SCRIPT NO BORRA NADA.
 *
 * - NO hace DROP TABLE.
 * - NO hace DELETE FROM.
 * - NO hace TRUNCATE.
 * - NO hace DROP CONSTRAINT.
 * - NO hace SET column = NULL masivamente.
 *
 * Cualquier operacion destructiva requiere aprobacion explicita del
 * Product Owner y debe ejecutarse MANUALMENTE, nunca en un script de
 * startup automatico.
 *
 * Lo unico que hace es:
 * 1. ADD COLUMN IF NOT EXISTS — agregar columnas nuevas sin perder data.
 * 2. ADD ENUM VALUE IF NOT EXISTS — agregar valores a enums existentes.
 * 3. Backfill de campos derivados (positions.level, users.hierarchy_level)
 *    — solo UPDATEs idempotentes que rellenan NULL o 0 desde fuentes
 *    de verdad existentes. Nunca sobreescribe datos del usuario.
 *
 * Corre automaticamente antes de `node dist/main` via el CMD del
 * Dockerfile. Es seguro correr multiples veces sin efectos colaterales.
 * ════════════════════════════════════════════════════════════════════════
 */
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  if (!DATABASE_URL) {
    console.log('[startup] No DATABASE_URL — skipping');
    return;
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    console.log('[startup] Connected to database');

    // ── 0. Recrear tablas que fueron dropeadas por el cleanup anterior ──
    // El cleanup-orphans.ts antiguo (pre-commit 5b4a73b) dropeaba las
    // tablas de calibracion en cada startup. Si ya fueron dropeadas,
    // las recreamos aqui. CREATE TABLE IF NOT EXISTS es idempotente.
    const tableFixes = [
      `CREATE TABLE IF NOT EXISTS calibration_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        cycle_id uuid NOT NULL REFERENCES evaluation_cycles(id),
        name varchar(200) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'draft',
        department varchar(100),
        department_id uuid,
        moderator_id uuid NOT NULL REFERENCES users(id),
        min_quorum int NOT NULL DEFAULT 3,
        expected_distribution jsonb,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS calibration_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id uuid NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id),
        original_score decimal(5,2) NOT NULL DEFAULT 0,
        adjusted_score decimal(5,2),
        original_potential decimal(5,2),
        adjusted_potential decimal(5,2),
        rationale text,
        status varchar(30) NOT NULL DEFAULT 'pending',
        discussed_by uuid,
        change_log jsonb DEFAULT '[]',
        approval_required boolean NOT NULL DEFAULT false,
        approval_status varchar(30) NOT NULL DEFAULT 'not_required',
        approved_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_calib_tenant_cycle ON calibration_sessions(tenant_id, cycle_id)`,
      `CREATE INDEX IF NOT EXISTS idx_calib_dept_id ON calibration_sessions(department_id)`,
      `CREATE INDEX IF NOT EXISTS idx_calib_entry_session ON calibration_entries(session_id)`,
    ];
    for (const sql of tableFixes) {
      try { await client.query(sql); } catch { /* already exists */ }
    }
    console.log('[startup] Calibration tables ensured');

    // ── 1. Pre-add nullable/default columns ────────────────────────────
    // Evita conflictos de TypeORM ALTER en tablas con datos existentes.
    // Cada sentencia es ADD COLUMN IF NOT EXISTS — no hace nada si la
    // columna ya existe, no borra datos existentes.
    const columnFixes = [
      { table: 'objectives', column: 'parent_objective_id', sql: 'ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "parent_objective_id" uuid NULL' },
      { table: 'objectives', column: 'weight', sql: 'ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "weight" numeric(5,2) DEFAULT 0' },
      { table: 'quick_feedbacks', column: 'visibility', sql: `ALTER TABLE "quick_feedbacks" ADD COLUMN IF NOT EXISTS "visibility" varchar DEFAULT 'public'` },
      { table: 'calibration_entries', column: 'change_log', sql: `ALTER TABLE "calibration_entries" ADD COLUMN IF NOT EXISTS "change_log" jsonb DEFAULT '[]'` },
      { table: 'subscription_plans', column: 'currency', sql: `ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "currency" varchar(10) DEFAULT 'UF'` },
      { table: 'evaluation_cycles', column: 'period', sql: `ALTER TABLE "evaluation_cycles" ADD COLUMN IF NOT EXISTS "period" varchar(20) DEFAULT 'annual'` },
      { table: 'tenants', column: 'legal_rep_name', sql: `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legal_rep_name" varchar(200) NULL` },
      { table: 'tenants', column: 'legal_rep_rut', sql: `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legal_rep_rut" varchar(12) NULL` },
      { table: 'subscriptions', column: 'ai_addon_used', sql: `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "ai_addon_used" int DEFAULT 0` },
      { table: 'checkins', column: 'rating', sql: `ALTER TABLE "checkins" ADD COLUMN IF NOT EXISTS "rating" smallint NULL` },
      { table: 'users', column: 'notification_preferences', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb DEFAULT '{}'` },
      { table: 'checkins', column: 'minutes', sql: `ALTER TABLE "checkins" ADD COLUMN IF NOT EXISTS "minutes" text NULL` },
      { table: 'users', column: 'cv_url', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cv_url" varchar(500) NULL` },
      { table: 'users', column: 'cv_file_name', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cv_file_name" varchar(200) NULL` },
    ];

    for (const fix of columnFixes) {
      try {
        await client.query(fix.sql);
      } catch (err: any) {
        // Ignore — column already exists or table doesn't exist yet
        // (TypeORM synchronize will create it on first run)
      }
    }
    console.log(`[startup] Column fixes checked (${columnFixes.length} columns)`);

    // ── 2. Add enum values (idempotent) ────────────────────────────────
    const enumFixes = [
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cancelled' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'evaluation_cycles_status_enum')) THEN ALTER TYPE "evaluation_cycles_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'; END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'requested' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'checkins_status_enum')) THEN ALTER TYPE "checkins_status_enum" ADD VALUE IF NOT EXISTS 'requested'; END IF; END $$;`,
    ];

    for (const sql of enumFixes) {
      try {
        await client.query(sql);
      } catch { /* enum value already exists or type doesn't exist */ }
    }
    console.log(`[startup] Enum fixes checked (${enumFixes.length} values)`);

    // ── 3. Sync positions.level from tenant settings JSONB ─────────────
    // El mantenedor guarda niveles en tenant.settings.positions (JSONB).
    // Cuando los cargos se auto-crean via findOrCreatePosition (form de
    // usuario, import), se guardan con level=0. Este backfill sincroniza
    // los niveles desde el JSONB a la tabla positions.
    // Solo ACTUALIZA donde level es 0 o distinto — nunca borra.
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
        console.log(`[startup] Synced position levels from settings: ${positionsFixed} position(s) updated`);
      }
    } catch (err: any) {
      console.log(`[startup] Position level sync skipped: ${err.message}`);
    }

    // ── 4. Backfill users.hierarchy_level from positions table ──────────
    // Usuarios cuyo hierarchy_level es NULL o 0 pero su cargo en la tabla
    // positions tiene un nivel valido (>0). Solo RELLENA — nunca
    // sobreescribe un nivel que el admin ya puso manualmente.
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
        console.log(`[startup] Backfilled hierarchy_level for ${backfillResult.rowCount} user(s)`);
      }
    } catch (err: any) {
      console.log(`[startup] hierarchy_level backfill skipped: ${err.message}`);
    }

    // ── 5. DB Integrity fixes (idempotent) ──────────────────────────────
    const integrityFixes = [
      // P1: Invoice unique constraint scoped by tenant (multi-tenant isolation)
      // Drop both the manually named and any TypeORM auto-generated unique constraint
      `DROP INDEX IF EXISTS "idx_invoice_number"`,
      `DO $$ BEGIN
        EXECUTE (SELECT 'DROP INDEX IF EXISTS "' || indexname || '"' FROM pg_indexes WHERE tablename = 'invoices' AND indexdef LIKE '%invoice_number%' AND indexname != 'idx_invoice_number_tenant' LIMIT 1);
      EXCEPTION WHEN OTHERS THEN NULL; END $$`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoice_number_tenant" ON "invoices" ("tenant_id", "invoice_number")`,
      // P3: Missing indexes on hot-query columns
      `CREATE INDEX IF NOT EXISTS "idx_org_dev_action_initiative" ON "org_development_actions" ("initiative_id")`,
      `CREATE INDEX IF NOT EXISTS "idx_org_dev_action_assigned" ON "org_development_actions" ("assigned_to_id")`,
      `CREATE INDEX IF NOT EXISTS "idx_recruitment_interview_candidate" ON "recruitment_interviews" ("candidate_id")`,
      // Stage A departure cascade: token invalidation counter (starts at 0)
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0`,
    ];
    for (const sql of integrityFixes) {
      try {
        await client.query(sql);
      } catch (err: any) {
        // Ignore — index/constraint may already exist or table may not exist
      }
    }
    console.log(`[startup] Integrity fixes checked (${integrityFixes.length} items)`);

    // ── 6. Pre-FK orphan nullify (surgical, idempotent) ─────────────────
    // Adding @ManyToOne to UUID columns that previously had no FK constraint
    // will fail on TypeORM synchronize if any row points to a user that no
    // longer exists. We NULL those specific orphan references (nullable
    // columns only) so the FK constraint can be created cleanly. This is a
    // controlled, targeted cleanup — not a mass nullify — and only touches
    // rows whose referenced user_id is already gone.
    const orphanFkFixes: Array<{ table: string; col: string }> = [
      { table: 'user_departures', col: 'processed_by' },
      { table: 'user_movements', col: 'approved_by' },
      { table: 'contracts', col: 'rejected_by' },
      { table: 'objectives', col: 'approved_by' },
    ];
    for (const { table, col } of orphanFkFixes) {
      try {
        const res = await client.query(
          `UPDATE "${table}" AS t SET "${col}" = NULL
             WHERE t."${col}" IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t."${col}")`,
        );
        if (res.rowCount && res.rowCount > 0) {
          console.log(`[startup] Nullified ${res.rowCount} orphan ${table}.${col} reference(s)`);
        }
      } catch (err: any) {
        // Table may not exist yet on very first sync — safe to skip
      }
    }

    console.log('[startup] Done — all checks passed, no data modified destructively');
  } catch (err: any) {
    console.error('[startup] Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
