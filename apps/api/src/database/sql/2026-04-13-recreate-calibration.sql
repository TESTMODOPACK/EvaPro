-- ══════════════════════════════════════════════════════════════════════
-- Recrear tablas de calibración que fueron dropeadas por el antiguo
-- cleanup-orphans.ts (ya corregido en commit 5b4a73b).
--
-- CREATE TABLE IF NOT EXISTS — idempotente, seguro correr multiples veces.
-- Si las tablas ya existen (Render, BD nueva), no hace nada.
-- Si fueron dropeadas (Hostinger por el cleanup anterior), las recrea.
--
-- Correr en Hostinger:
--   docker cp apps/api/src/database/sql/2026-04-13-recreate-calibration.sql eva360_db:/tmp/cal.sql
--   docker compose exec db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -f /tmp/cal.sql'
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS calibration_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL REFERENCES evaluation_cycles(id),
  name varchar(200) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'draft',
  department varchar(100),
  department_id uuid,
  moderator_id uuid NOT NULL REFERENCES users(id),
  min_quorum int NOT NULL DEFAULT 3,
  expected_distribution jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calibration_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  original_score decimal(5,2) NOT NULL DEFAULT 0,
  adjusted_score decimal(5,2),
  original_potential decimal(5,2),
  adjusted_potential decimal(5,2),
  rationale text,
  status varchar(30) NOT NULL DEFAULT 'pending',
  discussed_by uuid,
  change_log jsonb DEFAULT '[]',
  approval_required boolean NOT NULL DEFAULT false,
  approval_status varchar(30) NOT NULL DEFAULT 'not_required',
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_calib_tenant_cycle ON calibration_sessions(tenant_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_calib_dept_id ON calibration_sessions(department_id);
CREATE INDEX IF NOT EXISTS idx_calib_entry_session ON calibration_entries(session_id);
