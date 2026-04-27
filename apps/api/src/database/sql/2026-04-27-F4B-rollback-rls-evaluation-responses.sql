-- F4 Fase B — ROLLBACK Row-Level Security en evaluation_responses
--
-- Ejecutar SI Y SOLO SI Fase B causa issues en produccion. Restaura el
-- estado pre-RLS: la tabla vuelve a ser accesible a cualquier query sin
-- filtrado a nivel de Postgres.
--
-- Riesgos del rollback:
--   - Defense-in-depth se pierde — el sistema vuelve a depender al 100%
--     de los filtros tenantId en application-level (TypeORM queries).
--   - Sin RLS no hay proteccion contra bugs futuros donde un dev olvide
--     `WHERE tenant_id = ?`.
--
-- Idempotente: re-ejecutar no falla. DROP IF EXISTS, NO FORCE / DISABLE
-- son no-ops si ya estan en ese estado.
--
-- Uso:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-27-F4B-rollback-rls-evaluation-responses.sql

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo F4 Fase B — ROLLBACK: deshabilitando RLS en evaluation_responses
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo

\echo ── Drop policy ────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_isolation ON evaluation_responses;

\echo
\echo ── NO FORCE + DISABLE ─────────────────────────────────────────────
ALTER TABLE evaluation_responses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE evaluation_responses DISABLE ROW LEVEL SECURITY;

\echo
\echo ── Post-check: RLS desactivado ────────────────────────────────────
SELECT
  relname AS table_name,
  CASE WHEN relrowsecurity THEN '✗ RLS still enabled (rollback fallo)' ELSE '✓ RLS disabled' END AS rls_status,
  CASE WHEN relforcerowsecurity THEN '✗ FORCED still active (rollback fallo)' ELSE '✓ no force' END AS force_status
FROM pg_class
WHERE relname = 'evaluation_responses';

\echo
\echo ── Post-check: policies restantes (esperado: 0) ───────────────────
SELECT COUNT(*) AS remaining_policies
FROM pg_policies
WHERE tablename = 'evaluation_responses';

\echo
\echo ── Smoke test: query SIN setear GUC retorna rows (no debe ser 0) ──
SELECT COUNT(*) AS total_visible_rows FROM evaluation_responses;

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Rollback completo. Sistema vuelve a app-level tenant filtering.
\echo Documentar el motivo del rollback antes de re-intentar Fase B.
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
