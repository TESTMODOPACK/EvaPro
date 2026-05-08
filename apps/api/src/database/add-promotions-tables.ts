/**
 * add-promotions-tables.ts — ADR 0002 / Módulo de Promociones MVP.
 *
 * Migración idempotente para crear las 4 tablas del módulo:
 *   - position_levels: catálogo de niveles jerárquicos del tenant
 *   - career_paths: trayectorias from→to entre niveles
 *   - promotion_recommendations: scoring calculado (1 fila por user)
 *   - promotion_decisions: workflow de endorsement + decisión
 *
 * Ver docs/decisions/0002-promotion-recommendation-model.md
 *
 * Run:
 *   docker compose exec api node dist/database/add-promotions-tables.js
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
    console.log('Running migration: promotions module tables (ADR 0002)...');

    await client.query('BEGIN');
    try {
      // 1. position_levels
      await client.query(`
        CREATE TABLE IF NOT EXISTS position_levels (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          code VARCHAR(30) NOT NULL,
          name VARCHAR(120) NOT NULL,
          rank INT NOT NULL,
          description TEXT,
          family VARCHAR(60),
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_poslevel_tenant_code UNIQUE (tenant_id, code)
        );
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_poslevel_tenant_rank
          ON position_levels (tenant_id, rank);
      `);
      console.log('  [ok] position_levels ensured');

      // 2. career_paths
      await client.query(`
        CREATE TABLE IF NOT EXISTS career_paths (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          from_level_id UUID NOT NULL REFERENCES position_levels(id) ON DELETE CASCADE,
          to_level_id UUID NOT NULL REFERENCES position_levels(id) ON DELETE CASCADE,
          path_type VARCHAR(20) NOT NULL DEFAULT 'natural',
          priority INT NOT NULL DEFAULT 1,
          description TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_cpath_tenant_from_to UNIQUE (tenant_id, from_level_id, to_level_id),
          CONSTRAINT chk_cpath_path_type CHECK (path_type IN ('natural', 'lateral', 'cross_track'))
        );
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cpath_tenant_from
          ON career_paths (tenant_id, from_level_id);
      `);
      console.log('  [ok] career_paths ensured');

      // 3. promotion_recommendations
      await client.query(`
        CREATE TABLE IF NOT EXISTS promotion_recommendations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          current_level_id UUID REFERENCES position_levels(id) ON DELETE SET NULL,
          suggested_next_level_id UUID REFERENCES position_levels(id) ON DELETE SET NULL,
          readiness VARCHAR(30) NOT NULL,
          composite_score DECIMAL(6, 3),
          confidence VARCHAR(30) NOT NULL,
          dimensions JSONB NOT NULL,
          filters JSONB NOT NULL,
          cohort_info JSONB NOT NULL,
          algorithm_version VARCHAR(20) NOT NULL,
          policy_snapshot JSONB NOT NULL,
          explanation TEXT,
          computed_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT chk_promorec_readiness CHECK (readiness IN (
            'READY_NOW', 'READY_12M', 'DEVELOP_FIRST', 'NOT_READY', 'INSUFFICIENT_DATA'
          )),
          CONSTRAINT chk_promorec_confidence CHECK (confidence IN (
            'HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA'
          ))
        );
      `);
      // UNIQUE: 1 recomendación por (tenant, user) — el cron upsert
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_promorec_tenant_user
          ON promotion_recommendations (tenant_id, user_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_promorec_readiness
          ON promotion_recommendations (tenant_id, readiness);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_promorec_computed
          ON promotion_recommendations (tenant_id, computed_at);
      `);
      console.log('  [ok] promotion_recommendations ensured');

      // 4. promotion_decisions
      await client.query(`
        CREATE TABLE IF NOT EXISTS promotion_decisions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          recommendation_id UUID REFERENCES promotion_recommendations(id) ON DELETE SET NULL,
          status VARCHAR(30) NOT NULL,
          endorsed_by UUID REFERENCES users(id) ON DELETE SET NULL,
          endorsed_at TIMESTAMPTZ,
          endorsement_comment TEXT,
          endorsed_target_level_id UUID REFERENCES position_levels(id) ON DELETE SET NULL,
          decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
          decided_at TIMESTAMPTZ,
          decision_comment TEXT,
          approved_target_level_id UUID REFERENCES position_levels(id) ON DELETE SET NULL,
          executed_at TIMESTAMPTZ,
          effective_date DATE,
          execution_notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT chk_promodec_status CHECK (status IN (
            'pending_review', 'endorsed',
            'rejected_by_manager', 'approved', 'rejected_by_admin',
            'returned_for_review', 'executed', 'cancelled'
          ))
        );
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_promodec_tenant_user
          ON promotion_decisions (tenant_id, user_id);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_promodec_status
          ON promotion_decisions (tenant_id, status);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_promodec_recommendation
          ON promotion_decisions (recommendation_id);
      `);
      console.log('  [ok] promotion_decisions ensured');

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
