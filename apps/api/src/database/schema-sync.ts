/**
 * schema-sync.ts
 *
 * Standalone script that drops all known tables then re-creates them
 * via TypeORM synchronize. Runs as `db:migrate:prod` before the app
 * boots on Render.
 *
 * ⚠️  Intentionally destructive – safe only because db:seed follows.
 */

import 'reflect-metadata';
import { Client } from 'pg';
import { DataSource } from 'typeorm';

import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { User } from '../modules/users/entities/user.entity';

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

async function runSchemaSync() {
  // ── Step 1: drop tables with raw pg to avoid TypeORM ALTER conflicts ──
  const pgClient = new Client({
    connectionString: DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('🗑️   Dropping existing tables (raw SQL)…');
    await pgClient.connect();
    await pgClient.query(
      'DROP TABLE IF EXISTS users CASCADE; DROP TABLE IF EXISTS tenants CASCADE;',
    );
    console.log('✅  Tables dropped.');
  } catch (err) {
    console.error('❌  Failed to drop tables:', err);
    process.exit(1);
  } finally {
    await pgClient.end();
  }

  // ── Step 2: recreate tables via TypeORM synchronize ──
  const dataSource = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
    entities: [Tenant, User],
    synchronize: true,
    logging: false,
  });

  try {
    console.log('🔄  Running TypeORM schema synchronization…');
    await dataSource.initialize();
    console.log('✅  Schema synchronization complete.');
  } catch (err) {
    console.error('❌  Schema sync failed:', err);
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

void runSchemaSync();
