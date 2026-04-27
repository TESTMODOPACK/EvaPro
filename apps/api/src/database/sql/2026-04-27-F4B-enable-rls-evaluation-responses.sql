-- F4 Fase B — Activar Row-Level Security en evaluation_responses
--
-- Esta es la PRIMERA tabla con RLS activo en el sistema. Si esta migracion
-- prueba bien por 24-48h en produccion, las 65 tablas restantes se
-- migran en bloque en Fase C.
--
-- Comportamiento esperado:
--   1. Queries desde la app pasan por TenantContextInterceptor → cada
--      request abre una tx con `set_config('app.current_tenant_id', $1, true)`.
--      RLS filtra a SOLO ese tenant. Cross-tenant leak imposible.
--   2. Crons usan TenantCronRunner.{runForEachTenant, runAsSystem} (F4 A3).
--      runForEachTenant abre tx con UUID del tenant → RLS filtra. runAsSystem
--      abre tx con '' (cadena vacia) → la policy permite bypass.
--   3. Conexiones admin SIN context (psql directo, scripts ad-hoc): la
--      policy retorna 0 filas. Operadores admin deben empezar la sesion con
--      `SELECT set_config('app.current_tenant_id', '', true);` antes de
--      consultar.
--
-- FORCE ROW LEVEL SECURITY: aplica RLS al owner de la tabla. Sin esto,
-- el user `eva360` (owner) bypass-aria RLS automaticamente, haciendo
-- la policy inutil. CON FORCE, incluso el owner debe satisfacer la
-- policy → defense-in-depth real.
--
-- Idempotente: re-ejecutar este script no falla. ENABLE/FORCE no fallan
-- si ya estan activos. CREATE POLICY si falla, se documenta como skip.
--
-- Uso:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-27-F4B-enable-rls-evaluation-responses.sql
--
-- Para rollback:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-27-F4B-rollback-rls-evaluation-responses.sql

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo F4 Fase B — Activando RLS en evaluation_responses
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo

-- ── Pre-checks (informativo) ────────────────────────────────────────
\echo ── Pre-check: ¿la tabla ya tiene RLS? ─────────────────────────────
SELECT
  relname AS table_name,
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS force_rls
FROM pg_class
WHERE relname = 'evaluation_responses';

\echo
\echo ── Pre-check: ¿hay indice sobre tenant_id? (requerido para perf) ─
SELECT i.relname AS index_name, am.amname AS index_type
FROM pg_class t
JOIN pg_index ix ON ix.indrelid = t.oid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_am am ON am.oid = i.relam
WHERE t.relname = 'evaluation_responses'
  AND EXISTS (
    SELECT 1 FROM unnest(ix.indkey) AS keynum
    JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = keynum
    WHERE att.attname = 'tenant_id'
  );

\echo
\echo ── Pre-check: rows totales antes del cambio ───────────────────────
SELECT COUNT(*) AS total_rows FROM evaluation_responses;

-- ── Cambios efectivos ──────────────────────────────────────────────
\echo
\echo ── Habilitando RLS + FORCE ────────────────────────────────────────
ALTER TABLE evaluation_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_responses FORCE ROW LEVEL SECURITY;

\echo
\echo ── Drop policy existente (idempotencia) ───────────────────────────
DROP POLICY IF EXISTS tenant_isolation ON evaluation_responses;

\echo
\echo ── Creando policy tenant_isolation ────────────────────────────────
-- Policy aplica a TODOS los comandos (SELECT, INSERT, UPDATE, DELETE)
-- por defecto cuando se omite el clausulo `FOR <command>`.
--
-- USING(): predicate evaluado en SELECT/UPDATE/DELETE para decidir si
-- una fila es visible. WITH CHECK no se especifica → reusa USING para
-- INSERT/UPDATE (evita que se inserten/muevan filas a otro tenant).
CREATE POLICY tenant_isolation ON evaluation_responses
  USING (
    -- Caso 1: request HTTP normal o cron tenant-scoped → GUC = UUID del tenant
    tenant_id::text = current_setting('app.current_tenant_id', true)
    -- Caso 2: super_admin (interceptor pone '' para role super_admin) o
    --         cron de sistema (runAsSystem) → bypass
    OR current_setting('app.current_tenant_id', true) = ''
  );

-- ── Post-checks ────────────────────────────────────────────────────
\echo
\echo ── Post-check: estado RLS ─────────────────────────────────────────
SELECT
  relname AS table_name,
  CASE WHEN relrowsecurity THEN '✓ RLS ENABLED' ELSE '✗ no RLS' END AS rls_status,
  CASE WHEN relforcerowsecurity THEN '✓ FORCED' ELSE '✗ no force' END AS force_status
FROM pg_class
WHERE relname = 'evaluation_responses';

\echo
\echo ── Post-check: policy creada ──────────────────────────────────────
SELECT
  policyname,
  permissive,
  cmd AS applies_to,
  qual AS using_clause
FROM pg_policies
WHERE tablename = 'evaluation_responses';

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Listo. Validar isolation con:
\echo   psql -U eva360 -d eva360 < apps/api/src/database/sql/2026-04-27-F4B-validate-rls.sql
\echo
\echo Si algo se rompe, rollback inmediato con:
\echo   psql -U eva360 -d eva360 < apps/api/src/database/sql/2026-04-27-F4B-rollback-rls-evaluation-responses.sql
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
