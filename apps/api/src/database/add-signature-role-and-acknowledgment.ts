/**
 * add-signature-role-and-acknowledgment.ts — TAREA 4 / Auditoría CTO firmas.
 *
 * Migración idempotente para extender `document_signatures` con:
 *  - signature_role: rol del firmante en este documento
 *      'recipient'        = el evaluado/dueño firma de recepción
 *      'author'           = el manager/external firma como autor del feedback (G2)
 *      'employer_witness' = el tenant_admin co-firma como representante del empleador (G3)
 *  - acknowledgment_type: tipo de reconocimiento del firmante (G5)
 *      'agree'                = firma plena
 *      'agree_with_comments'  = firma con comentarios (no rechazo)
 *      'decline'              = firma de rechazo (queda registrado)
 *  - acknowledgment_comment: texto opcional asociado al acknowledgment.
 *
 * Backfill: filas existentes reciben signature_role='recipient',
 * acknowledgment_type='agree' (compat con el comportamiento actual de
 * "firmar = aceptar").
 *
 * Run:
 *   docker compose exec api node dist/database/add-signature-role-and-acknowledgment.js
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
    console.log('Running migration: signature_role + acknowledgment_type (TAREA 4)...');

    await client.query('BEGIN');
    try {
      // 1. signature_role (varchar + CHECK constraint, evitamos ENUM PG por
      //    flexibilidad — agregar valores no requiere ALTER TYPE).
      await client.query(`
        ALTER TABLE document_signatures
          ADD COLUMN IF NOT EXISTS signature_role VARCHAR(30);
      `);
      // Backfill seguro de filas existentes
      await client.query(`
        UPDATE document_signatures
          SET signature_role = 'recipient'
          WHERE signature_role IS NULL;
      `);
      // Default para futuras filas sin especificar
      await client.query(`
        ALTER TABLE document_signatures
          ALTER COLUMN signature_role SET DEFAULT 'recipient';
      `);
      // NOT NULL una vez backfilled
      await client.query(`
        ALTER TABLE document_signatures
          ALTER COLUMN signature_role SET NOT NULL;
      `);
      // CHECK constraint
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_dsig_signature_role'
          ) THEN
            ALTER TABLE document_signatures
              ADD CONSTRAINT chk_dsig_signature_role
              CHECK (signature_role IN ('recipient', 'author', 'employer_witness'));
          END IF;
        END $$;
      `);
      console.log('  [ok] signature_role column + check constraint ensured');

      // 2. acknowledgment_type (NULL permitido; default 'agree' para compat)
      await client.query(`
        ALTER TABLE document_signatures
          ADD COLUMN IF NOT EXISTS acknowledgment_type VARCHAR(30);
      `);
      // Backfill: rows existentes con status='valid' implicitamente "agree"
      await client.query(`
        UPDATE document_signatures
          SET acknowledgment_type = 'agree'
          WHERE acknowledgment_type IS NULL AND status = 'valid';
      `);
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_dsig_acknowledgment_type'
          ) THEN
            ALTER TABLE document_signatures
              ADD CONSTRAINT chk_dsig_acknowledgment_type
              CHECK (acknowledgment_type IS NULL
                     OR acknowledgment_type IN ('agree', 'agree_with_comments', 'decline'));
          END IF;
        END $$;
      `);
      console.log('  [ok] acknowledgment_type column + check constraint ensured');

      // 3. acknowledgment_comment (texto opcional, max 2000 chars en app layer).
      await client.query(`
        ALTER TABLE document_signatures
          ADD COLUMN IF NOT EXISTS acknowledgment_comment TEXT;
      `);
      console.log('  [ok] acknowledgment_comment column ensured');

      // 4. Índice compuesto para queries frecuentes "firmas X tipo de un documento"
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_dsig_doc_role
          ON document_signatures (tenant_id, document_type, document_id, signature_role);
      `);
      console.log('  [ok] idx_dsig_doc_role index ensured');

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
