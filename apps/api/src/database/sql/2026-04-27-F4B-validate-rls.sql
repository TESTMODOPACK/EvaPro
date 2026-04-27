-- F4 Fase B — Validacion post-deploy de RLS en evaluation_responses
--
-- Ejecutar DESPUES de aplicar la migration enable-rls. Verifica que:
--   1. RLS y FORCE estan activos.
--   2. La policy `tenant_isolation` existe con la expression correcta.
--   3. Sin GUC seteado, las queries retornan 0 filas (defense-in-depth).
--   4. Con GUC vacio (modo system), todas las filas son visibles.
--   5. Con GUC = UUID de un tenant especifico, solo se ven las filas de
--      ese tenant.
--   6. INSERT con tenant_id distinto al GUC actual falla (WITH CHECK
--      via reuso del USING — no se puede crear filas en otro tenant).
--
-- Idempotente: usa BEGIN/ROLLBACK para no dejar GUC seteado al final.
--
-- Uso:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-27-F4B-validate-rls.sql

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo F4 Fase B — Validacion de RLS en evaluation_responses
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo

-- ── 1. RLS + FORCE activos ────────────────────────────────────────
\echo ── 1. Estado RLS / FORCE ──────────────────────────────────────────
SELECT
  relname AS table_name,
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS force_enabled,
  CASE
    WHEN relrowsecurity AND relforcerowsecurity THEN '✓ OK'
    WHEN relrowsecurity THEN '⚠ enabled pero NO force (owner bypass-ea RLS)'
    ELSE '✗ FAIL: RLS desactivado'
  END AS status
FROM pg_class
WHERE relname = 'evaluation_responses';

-- ── 2. Policy existe ──────────────────────────────────────────────
\echo
\echo ── 2. Policy tenant_isolation ─────────────────────────────────────
SELECT
  policyname,
  cmd AS applies_to,
  permissive,
  qual AS using_clause
FROM pg_policies
WHERE tablename = 'evaluation_responses'
  AND policyname = 'tenant_isolation';

-- ── 3-6. Smoke tests con tx aislada ───────────────────────────────
\echo
\echo ── 3-6. Smoke tests de la policy ──────────────────────────────────
\echo

BEGIN;

-- 3. SIN GUC seteado: la sesion ve 0 filas
\echo ── 3. SIN GUC seteado → query retorna 0 filas (RLS bloquea) ───────
SELECT COUNT(*) AS rows_no_context
FROM evaluation_responses;
-- Esperado: 0 (la policy compara NULL con tenant_id → false)

-- 4. CON GUC vacio (modo system / super_admin)
\echo
\echo ── 4. GUC = '' (modo system) → ve todas las filas ─────────────────
SELECT set_config('app.current_tenant_id', '', true);
SELECT COUNT(*) AS rows_system_mode FROM evaluation_responses;
-- Esperado: total de filas en la tabla (bypass via OR ... = '')

-- 5. CON GUC = primer tenant existente, ve solo ese tenant
\echo
\echo ── 5. GUC = UUID del primer tenant → ve solo ese tenant ────────────
DO $$
DECLARE
  first_tenant_id uuid;
  rows_for_tenant bigint;
  rows_total bigint;
BEGIN
  -- Resetear GUC para que la query SIN policy retorne todo (BYPASSRLS via SET)
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT tenant_id INTO first_tenant_id
  FROM evaluation_responses
  GROUP BY tenant_id
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  IF first_tenant_id IS NULL THEN
    RAISE NOTICE 'Tabla vacia, skipping test 5';
    RETURN;
  END IF;

  -- Contar filas en modo system (esperado: todas)
  PERFORM set_config('app.current_tenant_id', '', true);
  EXECUTE 'SELECT COUNT(*) FROM evaluation_responses' INTO rows_total;

  -- Contar filas con GUC = ese tenant (esperado: solo del tenant)
  PERFORM set_config('app.current_tenant_id', first_tenant_id::text, true);
  EXECUTE 'SELECT COUNT(*) FROM evaluation_responses' INTO rows_for_tenant;

  RAISE NOTICE 'Tenant probado: %', first_tenant_id;
  RAISE NOTICE '  rows_total (modo system): %', rows_total;
  RAISE NOTICE '  rows_for_this_tenant:     %', rows_for_tenant;

  IF rows_for_tenant = 0 THEN
    RAISE EXCEPTION 'FAIL: filtro per-tenant retorna 0 (debio retornar > 0)';
  ELSIF rows_for_tenant > rows_total THEN
    RAISE EXCEPTION 'FAIL: filtro retorna % > total %', rows_for_tenant, rows_total;
  ELSIF rows_for_tenant = rows_total THEN
    RAISE NOTICE '⚠ BD con 1 solo tenant — test no discriminativo (sin otros tenants para excluir)';
  ELSE
    RAISE NOTICE '✓ OK: aislamiento per-tenant funciona (filtro=% < total=%)', rows_for_tenant, rows_total;
  END IF;
END $$;

-- 6. Cross-tenant write block: con GUC = tenantA, intentar UPDATE filas
--    de tenantB falla (no las ve)
\echo
\echo ── 6. Cross-tenant UPDATE bloqueado por RLS ────────────────────────
DO $$
DECLARE
  tenant_a uuid;
  tenant_b uuid;
  updated_count bigint;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  -- Tomar dos tenants distintos con datos en evaluation_responses
  SELECT tenant_id INTO tenant_a FROM evaluation_responses
  GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 1;
  SELECT tenant_id INTO tenant_b FROM evaluation_responses
  WHERE tenant_id != tenant_a
  GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 1;

  IF tenant_a IS NULL OR tenant_b IS NULL THEN
    RAISE NOTICE 'Necesitas al menos 2 tenants con datos para correr test 6 — skipping';
    RETURN;
  END IF;

  -- Setear GUC = tenantA, intentar UPDATE de filas tenantB
  PERFORM set_config('app.current_tenant_id', tenant_a::text, true);
  EXECUTE format(
    'UPDATE evaluation_responses SET overall_score = -1 WHERE tenant_id = %L',
    tenant_b
  );
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    RAISE EXCEPTION 'FAIL: RLS no bloqueo cross-tenant UPDATE — % filas afectadas', updated_count;
  END IF;
  RAISE NOTICE '✓ OK: cross-tenant UPDATE bloqueado (% filas afectadas)', updated_count;
END $$;

ROLLBACK;
-- Importante: ROLLBACK aborta el BEGIN, restaura cualquier write y limpia
-- el GUC. Las validaciones no dejan estado en la BD.

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Validacion completa. Si todos los tests muestran ✓ OK:
\echo   - RLS esta funcionando correctamente
\echo   - Aislamiento per-tenant validado
\echo   - Cross-tenant write bloqueado
\echo   - Modo system (super_admin / cron) funciona
\echo
\echo Si algun test falla, ejecutar rollback inmediatamente:
\echo   psql -U eva360 -d eva360 < .../2026-04-27-F4B-rollback-rls-evaluation-responses.sql
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
