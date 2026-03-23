/**
 * cleanup-orphans.ts
 *
 * Drops orphaned tables from previous schema versions that block DB_SYNC.
 * Safe to run multiple times — only drops if tables exist.
 */
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  if (!DATABASE_URL) {
    console.log('[cleanup] No DATABASE_URL — skipping');
    return;
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    console.log('[cleanup] Connected to database');

    // Drop orphaned tables from previous calibration schema
    const orphanedTables = [
      'calibration_adjustments',
      'calibration_participants',
    ];

    for (const table of orphanedTables) {
      try {
        await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        console.log(`[cleanup] Dropped orphaned table: ${table}`);
      } catch (err: any) {
        console.log(`[cleanup] Could not drop ${table}: ${err.message}`);
      }
    }

    console.log('[cleanup] Done');
  } catch (err: any) {
    console.error('[cleanup] Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
