/**
 * add-evaluation-response-signature-timestamps.ts — TAREA 12 / G6.
 *
 * Migración idempotente para denormalizar timestamps de firma en
 * `evaluation_responses`. Antes de esto, saber "¿esta evaluación fue
 * firmada?" requería un JOIN a `document_signatures` con filtro por
 * documentType + signatureRole — caro y poco amigable para reportes.
 *
 * Columns añadidas (todas nullable):
 *  - author_signed_at: timestamp de firma con signatureRole=AUTHOR
 *  - recipient_signed_at: timestamp de firma con signatureRole=RECIPIENT
 *  - witnessed_at: timestamp de firma con signatureRole=EMPLOYER_WITNESS
 *
 * Backfill desde document_signatures: las filas existentes se llenan en
 * la misma transacción para mantener consistencia. Idempotente: si la
 * columna ya existe, no se duplica el backfill (UPDATE solo en filas
 * con la nueva columna NULL).
 *
 * Run:
 *   docker compose exec api node dist/database/add-evaluation-response-signature-timestamps.js
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
    console.log('Running migration: evaluation_responses signature timestamps (G6)...');

    await client.query('BEGIN');
    try {
      await client.query(`
        ALTER TABLE evaluation_responses
          ADD COLUMN IF NOT EXISTS author_signed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS recipient_signed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS witnessed_at TIMESTAMPTZ;
      `);
      console.log('  [ok] columns added');

      // Backfill — solo filas con NULL para idempotencia.
      // Toma el signed_at MAX por (documentId, signatureRole) en caso de
      // que existan multiples firmas (edge case con re-firma).
      await client.query(`
        UPDATE evaluation_responses er
          SET author_signed_at = sub.signed_at
          FROM (
            SELECT document_id, MAX(signed_at) AS signed_at
              FROM document_signatures
              WHERE document_type = 'evaluation_response'
                AND signature_role = 'author'
                AND status = 'valid'
              GROUP BY document_id
          ) sub
          WHERE er.id = sub.document_id
            AND er.author_signed_at IS NULL;
      `);
      await client.query(`
        UPDATE evaluation_responses er
          SET recipient_signed_at = sub.signed_at
          FROM (
            SELECT document_id, MAX(signed_at) AS signed_at
              FROM document_signatures
              WHERE document_type = 'evaluation_response'
                AND signature_role = 'recipient'
                AND status = 'valid'
              GROUP BY document_id
          ) sub
          WHERE er.id = sub.document_id
            AND er.recipient_signed_at IS NULL;
      `);
      await client.query(`
        UPDATE evaluation_responses er
          SET witnessed_at = sub.signed_at
          FROM (
            SELECT document_id, MAX(signed_at) AS signed_at
              FROM document_signatures
              WHERE document_type = 'evaluation_response'
                AND signature_role = 'employer_witness'
                AND status = 'valid'
              GROUP BY document_id
          ) sub
          WHERE er.id = sub.document_id
            AND er.witnessed_at IS NULL;
      `);
      console.log('  [ok] backfill complete');

      // Indices para queries de "evaluaciones firmadas/sin firmar"
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_eval_response_recipient_signed
          ON evaluation_responses (tenant_id, recipient_signed_at);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_eval_response_author_signed
          ON evaluation_responses (tenant_id, author_signed_at);
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
