/**
 * add-objective-rejections.ts — Audit P1, Tarea 8.
 *
 * Crea la tabla `objective_rejections` que persiste el historial de
 * rechazos de cada objetivo (antes solo se sobreescribía
 * objectives.rejection_reason — sin trazabilidad).
 *
 * Idempotente — re-ejecutable.
 *
 * Run:
 *   docker compose exec api node dist/database/add-objective-rejections.js
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
    console.log('Running migration: objective_rejections (T8.1)...');

    await client.query('BEGIN');

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS objective_rejections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL,
          objective_id UUID NOT NULL,
          rejected_by UUID NOT NULL,
          reason TEXT NULL,
          objective_title_snapshot VARCHAR(300) NOT NULL,
          rejected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

          CONSTRAINT fk_objrej_tenant
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_objrej_objective
            FOREIGN KEY (objective_id) REFERENCES objectives(id) ON DELETE CASCADE,
          CONSTRAINT fk_objrej_rejector
            FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
      console.log('  [ok] table objective_rejections ensured');

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_obj_rejection_obj
          ON objective_rejections (tenant_id, objective_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_obj_rejection_at
          ON objective_rejections (rejected_at);
      `);
      console.log('  [ok] indexes ensured');

      await client.query('COMMIT');
      console.log('Migration complete.');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Migration failed:', msg);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

void runMigration();
