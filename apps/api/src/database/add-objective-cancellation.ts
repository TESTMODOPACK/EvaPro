/**
 * add-objective-cancellation.ts — Audit P1, Tarea 7.
 *
 * Cambios para separar CANCELLED (decisión de negocio) de ABANDONED
 * (soft-delete técnico admin):
 *   1. Agrega valor 'cancelled' al enum objectives_status_enum.
 *   2. Agrega columnas cancellation_reason, cancelled_by, cancelled_at
 *      a la tabla objectives.
 *
 * El backfill de filas existentes (ABANDONED → CANCELLED) corre en un
 * script separado: backfill-abandoned-to-cancelled.ts. Esto separa el
 * cambio de schema (idempotente, seguro) de la transformación de data
 * (revisable, opcional).
 *
 * Run:
 *   docker compose exec api node dist/database/add-objective-cancellation.js
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
      'Running migration: objective cancellation columns + enum (T7.1)...',
    );

    // 1. Enum value (no transacción explícita: ALTER TYPE no se permite
    //    dentro de un bloque transaccional)
    await client.query(`
      ALTER TYPE objectives_status_enum ADD VALUE IF NOT EXISTS 'cancelled';
    `);
    console.log("  [ok] enum value 'cancelled' ensured");

    // 2. Columnas (en transacción)
    await client.query('BEGIN');
    try {
      await client.query(`
        ALTER TABLE objectives
          ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NULL;
      `);
      await client.query(`
        ALTER TABLE objectives
          ADD COLUMN IF NOT EXISTS cancelled_by UUID NULL;
      `);
      await client.query(`
        ALTER TABLE objectives
          ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL;
      `);
      console.log(
        '  [ok] columns cancellation_reason / cancelled_by / cancelled_at ensured',
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }

    console.log('Migration complete.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Migration failed:', msg);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

void runMigration();
