/**
 * add-signature-revocation-fields.ts — TAREA 9 / G8 (audit fix).
 *
 * Migración idempotente para añadir campos de revocación a
 * `document_signatures`. Permite a super_admin revocar firmas con
 * trazabilidad legal (quién revocó, cuándo, por qué) — preservando
 * la firma original como evidencia, no eliminándola.
 *
 * Run:
 *   docker compose exec api node dist/database/add-signature-revocation-fields.js
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
    ssl: isProduction && process.env.DB_SSL !== 'false'
      ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    console.log('Running migration: signature revocation fields (G8)...');

    await client.query('BEGIN');
    try {
      await client.query(`
        ALTER TABLE document_signatures
          ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS revocation_reason TEXT;
      `);
      console.log('  [ok] revocation columns ensured');

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_dsig_status_tenant
          ON document_signatures (tenant_id, status);
      `);
      console.log('  [ok] idx_dsig_status_tenant index ensured');

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
