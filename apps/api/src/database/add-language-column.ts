/**
 * add-language-column.ts
 *
 * Safe migration: adds `language` column to `users` table if it doesn't exist.
 * Uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — idempotent, safe to run
 * multiple times and on a live database with existing data.
 *
 * Run manually:
 *   npx ts-node -r tsconfig-paths/register src/database/add-language-column.ts
 *
 * Or from package.json script:
 *   "db:migrate:language": "ts-node -r tsconfig-paths/register src/database/add-language-column.ts"
 */

import 'reflect-metadata';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

async function runMigration() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: isProduction && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    console.log('🔄  Running migration: add language column to users...');

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'es';
    `);

    console.log('✅  Migration complete: users.language column ensured.');
  } catch (err) {
    console.error('❌  Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
