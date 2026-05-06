/**
 * add-signature-reminders-sent-table.ts — TAREA 10 / G11.
 *
 * Migración idempotente para tracking de recordatorios escalonados de
 * firma de evaluación. Garantiza que NO se envíen 2 recordatorios del
 * mismo nivel (D+3, D+7, D+15) para la misma evaluación pendiente.
 *
 * Run:
 *   docker compose exec api node dist/database/add-signature-reminders-sent-table.js
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
    console.log('Running migration: signature_reminders_sent (G11)...');

    await client.query('BEGIN');
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS signature_reminders_sent (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          document_type VARCHAR(50) NOT NULL,
          document_id UUID NOT NULL,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reminder_level INT NOT NULL,
          sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT chk_reminder_level CHECK (reminder_level IN (3, 7, 15))
        );
      `);
      console.log('  [ok] signature_reminders_sent table ensured');

      // Unique para idempotencia: 1 sola fila por (doc, user, nivel).
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_sigremind_doc_user_level
          ON signature_reminders_sent (document_type, document_id, user_id, reminder_level);
      `);
      // Index para auto-cleanup de filas antiguas (>30 dias)
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sigremind_sent_at
          ON signature_reminders_sent (sent_at);
      `);
      console.log('  [ok] indexes ensured');

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
