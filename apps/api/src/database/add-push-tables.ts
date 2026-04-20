/**
 * add-push-tables.ts  (v3.0-P0)
 *
 * Safe migration que:
 *   1. Agrega columna JSONB `notification_prefs` a `users` (idempotente).
 *   2. Crea tabla `push_subscriptions` con FK a users + indexes (idempotente).
 *
 * Usa `ADD COLUMN IF NOT EXISTS` y `CREATE TABLE IF NOT EXISTS` — se puede
 * correr múltiples veces o sobre una DB en prod sin destruir nada.
 *
 * Run:
 *   ts-node -r tsconfig-paths/register src/database/add-push-tables.ts
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
    console.log('Running migration: push subscriptions + notification prefs...');

    // Envuelto en transacción para atomicidad: si alguna parte falla,
    // rollback automático y la DB queda en estado consistente previo.
    await client.query('BEGIN');

    try {
      // 1. Column notification_prefs en users.
      await client.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT NULL;
      `);
      console.log('  [ok] users.notification_prefs ensured');

      // 2. Tabla push_subscriptions.
      await client.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          user_agent TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          last_used_at TIMESTAMP,
          last_failure_at TIMESTAMP,
          failure_count INTEGER NOT NULL DEFAULT 0
        );
      `);
      console.log('  [ok] push_subscriptions table ensured');

      // 3. Indexes.
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_push_subs_user_tenant
          ON push_subscriptions(user_id, tenant_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_push_subs_last_used
          ON push_subscriptions(last_used_at);
      `);
      console.log('  [ok] push_subscriptions indexes ensured');

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
    await client.end();
  }
}

void runMigration();
