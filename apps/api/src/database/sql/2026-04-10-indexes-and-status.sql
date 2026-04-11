-- ────────────────────────────────────────────────────────────────────────────
-- 2026-04-10 — DB integrity hardening
--
-- Run this manually against production (synchronize is now permanently OFF in
-- prod per database.module.ts). The entity files carry @Index decorators for
-- fresh deployments, but existing databases need these statements applied once.
--
-- **ORDER OF OPERATIONS**: apply this script FIRST, then deploy the new code.
-- Several ALTER TABLE / CREATE TABLE statements are prerequisites for the
-- updated entities — if the code deploys first, TypeORM queries referencing
-- missing columns (e.g. user_departures.updated_at, user_points_summary.*)
-- will fail. Safe to run in a maintenance window or hot; all statements are
-- idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).
--
-- Safe to re-run: every CREATE INDEX uses IF NOT EXISTS.
-- ────────────────────────────────────────────────────────────────────────────

-- Subscription: health-check and lifecycle queries filter by status
CREATE INDEX IF NOT EXISTS idx_sub_tenant_status ON subscriptions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sub_status ON subscriptions (status);

-- EvaluationCycle: dashboards filter by tenant + status (ACTIVE/CLOSED)
CREATE INDEX IF NOT EXISTS idx_cycles_tenant_status ON evaluation_cycles (tenant_id, status);

-- KeyResult: 1:N eager load from Objective + tenant scoping
CREATE INDEX IF NOT EXISTS idx_kr_tenant ON key_results (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kr_objective ON key_results (objective_id);

-- EvaluationResponse: batch tenant-wide lookups (distinct from survey_responses.idx_response_tenant)
CREATE INDEX IF NOT EXISTS idx_eval_response_tenant ON evaluation_responses (tenant_id);

-- DevelopmentAction: count completed per plan
CREATE INDEX IF NOT EXISTS idx_devaction_plan_status ON development_actions (plan_id, status);

-- InvoiceLine: loading lines for an invoice
CREATE INDEX IF NOT EXISTS idx_invoiceline_invoice ON invoice_lines (invoice_id);

-- Tenant: SaaS-wide filters by plan and active state
CREATE INDEX IF NOT EXISTS idx_tenant_plan ON tenants (plan);
CREATE INDEX IF NOT EXISTS idx_tenant_active ON tenants (is_active);

-- ────────────────────────────────────────────────────────────────────────────
-- Soft-delete audit trail: add deactivated_at column to catalog tables so the
-- existing isActive=false soft-delete records WHEN the deactivation happened.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE departments    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE positions      ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE competencies   ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE badges         ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE challenges     ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- ────────────────────────────────────────────────────────────────────────────
-- @ManyToOne gaps — the entity decorators have been added but the FK columns
-- already exist as raw uuids in production. No ALTER needed; TypeORM now
-- enforces the relation at the application layer via @ManyToOne declarations.
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- 2026-04 — Points summary denormalization (audit point 14)
-- New table storing running totals per user so leaderboards don't need to
-- SUM() the ledger on every request. Sync happens in the application layer
-- via refreshUserPointsSummary() after every ledger write.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_points_summary (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  user_id      UUID        NOT NULL,
  total_points INTEGER     NOT NULL DEFAULT 0,
  month_points INTEGER     NOT NULL DEFAULT 0,
  year_points  INTEGER     NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_points_summary UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_points_summary_tenant ON user_points_summary (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_points_summary_total ON user_points_summary (tenant_id, total_points);

-- ────────────────────────────────────────────────────────────────────────────
-- 2026-04 — Normalized org-development initiative participants (audit point 13)
-- Replaces the JSONB array `org_development_initiatives.participant_ids`
-- with a proper join table. Dual-write is active in the application code;
-- once fully migrated, the JSONB column can be dropped.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_dev_initiative_participants (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  initiative_id  UUID        NOT NULL,
  user_id        UUID        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_odip_initiative_user UNIQUE (initiative_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_odip_tenant ON org_dev_initiative_participants (tenant_id);
CREATE INDEX IF NOT EXISTS idx_odip_initiative ON org_dev_initiative_participants (initiative_id);
CREATE INDEX IF NOT EXISTS idx_odip_user ON org_dev_initiative_participants (tenant_id, user_id);

-- Backfill from the legacy JSONB column (safe to re-run — ON CONFLICT skips dupes).
INSERT INTO org_dev_initiative_participants (tenant_id, initiative_id, user_id)
SELECT i.tenant_id, i.id, (pid::text)::uuid
FROM org_development_initiatives i,
     jsonb_array_elements_text(i.participant_ids) AS pid
WHERE jsonb_typeof(i.participant_ids) = 'array'
  AND jsonb_array_length(i.participant_ids) > 0
ON CONFLICT ON CONSTRAINT uq_odip_initiative_user DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 2026-04 — UpdateDateColumn on mutable entities (audit point 15)
-- Adds updated_at to tables whose rows mutate after insert. Existing rows
-- get NOW() as their first updatedAt, which is a slight lie but acceptable
-- for audit purposes.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE notifications    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE user_departures  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE user_movements   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
