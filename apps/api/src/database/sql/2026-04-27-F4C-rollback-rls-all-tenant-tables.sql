-- F4 Fase C — ROLLBACK Row-Level Security en todas las tablas tenant-scoped
--
-- Deshabilita RLS y elimina la policy `tenant_isolation` en TODAS las
-- tablas con tenant_id. Restaura el estado pre-F4 a nivel de Postgres
-- (la app sigue filtrando por tenantId en application-level).
--
-- IMPORTANTE: este rollback toca TODAS las tablas, incluyendo la de
-- Fase B (evaluation_responses). Si solo queres rollbackear Fase C
-- (manteniendo Fase B activa), usar el rollback ESPECIFICO de Fase B
-- en lugar de este (re-aplicarlo despues de este rollback global no
-- restaura Fase B; necesitas correr el forward de Fase B).
--
-- Idempotente: re-ejecutar es safe.
--
-- Uso:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-27-F4C-rollback-rls-all-tenant-tables.sql

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo F4 Fase C — ROLLBACK: deshabilitando RLS en todas las tablas
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo

\echo ── Iterando tablas y deshabilitando RLS ───────────────────────────
DO $$
DECLARE
  rec RECORD;
  total_processed INT := 0;
BEGIN
  FOR rec IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', rec.table_name);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', rec.table_name);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', rec.table_name);
    total_processed := total_processed + 1;
    RAISE NOTICE '✓ RLS deshabilitado en %', rec.table_name;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '─── Resumen ─────────────────────────────────────';
  RAISE NOTICE 'Tablas procesadas: %', total_processed;
END $$;

-- ── Post-checks ────────────────────────────────────────────────────
\echo
\echo ── Post-check: tablas con RLS aun activo (esperado: 0) ────────────
SELECT c.relname AS still_has_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND (c.relrowsecurity OR c.relforcerowsecurity)
  AND EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name = c.relname
      AND col.column_name = 'tenant_id'
  );

\echo
\echo ── Post-check: policies tenant_isolation restantes (esperado: 0) ──
SELECT COUNT(*) AS remaining_policies
FROM pg_policies
WHERE policyname = 'tenant_isolation';

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Rollback completo. Sistema vuelve a app-level tenant filtering.
\echo Documentar el motivo del rollback antes de re-intentar.
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
