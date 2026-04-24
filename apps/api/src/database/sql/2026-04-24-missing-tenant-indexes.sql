-- ══════════════════════════════════════════════════════════════════════
-- Indices faltantes en tenant_id — auditoria F1 Paso 4
-- ══════════════════════════════════════════════════════════════════════
--
-- Identificados durante la auditoria de aislamiento multi-tenant: 7
-- tablas con columna tenant_id sin indice, lo que hace que cualquier
-- query `WHERE tenant_id = :x` haga full table scan. Impacto crece
-- linealmente con el volumen de filas por tabla.
--
-- La auditoria original listaba 9 tablas; dos quedaron excluidas tras
-- verificar el codigo real:
--   - `leads`: no tiene columna tenant_id (es prospecto pre-tenant).
--     Solo tiene `converted_tenant_id` nullable post-conversion.
--   - `oidc_configurations`: ya tiene indice implicito via
--     @Unique(['tenantId']). Un UNIQUE constraint en Postgres se
--     implementa como UNIQUE INDEX y sirve para filtros por esa columna.
--
-- Convencion (ver 2026-04-11-phase0-indexes.sql):
--   - NO se usa CONCURRENTLY: este script se ejecuta en mantenimiento,
--     no con trafico en vivo.
--   - IF NOT EXISTS hace el script idempotente.
--
-- Para correr en produccion Hostinger:
--   docker cp 2026-04-24-missing-tenant-indexes.sql eva360_db:/tmp/migration.sql
--   docker compose exec db sh -c \
--     'psql -U $POSTGRES_USER -d $POSTGRES_DB -f /tmp/migration.sql'
--
-- ══════════════════════════════════════════════════════════════════════

-- ─── 1. cycle_stages(tenant_id) ────────────────────────────────────────
-- Usado por: queries que listan etapas del ciclo scoped a tenant
-- (isolation en services de evaluations). Indice existente es por
-- (cycle_id) — util para joins pero NO para filtro de tenant solo.
CREATE INDEX IF NOT EXISTS idx_cycle_stages_tenant
  ON cycle_stages (tenant_id);

-- ─── 2. peer_assignments(tenant_id) ────────────────────────────────────
-- Usado por: lookups de peer assignments segregados por tenant. Indice
-- existente cubre (cycle_id). Filtros tenant-only hoy hacen full scan.
CREATE INDEX IF NOT EXISTS idx_peer_assignments_tenant
  ON peer_assignments (tenant_id);

-- ─── 3. checkins(tenant_id) ────────────────────────────────────────────
-- Usado por: dashboard y analytics de feedback continuo por tenant.
-- Indices existentes por (manager_id) y (employee_id) no cubren queries
-- tenant-wide (ej. count de checkins en el mes para el tenant).
CREATE INDEX IF NOT EXISTS idx_checkins_tenant
  ON checkins (tenant_id);

-- ─── 4. quick_feedbacks(tenant_id) ─────────────────────────────────────
-- Usado por: listados de quick feedback por tenant. Indices existentes
-- son (from_user_id) y (to_user_id), suficientes para "mis feedback
-- enviados/recibidos" pero no para agregaciones tenant-wide.
-- Nota: tabla se llama `quick_feedbacks` (plural), no `quick_feedback`.
CREATE INDEX IF NOT EXISTS idx_qf_tenant
  ON quick_feedbacks (tenant_id);

-- ─── 5. objective_updates(tenant_id) ───────────────────────────────────
-- Usado por: analitica de progresos de OKR por tenant. Indice existente
-- es por (objective_id) para navegar un OKR individual — no sirve para
-- reportes tenant-wide.
CREATE INDEX IF NOT EXISTS idx_obj_updates_tenant
  ON objective_updates (tenant_id);

-- ─── 6. org_development_actions(tenant_id) ─────────────────────────────
-- Usado por: listado de acciones del plan de desarrollo organizacional
-- por tenant. La tabla no tenia ningun indice hasta ahora — tanto
-- queries tenant-wide como por initiative hacian full scan.
CREATE INDEX IF NOT EXISTS idx_org_dev_actions_tenant
  ON org_development_actions (tenant_id);

-- ─── 7. recognition_comments(tenant_id) ────────────────────────────────
-- Usado por: muro social (F7) en queries admin tipo "todos los
-- comentarios del tenant". Indices existentes cubren (recognition_id) y
-- (from_user_id) para vistas individuales, pero no agregaciones tenant.
CREATE INDEX IF NOT EXISTS idx_rc_tenant
  ON recognition_comments (tenant_id);

-- ─── Resumen ────────────────────────────────────────────────────────────
-- Indices agregados:  7
-- Tablas afectadas:   7 (cycle_stages, peer_assignments, checkins,
--                        quick_feedbacks, objective_updates,
--                        org_development_actions, recognition_comments)
-- Tamano esperado:    <5 MB por indice para un tenant con ~10k filas
-- Impacto ejecucion:  <15 segundos en BD con pocos miles de filas
-- ══════════════════════════════════════════════════════════════════════
