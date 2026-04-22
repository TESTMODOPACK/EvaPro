/**
 * add-magic-agenda.ts  (v3.1 F1)
 *
 * Migration idempotente para la feature "Agenda Mágica de 1:1".
 *
 * Cambios:
 *   1. checkins: agrega 2 columnas jsonb nullable (magic_agenda +
 *      carried_over_action_items).
 *   2. ai_insights: agrega scope_entity_id uuid nullable (para que insights
 *      no asociados a un ciclo — como la agenda de un check-in — tengan
 *      dónde registrarse) y hace cycle_id nullable.
 *   3. ai_insights: agrega el valor 'agenda_suggestions' al enum InsightType
 *      (Postgres requiere ALTER TYPE ADD VALUE — no transaccional, por eso
 *      se ejecuta FUERA del BEGIN/COMMIT).
 *   4. Crea índice sobre ai_insights(tenant_id, type, scope_entity_id).
 *
 * Patrón "ADD COLUMN IF NOT EXISTS" + "ALTER COLUMN DROP NOT NULL" — se
 * puede correr múltiples veces o sobre una DB en prod sin destruir nada.
 *
 * Run:
 *   ts-node -r tsconfig-paths/register src/database/add-magic-agenda.ts
 *
 * Importante: el entrypoint del container API debería correr este script
 * automáticamente. Hasta que esté implementado (follow-up documentado),
 * correr manualmente post-deploy.
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
    console.log('Running migration: magic agenda (v3.1 F1)...');

    // ─── Parte 1: ALTER TYPE (fuera de transaction — Postgres no soporta
    // ALTER TYPE ADD VALUE dentro de un BEGIN/COMMIT) ──────────────────────
    //
    // Idempotencia: IF NOT EXISTS sobre el valor del enum (Postgres 12+).
    try {
      await client.query(`
        ALTER TYPE ai_insights_type_enum
        ADD VALUE IF NOT EXISTS 'agenda_suggestions';
      `);
      console.log('  [ok] ai_insights_type_enum.agenda_suggestions ensured');
    } catch (err: any) {
      // Si el enum no se llama así, el nombre real lo detectamos vía
      // pg_type. Capturamos el error para no romper si no está.
      if (err?.message?.includes('does not exist')) {
        console.warn(
          '  [warn] ai_insights_type_enum not found — trying to locate real enum name',
        );
        const enumRes = await client.query(`
          SELECT t.typname
          FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE e.enumlabel = 'summary'
          LIMIT 1;
        `);
        const enumName = enumRes.rows[0]?.typname;
        if (enumName) {
          console.log(`  [info] detected enum name: ${enumName}`);
          await client.query(
            `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS 'agenda_suggestions';`,
          );
          console.log(`  [ok] ${enumName}.agenda_suggestions ensured`);
        } else {
          throw new Error(
            'No se pudo encontrar el enum del type AiInsight. Verificar manualmente.',
          );
        }
      } else {
        throw err;
      }
    }

    // ─── Parte 2: Resto de cambios en transacción ────────────────────────
    await client.query('BEGIN');

    try {
      // 2.1 checkins.magic_agenda
      await client.query(`
        ALTER TABLE checkins
          ADD COLUMN IF NOT EXISTS magic_agenda JSONB DEFAULT NULL;
      `);
      console.log('  [ok] checkins.magic_agenda ensured');

      // 2.2 checkins.carried_over_action_items
      // Default '[]' para que filas legacy tengan un array vacío y no null.
      // (Evita crashes en el frontend que hace .map() sobre el campo.)
      await client.query(`
        ALTER TABLE checkins
          ADD COLUMN IF NOT EXISTS carried_over_action_items JSONB NOT NULL DEFAULT '[]'::jsonb;
      `);
      console.log('  [ok] checkins.carried_over_action_items ensured');

      // 2.3 ai_insights.scope_entity_id
      // Nullable — para insights con cycleId (legacy) queda null; para
      // insights con contexto distinto (agenda de checkin, feedback draft,
      // flight risk por user, etc.) guarda el UUID del recurso.
      await client.query(`
        ALTER TABLE ai_insights
          ADD COLUMN IF NOT EXISTS scope_entity_id UUID DEFAULT NULL;
      `);
      console.log('  [ok] ai_insights.scope_entity_id ensured');

      // 2.4 ai_insights.cycle_id → nullable
      // Antes era NOT NULL. Hacemos idempotente con bloque DO: solo DROP
      // si actualmente tiene NOT NULL constraint.
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'ai_insights'
              AND column_name = 'cycle_id'
              AND is_nullable = 'NO'
          ) THEN
            ALTER TABLE ai_insights ALTER COLUMN cycle_id DROP NOT NULL;
            RAISE NOTICE 'ai_insights.cycle_id dropped NOT NULL';
          END IF;
        END $$;
      `);
      console.log('  [ok] ai_insights.cycle_id nullable ensured');

      // 2.5 Índice para lookups por scope_entity_id — partial index solo
      // sobre filas donde scope_entity_id IS NOT NULL (ahorra espacio y
      // mantiene fast lookups para los insights NO-cycle).
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ai_insights_scope
          ON ai_insights (tenant_id, type, scope_entity_id)
          WHERE scope_entity_id IS NOT NULL;
      `);
      console.log('  [ok] idx_ai_insights_scope ensured');

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
