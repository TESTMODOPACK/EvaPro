/**
 * add-objective-status-overdue.ts — Audit P1, Tarea 6.
 *
 * Agrega el valor 'overdue' al enum `objectives_status_enum` de Postgres.
 * El enum ya tiene draft / pending_approval / active / completed / abandoned;
 * agregar `overdue` requiere ALTER TYPE ... ADD VALUE — operación que
 * Postgres soporta desde la versión 9.1+.
 *
 * IF NOT EXISTS asegura idempotencia (Postgres 12+).
 *
 * Run:
 *   docker compose exec api node dist/database/add-objective-status-overdue.js
 *   pnpm --filter @repo/api exec ts-node src/database/add-objective-status-overdue.ts
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
      'Running migration: objectives_status_enum += overdue (T6.1)...',
    );

    // ALTER TYPE no se permite dentro de una transacción de bloque, por
    // eso NO usamos BEGIN/COMMIT explícitos (Postgres lo ejecuta como
    // transacción implícita de una sola sentencia).
    //
    // IF NOT EXISTS: idempotente — si ya está, no rompe.
    await client.query(`
      ALTER TYPE objectives_status_enum ADD VALUE IF NOT EXISTS 'overdue';
    `);
    console.log("  [ok] enum value 'overdue' ensured");

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
