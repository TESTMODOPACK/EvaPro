-- F4 Fase C — Activar Row-Level Security en TODAS las tablas tenant-scoped
--
-- Aplica el mismo patron validado en Fase B (evaluation_responses) a las
-- 66 tablas restantes con columna `tenant_id`. Estrategia dinamica:
-- itera sobre information_schema y aplica el patron a cualquier tabla
-- con `tenant_id` que aun no lo tenga, incluyendo tablas nuevas que se
-- agreguen en el futuro (re-ejecutar es idempotente y safe).
--
-- Total esperado: 67 tablas (segun apps/api/src/common/rls/expected-tenant-tables.ts).
-- Si la BD tiene menos/mas, el script se adapta automaticamente.
--
-- Idempotente: DROP POLICY IF EXISTS antes del CREATE garantiza que
-- re-correr no falla. ENABLE/FORCE no fallan si ya estan activos.
--
-- Pre-requisitos:
--   - Fase B ya aplicada y validada en produccion durante 24-48h
--     (recomendado, no obligatorio).
--   - Indices sobre tenant_id en TODAS las tablas (audit Fase A1).
--
-- Uso:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-27-F4C-rls-all-tenant-tables.sql
--
-- Rollback:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-27-F4C-rollback-rls-all-tenant-tables.sql

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo F4 Fase C — Activando RLS en todas las tablas tenant-scoped
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo

-- ── Pre-checks ──────────────────────────────────────────────────────
\echo ── Pre-check: cuantas tablas tienen tenant_id ─────────────────────
SELECT COUNT(DISTINCT c.table_name) AS tables_with_tenant_id
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.column_name = 'tenant_id';

\echo
\echo ── Pre-check: cuantas tablas YA tienen RLS activo ─────────────────
SELECT COUNT(*) AS tables_with_rls_already
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = true
  AND EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name = c.relname
      AND col.column_name = 'tenant_id'
  );

\echo
\echo ── Pre-check: tablas con tenant_id SIN indice (riesgo de perf) ────
WITH tables_with_tenant_id AS (
  SELECT c.oid, c.relname
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
),
tables_with_index_on_tenant AS (
  SELECT DISTINCT t.oid
  FROM pg_class t
  JOIN pg_index ix ON ix.indrelid = t.oid
  WHERE EXISTS (
    SELECT 1 FROM unnest(ix.indkey) AS keynum
    JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = keynum
    WHERE att.attname = 'tenant_id'
  )
)
SELECT COUNT(*) AS tables_without_tenant_index
FROM tables_with_tenant_id
WHERE oid NOT IN (SELECT oid FROM tables_with_index_on_tenant);

-- ── Aplicar RLS a todas las tablas tenant-scoped ────────────────────
\echo
\echo ── Iterando tablas con tenant_id y aplicando RLS ──────────────────
DO $$
DECLARE
  rec RECORD;
  total_processed INT := 0;
  total_skipped INT := 0;
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
    -- Habilitar RLS + FORCE (idempotente: no falla si ya estan activos).
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', rec.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', rec.table_name);

    -- Drop + recreate policy (idempotente).
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', rec.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ('
      || 'tenant_id::text = current_setting(''app.current_tenant_id'', true) '
      || 'OR current_setting(''app.current_tenant_id'', true) = '''''
      || ')',
      rec.table_name
    );

    total_processed := total_processed + 1;
    RAISE NOTICE '✓ RLS aplicado a %', rec.table_name;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '─── Resumen ─────────────────────────────────────';
  RAISE NOTICE 'Tablas procesadas: %', total_processed;
END $$;

-- ── Post-checks ────────────────────────────────────────────────────
\echo
\echo ── Post-check: estado RLS por tabla (sample top 10) ───────────────
SELECT
  c.relname AS table_name,
  CASE WHEN c.relrowsecurity THEN '✓' ELSE '✗' END AS rls,
  CASE WHEN c.relforcerowsecurity THEN '✓' ELSE '✗' END AS force,
  CASE WHEN p.policyname IS NOT NULL THEN '✓' ELSE '✗' END AS policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p
  ON p.tablename = c.relname AND p.policyname = 'tenant_isolation'
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name = c.relname
      AND col.column_name = 'tenant_id'
  )
ORDER BY c.relname
LIMIT 10;

\echo
\echo ── Post-check: alguna tabla sin RLS (esperado: 0) ─────────────────
SELECT
  c.relname AS missing_rls_table
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
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);

\echo
\echo ── Post-check: alguna tabla sin policy tenant_isolation (esperado: 0)
SELECT c.relname AS table_without_policy
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
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation'
  );

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Listo. Validar con:
\echo   psql -U eva360 -d eva360 < .../2026-04-27-F4C-validate-rls-all.sql
\echo
\echo Si algo se rompe, rollback inmediato con:
\echo   psql -U eva360 -d eva360 < .../2026-04-27-F4C-rollback-rls-all-tenant-tables.sql
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
