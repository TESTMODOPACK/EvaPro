/**
 * add-evaluation-objective-snapshots.ts — Audit P0, Tarea 5 (Issue A).
 *
 * Crea la tabla `evaluation_objective_snapshots` que captura el estado de
 * los objetivos al cerrar un ciclo o al firmar una evaluación, evitando
 * que documentos firmados muten retroactivamente cuando los objetivos
 * siguen progresando.
 *
 * Pattern ADD TABLE IF NOT EXISTS + índices idempotentes — re-ejecutable.
 *
 * Run:
 *   docker compose exec api node dist/database/add-evaluation-objective-snapshots.js
 *   # o local:
 *   pnpm --filter @repo/api exec ts-node src/database/add-evaluation-objective-snapshots.ts
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
    console.log('Running migration: evaluation_objective_snapshots (T5.1)...');

    await client.query('BEGIN');

    try {
      // ─── Tabla ───────────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS evaluation_objective_snapshots (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL,
          cycle_id UUID NOT NULL,
          assignment_id UUID NULL,
          objective_id UUID NOT NULL,
          owner_user_id UUID NOT NULL,
          objective_title VARCHAR(300) NOT NULL,
          objective_type VARCHAR(20) NOT NULL,
          objective_status VARCHAR(30) NOT NULL,
          progress INT NOT NULL DEFAULT 0,
          weight DECIMAL(5,2) NOT NULL DEFAULT 0,
          target_date DATE NULL,
          key_results_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          captured_by UUID NOT NULL,
          capture_source VARCHAR(30) NOT NULL,
          captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

          CONSTRAINT fk_eos_tenant
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_eos_cycle
            FOREIGN KEY (cycle_id) REFERENCES evaluation_cycles(id) ON DELETE CASCADE,
          CONSTRAINT fk_eos_assignment
            FOREIGN KEY (assignment_id) REFERENCES evaluation_assignments(id) ON DELETE CASCADE,
          CONSTRAINT chk_eos_capture_source
            CHECK (capture_source IN ('cycle_close', 'signature'))
        );
      `);
      console.log('  [ok] table evaluation_objective_snapshots ensured');

      // ─── Índices ─────────────────────────────────────────────────────
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_eval_obj_snap_cycle
          ON evaluation_objective_snapshots (tenant_id, cycle_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_eval_obj_snap_assignment
          ON evaluation_objective_snapshots (tenant_id, assignment_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_eval_obj_snap_lookup
          ON evaluation_objective_snapshots (tenant_id, cycle_id, objective_id, assignment_id);
      `);
      console.log('  [ok] indexes ensured (cycle, assignment, lookup)');

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

void runMigration();
