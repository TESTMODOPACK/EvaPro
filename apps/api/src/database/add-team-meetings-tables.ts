/**
 * add-team-meetings-tables.ts  (v3.1 Tema B)
 *
 * Migración idempotente para crear las tablas de reuniones de equipo
 * (N participantes), paralelas a `checkins` (que queda como 1:1 puro).
 *
 * Tablas:
 *   - team_meetings (datos de la reunión)
 *   - team_meeting_participants (tabla pivote N:M + estado de invitación)
 *
 * Patrón CREATE TABLE IF NOT EXISTS + enums idempotentes con DO $$ blocks.
 *
 * Run:
 *   docker compose exec api node dist/database/add-team-meetings-tables.js
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
    console.log('Running migration: team-meetings (v3.1 Tema B)...');

    await client.query('BEGIN');

    try {
      // ─── Enums ──────────────────────────────────────────────────────
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_meetings_status_enum') THEN
            CREATE TYPE team_meetings_status_enum AS ENUM ('scheduled', 'completed', 'cancelled');
          END IF;
        END $$;
      `);
      console.log('  [ok] team_meetings_status_enum ensured');

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_meeting_participants_status_enum') THEN
            CREATE TYPE team_meeting_participants_status_enum AS ENUM ('invited', 'accepted', 'declined', 'attended');
          END IF;
        END $$;
      `);
      console.log('  [ok] team_meeting_participants_status_enum ensured');

      // ─── team_meetings ──────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS team_meetings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          organizer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          title VARCHAR(200) NOT NULL,
          description TEXT,
          scheduled_date DATE NOT NULL,
          scheduled_time TIME,
          location_id UUID REFERENCES meeting_locations(id) ON DELETE SET NULL,
          status team_meetings_status_enum NOT NULL DEFAULT 'scheduled',
          agenda_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
          action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
          notes TEXT,
          minutes TEXT,
          rating SMALLINT,
          completed_at TIMESTAMPTZ,
          cancelled_at TIMESTAMPTZ,
          cancel_reason TEXT,
          email_sent BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      console.log('  [ok] team_meetings table ensured');

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tm_tenant ON team_meetings (tenant_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tm_organizer ON team_meetings (organizer_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tm_tenant_status ON team_meetings (tenant_id, status);
      `);
      console.log('  [ok] team_meetings indexes ensured');

      // ─── team_meeting_participants ──────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS team_meeting_participants (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          meeting_id UUID NOT NULL REFERENCES team_meetings(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status team_meeting_participants_status_enum NOT NULL DEFAULT 'invited',
          decline_reason TEXT,
          invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          responded_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_tmp_meeting_user UNIQUE (meeting_id, user_id)
        );
      `);
      console.log('  [ok] team_meeting_participants table ensured');

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tmp_meeting ON team_meeting_participants (meeting_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tmp_user ON team_meeting_participants (user_id);
      `);
      console.log('  [ok] team_meeting_participants indexes ensured');

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
