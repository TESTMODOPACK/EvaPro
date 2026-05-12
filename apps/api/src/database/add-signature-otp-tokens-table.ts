/**
 * add-signature-otp-tokens-table.ts — TAREA 3 / G9 (audit fix).
 *
 * Migración idempotente para crear `signature_otp_tokens`.
 * Reemplaza los campos `signature_otp` / `signature_otp_expires` en
 * `users`, que en este release quedan DEPRECATED (no se eliminan aún —
 * eso será un release posterior una vez que el código en prod use solo
 * la nueva tabla).
 *
 * Run:
 *   docker compose exec api node dist/database/add-signature-otp-tokens-table.js
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
    console.log('Running migration: signature_otp_tokens (G9)...');

    await client.query('BEGIN');
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS signature_otp_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          document_type VARCHAR(50) NOT NULL,
          document_id UUID NOT NULL,
          code_hash VARCHAR(120) NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          attempts INT NOT NULL DEFAULT 0,
          consumed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      console.log('  [ok] signature_otp_tokens table ensured');

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sigotp_user_active
          ON signature_otp_tokens (user_id, consumed_at, expires_at);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sigotp_tenant_created
          ON signature_otp_tokens (tenant_id, created_at);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sigotp_user_doc
          ON signature_otp_tokens (user_id, document_type, document_id);
      `);
      console.log('  [ok] signature_otp_tokens indexes ensured');

      // Constraint defensivo: attempts no debe superar el cap de 5.
      // Si alguien sube el cap en el futuro, debe actualizar este check.
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_sigotp_attempts_cap'
          ) THEN
            ALTER TABLE signature_otp_tokens
              ADD CONSTRAINT chk_sigotp_attempts_cap
              CHECK (attempts >= 0 AND attempts <= 5);
          END IF;
        END $$;
      `);
      console.log('  [ok] signature_otp_tokens attempts cap constraint ensured');

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
