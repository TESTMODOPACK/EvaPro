/**
 * schema-sync.ts
 *
 * Standalone script that runs TypeORM schema synchronization.
 * Executed by the `db:migrate:prod` npm script before the app boots
 * on Render (or any CI/CD platform).
 *
 * ⚠️  This is a temporary substitute for proper TypeORM migrations.
 *     Once the schema stabilises, replace with `typeorm migration:run`.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';

// Import all entities that need to exist in the DB
import { Tenant } from '../modules/tenants/entities/tenant.entity';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL env var is not set. Aborting schema sync.');
  process.exit(1);
}

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  entities: [Tenant],
  synchronize: true, // only here in this migrate script, NOT in the app
  logging: true,
});

async function runSchemaSync() {
  try {
    console.log('🔄  Connecting to database for schema sync…');
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
