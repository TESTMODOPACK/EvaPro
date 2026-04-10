-- ────────────────────────────────────────────────────────────────────────────
-- 2026-04-10 — DB integrity hardening
--
-- Run this manually against production (synchronize is now permanently OFF in
-- prod per database.module.ts). The entity files carry @Index decorators for
-- fresh deployments, but existing databases need these statements applied once.
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
