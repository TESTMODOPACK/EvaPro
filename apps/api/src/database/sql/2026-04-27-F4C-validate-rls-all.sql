-- F4 Fase C — Validacion exhaustiva de RLS en TODAS las tablas tenant-scoped
--
-- Verifica que:
--   1. TODAS las tablas con tenant_id tienen RLS + FORCE activo y la
--      policy tenant_isolation. No deberia haber faltantes.
--   2. Sample test de aislamiento: para 3 tablas representativas del
--      sistema (users, evaluation_assignments, notifications), repetir
--      la validacion de Fase B (sin context = 0 filas, con tenant filtra).
--   3. Cross-tenant write block en sample tabla (notifications es facil
--      porque tiene rows en cualquier tenant activo).
--
-- Idempotente: usa BEGIN/ROLLBACK para no leak GUC.
--
-- Uso:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-27-F4C-validate-rls-all.sql

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo F4 Fase C — Validacion exhaustiva de RLS
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo

-- ── 1. Coverage check: TODAS las tablas tenant-scoped tienen RLS ──
\echo ── 1. Coverage: tablas tenant-scoped con/sin RLS ──────────────────
WITH tenant_tables AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
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
policies_count AS (
  SELECT tablename, COUNT(*) AS n
  FROM pg_policies
  WHERE policyname = 'tenant_isolation'
  GROUP BY tablename
)
SELECT
  COUNT(*) FILTER (WHERE t.relrowsecurity) AS with_rls,
  COUNT(*) FILTER (WHERE t.relforcerowsecurity) AS with_force,
  COUNT(*) FILTER (WHERE p.n IS NOT NULL) AS with_policy,
  COUNT(*) AS total_tenant_tables
FROM tenant_tables t
LEFT JOIN policies_count p ON p.tablename = t.relname;

\echo
\echo ── 1b. Tablas FALTANTES (sin RLS o sin policy) — esperado: 0 ──────
WITH tenant_tables AS (
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
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
)
SELECT
  t.relname AS table_name,
  CASE WHEN NOT t.relrowsecurity THEN 'no RLS' ELSE '✓' END AS rls,
  CASE WHEN NOT t.relforcerowsecurity THEN 'no FORCE' ELSE '✓' END AS force,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.tablename = t.relname AND p.policyname = 'tenant_isolation'
    ) THEN 'NO POLICY'
    ELSE '✓'
  END AS policy
FROM tenant_tables t
WHERE NOT t.relrowsecurity
   OR NOT t.relforcerowsecurity
   OR NOT EXISTS (
     SELECT 1 FROM pg_policies p
     WHERE p.tablename = t.relname AND p.policyname = 'tenant_isolation'
   )
ORDER BY t.relname;

-- ── 2. Smoke tests en 3 tablas representativas ────────────────────
\echo
\echo ── 2. Smoke tests con tx aislada ──────────────────────────────────

BEGIN;

\echo
\echo ── 2.1. users — SIN GUC retorna 0 filas ───────────────────────────
SELECT COUNT(*)::text AS rows_no_context FROM users;

\echo
\echo ── 2.2. evaluation_assignments — SIN GUC retorna 0 filas ──────────
SELECT COUNT(*)::text AS rows_no_context FROM evaluation_assignments;

\echo
\echo ── 2.3. notifications — SIN GUC retorna 0 filas ───────────────────
SELECT COUNT(*)::text AS rows_no_context FROM notifications;

\echo
\echo ── 2.4. Modo system: ve filas de todas las tablas ─────────────────
SELECT set_config('app.current_tenant_id', '', true);
SELECT
  (SELECT COUNT(*) FROM users) AS users_total,
  (SELECT COUNT(*) FROM evaluation_assignments) AS evals_total,
  (SELECT COUNT(*) FROM notifications) AS notifs_total;

\echo
\echo ── 2.5. Aislamiento per-tenant: filtro a 1 tenant ─────────────────
DO $$
DECLARE
  first_tenant_id uuid;
  users_tenant bigint;
  users_total bigint;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT id INTO first_tenant_id FROM tenants WHERE is_active = true LIMIT 1;

  IF first_tenant_id IS NULL THEN
    RAISE NOTICE 'BD sin tenants activos — skipping test 2.5';
    RETURN;
  END IF;

  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT COUNT(*) INTO users_total FROM users;

  PERFORM set_config('app.current_tenant_id', first_tenant_id::text, true);
  SELECT COUNT(*) INTO users_tenant FROM users;

  RAISE NOTICE 'Tenant probado: %', first_tenant_id;
  RAISE NOTICE '  users en BD (modo system): %', users_total;
  RAISE NOTICE '  users en este tenant:      %', users_tenant;

  IF users_tenant = 0 THEN
    RAISE EXCEPTION 'FAIL: filtro per-tenant retorna 0 users';
  ELSIF users_tenant > users_total THEN
    RAISE EXCEPTION 'FAIL: filtro retorna % > total %', users_tenant, users_total;
  ELSIF users_tenant = users_total THEN
    RAISE NOTICE '⚠ BD con 1 solo tenant — test no discriminativo';
  ELSE
    RAISE NOTICE '✓ OK: aislamiento en users (filtro=% < total=%)', users_tenant, users_total;
  END IF;
END $$;

\echo
\echo ── 2.6. Cross-tenant UPDATE bloqueado en notifications ────────────
DO $$
DECLARE
  tenant_a uuid;
  tenant_b uuid;
  updated_count bigint;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT tenant_id INTO tenant_a FROM notifications
  GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 1;
  SELECT tenant_id INTO tenant_b FROM notifications
  WHERE tenant_id != tenant_a
  GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 1;

  IF tenant_a IS NULL OR tenant_b IS NULL THEN
    RAISE NOTICE 'Necesitas 2 tenants con notifications para validar — skipping';
    RETURN;
  END IF;

  PERFORM set_config('app.current_tenant_id', tenant_a::text, true);
  EXECUTE format(
    'UPDATE notifications SET title = title WHERE tenant_id = %L',
    tenant_b
  );
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    RAISE EXCEPTION 'FAIL: cross-tenant UPDATE NO bloqueado — % filas afectadas', updated_count;
  END IF;
  RAISE NOTICE '✓ OK: cross-tenant UPDATE bloqueado en notifications';
END $$;

ROLLBACK;
-- Limpia GUC y reverts cualquier cambio.

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Validacion completa. Si todos los tests muestran ✓ OK:
\echo   - RLS esta funcionando en TODAS las tablas tenant-scoped
\echo   - Aislamiento per-tenant validado en sample (users)
\echo   - Cross-tenant UPDATE bloqueado en sample (notifications)
\echo
\echo Si algun test falla, ejecutar rollback inmediatamente:
\echo   psql -U eva360 -d eva360 < .../2026-04-27-F4C-rollback-rls-all-tenant-tables.sql
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
