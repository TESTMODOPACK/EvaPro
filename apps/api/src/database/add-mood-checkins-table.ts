/**
 * add-mood-checkins-table.ts  (v3.1 F3 — Mood Tracking)
 *
 * Migración idempotente para crear la tabla `mood_checkins` con su
 * constraint único (tenant, user, fecha) y los índices de búsqueda.
 *
 * Run:
 *   docker compose exec api node dist/database/add-mood-checkins-table.js
 */

import 'reflect-metadata';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

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
    console.log('Running migration: mood_checkins (v3.1 F3)...');

    await client.query('BEGIN');
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS mood_checkins (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          checkin_date DATE NOT NULL,
          score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
          note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_mood_tenant_user_date UNIQUE (tenant_id, user_id, checkin_date)
        );
      `);
      console.log('  [ok] mood_checkins table ensured');

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_mood_tenant_date
          ON mood_checkins (tenant_id, checkin_date);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_mood_user
          ON mood_checkins (user_id);
      `);
      console.log('  [ok] mood_checkins indexes ensured');

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
