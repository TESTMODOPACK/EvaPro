-- F4 (RLS) — Fase A0: SQL audit script
--
-- Idempotente, solo lectura. Identifica:
--   1. Tablas con columna tenant_id (target de RLS policies en Fase B+C)
--   2. Tablas SIN tenant_id (deberian ser globales legitimas:
--      tenants, subscription_plans, system_changelog, etc.)
--   3. Tablas que ya tienen RLS activado (esperado: cero hoy)
--   4. Conteo de filas por tenant para las primeras 5 tablas mas grandes
--      (para estimar impacto de performance al activar RLS)
--
-- Uso:
--   ssh root@<host>
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-27-F4-rls-audit.sql
--
-- O desde un shell de psql:
--   \i 2026-04-27-F4-rls-audit.sql

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo F4 RLS Audit — Fase A0 (preparatorio, RLS aun no activado)
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo

-- 1) Tablas con tenant_id (target de RLS)
\echo ── 1. Tablas tenant-scoped (CON columna tenant_id) ────────────────
SELECT
  c.relname              AS table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  c.reltuples::bigint    AS approx_rows,
  CASE WHEN c.relrowsecurity THEN 'RLS ENABLED' ELSE 'no RLS' END AS rls_status,
  CASE WHEN c.relforcerowsecurity THEN 'FORCED' ELSE '' END AS force_rls
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name = c.relname
      AND col.column_name = 'tenant_id'
  )
ORDER BY pg_total_relation_size(c.oid) DESC;

\echo
\echo ── 2. Tablas SIN tenant_id (globales — no deben tener RLS) ────────
SELECT
  c.relname AS table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  c.reltuples::bigint AS approx_rows
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name = c.relname
      AND col.column_name = 'tenant_id'
  )
  AND c.relname NOT LIKE 'pg_%'
  AND c.relname NOT IN ('typeorm_metadata', 'migrations')
ORDER BY pg_total_relation_size(c.oid) DESC;

\echo
\echo ── 3. Politicas RLS existentes (esperado: 0 hoy) ──────────────────
SELECT
  schemaname,
  tablename,
  policyname,
  cmd     AS applies_to,
  permissive
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

\echo
\echo ── 4. Top 5 tablas con tenant_id por volumen — distribucion por tenant
\echo    (para estimar impacto de RLS en performance/indices)

DO $$
DECLARE
  rec RECORD;
  q TEXT;
BEGIN
  FOR rec IN
    SELECT c.relname AS table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
      )
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 5
  LOOP
    RAISE NOTICE '──── Tabla: % ─────', rec.table_name;
    q := format(
      'SELECT tenant_id, COUNT(*) AS rows FROM public.%I GROUP BY tenant_id ORDER BY rows DESC LIMIT 10',
      rec.table_name
    );
    FOR rec IN EXECUTE q LOOP
      RAISE NOTICE '  tenant=%  rows=%', rec.tenant_id, rec.rows;
    END LOOP;
  END LOOP;
END $$;

\echo
\echo ── 5. Indices sobre tenant_id (necesarios para que RLS sea performante) ──
SELECT
  t.relname        AS table_name,
  i.relname        AS index_name,
  am.amname        AS index_type,
  pg_size_pretty(pg_relation_size(i.oid)) AS index_size
FROM pg_catalog.pg_class t
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
JOIN pg_catalog.pg_index ix ON ix.indrelid = t.oid
JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
JOIN pg_catalog.pg_am am ON am.oid = i.relam
WHERE n.nspname = 'public'
  AND t.relkind = 'r'
  AND EXISTS (
    SELECT 1
    FROM unnest(ix.indkey) AS keynum
    JOIN pg_catalog.pg_attribute att
      ON att.attrelid = t.oid AND att.attnum = keynum
    WHERE att.attname = 'tenant_id'
  )
ORDER BY t.relname, i.relname;

\echo
\echo ── 6. Tablas con tenant_id PERO SIN indice sobre esa columna ──────
\echo    (riesgo de full-scan al activar RLS — fix antes de Fase B)
WITH tables_with_tenant_id AS (
  SELECT c.oid, c.relname
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
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
  FROM pg_catalog.pg_class t
  JOIN pg_catalog.pg_index ix ON ix.indrelid = t.oid
  WHERE EXISTS (
    SELECT 1
    FROM unnest(ix.indkey) AS keynum
    JOIN pg_catalog.pg_attribute att
      ON att.attrelid = t.oid AND att.attnum = keynum
    WHERE att.attname = 'tenant_id'
  )
)
SELECT relname AS table_without_tenant_index
FROM tables_with_tenant_id
WHERE oid NOT IN (SELECT oid FROM tables_with_index_on_tenant)
ORDER BY relname;

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Fin del audit. Acciones recomendadas:
\echo   - Si la query 6 retorna filas → agregar indices antes de Fase B
\echo   - Si la query 3 retorna filas → revisar conflicto con plan F4
\echo   - Si la query 2 muestra tablas que DEBERIAN tener tenant_id → bug
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
