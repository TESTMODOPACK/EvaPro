/**
 * add-objective-carryover.ts — Audit P2, Tarea 11.
 *
 * Agrega la columna `carried_from_objective_id` (uuid nullable) a la
 * tabla `objectives` para registrar el linaje de carry-over entre
 * ciclos. Es el equivalente a "este OKR Q2 viene del Q1 sin terminar".
 *
 * Idempotente — re-ejecutable.
 *
 * Run:
 *   docker compose exec api node dist/database/add-objective-carryover.js
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
    console.log(
      'Running migration: objectives.carried_from_objective_id (T11.1)...',
    );

    await client.query('BEGIN');

    try {
      await client.query(`
        ALTER TABLE objectives
          ADD COLUMN IF NOT EXISTS carried_from_objective_id UUID NULL;
      `);
      console.log('  [ok] column carried_from_objective_id ensured');

      // Índice para queries de "objetivos que vienen de X" (linaje).
      // No es FK con CASCADE: si el objetivo original se borra (raro),
      // queremos preservar el linaje aunque apunte a un id huérfano.
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_obj_carried_from
          ON objectives (tenant_id, carried_from_objective_id)
          WHERE carried_from_objective_id IS NOT NULL;
      `);
      console.log('  [ok] index idx_obj_carried_from ensured');

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
