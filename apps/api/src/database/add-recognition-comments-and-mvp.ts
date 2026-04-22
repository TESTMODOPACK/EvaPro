/**
 * add-recognition-comments-and-mvp.ts  (v3.1 F7)
 *
 * Migración idempotente:
 *   1. Tabla `recognition_comments` con soft-delete.
 *   2. Tabla `mvp_of_the_month` con UNIQUE(tenant, month).
 *
 * Run:
 *   docker compose exec api node dist/database/add-recognition-comments-and-mvp.js
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
    console.log('Running migration: recognition comments + MVP (v3.1 F7)...');

    await client.query('BEGIN');
    try {
      // ─── recognition_comments ─────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS recognition_comments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          recognition_id UUID NOT NULL REFERENCES recognitions(id) ON DELETE CASCADE,
          from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at TIMESTAMPTZ
        );
      `);
      console.log('  [ok] recognition_comments table ensured');

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rc_recognition ON recognition_comments (recognition_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rc_from ON recognition_comments (from_user_id);
      `);

      // ─── mvp_of_the_month ────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS mvp_of_the_month (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          month VARCHAR(7) NOT NULL,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          total_kudos_count INT NOT NULL DEFAULT 0,
          unique_givers_count INT NOT NULL DEFAULT 0,
          values_touched JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_mvp_tenant_month UNIQUE (tenant_id, month)
        );
      `);
      console.log('  [ok] mvp_of_the_month table ensured');

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_mvp_tenant ON mvp_of_the_month (tenant_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_mvp_user ON mvp_of_the_month (user_id);
      `);

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
