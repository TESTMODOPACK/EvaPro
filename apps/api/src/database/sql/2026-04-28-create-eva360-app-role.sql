-- F4 Role separation — Crear `eva360_app` non-superuser para que RLS proteja realmente
--
-- Problema que resuelve:
--   `postgres:16-alpine` con POSTGRES_USER=eva360 crea ese rol como
--   SUPERUSER. SUPERUSER tiene BYPASSRLS automatico → RLS policies son
--   decorativas mientras la app conecte como `eva360`.
--
-- Fix:
--   - Mantener `eva360` (superuser) para backups/migrations/admin.
--   - Crear `eva360_app` non-superuser con los privilegios minimos
--     necesarios para que la app funcione: CONNECT a la BD, USAGE en
--     schemas, CRUD en tablas + sequences. RLS le aplica.
--
-- Pre-requisito:
--   Setear la env var EVA360_APP_PASSWORD antes de ejecutar este script.
--   Ejemplo:
--     export EVA360_APP_PASSWORD="..."  # password fuerte, distinto al de eva360
--     docker compose exec -T -e EVA360_APP_PASSWORD="$EVA360_APP_PASSWORD" \
--       db psql -U eva360 -d eva360 \
--       -v eva360_app_password="$EVA360_APP_PASSWORD" \
--       < apps/api/src/database/sql/2026-04-28-create-eva360-app-role.sql
--
--   Tambien se puede pasar inline cuando se invoca psql:
--     psql -U eva360 -d eva360 \
--       -v eva360_app_password='LA_PASSWORD_AQUI' \
--       -f apps/api/src/database/sql/2026-04-28-create-eva360-app-role.sql
--
--   IMPORTANTE: la password debe coincidir con la que se va a poner en
--   DATABASE_URL del .env del API.
--
-- Idempotente: re-ejecutar es safe. CREATE ROLE IF NOT EXISTS no existe
-- en Postgres pero el bloque DO emula ese comportamiento. Los GRANTs
-- son inherentemente idempotentes.
--
-- Siguiente paso despues de aplicar este SQL:
--   1. Editar /docker/eva360/.env: cambiar `eva360:` por `eva360_app:`
--      en DATABASE_URL.
--   2. docker compose restart api
--   3. Smoke test (login + ver dashboard).
--   4. Validar que rolsuper=f y rolbypassrls=f para eva360_app.
--   5. Recien entonces aplicar 2026-04-27-F4B-enable-rls-evaluation-responses.sql.

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo F4 — Crear rol eva360_app (non-superuser, para que RLS proteja)
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo

-- ── 1. Crear el rol (idempotente) ──────────────────────────────────
\echo ── 1. Creando rol eva360_app ──────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eva360_app') THEN
    EXECUTE format(
      $f$CREATE ROLE eva360_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L$f$,
      :'eva360_app_password'
    );
    RAISE NOTICE '✓ Rol eva360_app creado';
  ELSE
    -- Si ya existe, actualizar password (idempotencia ante re-run con
    -- nueva password). No tocar atributos super/createdb/etc.
    EXECUTE format(
      $f$ALTER ROLE eva360_app WITH PASSWORD %L$f$,
      :'eva360_app_password'
    );
    RAISE NOTICE '⚠ Rol eva360_app ya existia — password actualizado';
  END IF;
END $$;

-- ── 2. GRANTs de conexion + schema ─────────────────────────────────
\echo
\echo ── 2. GRANT CONNECT + USAGE + CREATE schema public ────────────────
GRANT CONNECT ON DATABASE eva360 TO eva360_app;
GRANT USAGE ON SCHEMA public TO eva360_app;
-- CREATE necesario para que cleanup-orphans.ts (corriendo como
-- eva360_app al startup del API) pueda hacer CREATE TABLE IF NOT EXISTS
-- de tablas que aun no existen (ej. ai_call_logs en una BD virgen).
GRANT CREATE ON SCHEMA public TO eva360_app;

-- ── 3. GRANTs en tablas existentes ─────────────────────────────────
\echo
\echo ── 3. GRANT SELECT/INSERT/UPDATE/DELETE en TODAS las tablas ───────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eva360_app;

-- ── 4. GRANTs en sequences (UUIDs / serials de TypeORM) ────────────
\echo
\echo ── 4. GRANT USAGE/SELECT en TODAS las sequences ───────────────────
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eva360_app;

-- ── 5. Transferir ownership de tablas a eva360_app ─────────────────
\echo
\echo ── 5. Transferir ownership de tablas a eva360_app ─────────────────
-- Razon: cleanup-orphans.ts (que corre al startup del API) ejecuta
-- ALTER TABLE ADD COLUMN IF NOT EXISTS, que requiere ownership. Si
-- las tablas siguen owned by eva360 (admin), cleanup-orphans falla
-- con "must be owner of table".
--
-- Trade-offs:
--   - eva360_app es OWNER → FORCE RLS le aplica (bueno: RLS protege).
--   - eva360 (admin) sigue siendo SUPERUSER → bypass automatico para
--     pg_dump/pg_restore/migrations DDL → backups y migrations OK.
--   - Tablas creadas en futuro por cleanup-orphans (corriendo como
--     eva360_app) seran owned by eva360_app automaticamente.
--   - Al hacer pg_restore: el dump preserva owner = eva360_app, asi
--     que tras un restore las tablas vuelven a estar owned por
--     eva360_app sin intervencion.
DO $$
DECLARE
  rec RECORD;
  total INT := 0;
BEGIN
  FOR rec IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'                  -- regular tables (no views, no indices)
      AND n.nspname = 'public'
      AND c.relname NOT IN ('migrations', 'typeorm_metadata')
  LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO eva360_app', rec.table_name);
    total := total + 1;
  END LOOP;
  RAISE NOTICE '✓ Ownership transferido en % tablas', total;
END $$;

-- Tambien transferir sequences (TypeORM crea algunas para columnas
-- serial/identity). Sin esto, los INSERT que necesitan nextval() de
-- sequence no-owned por eva360_app podrian fallar en algunos drivers.
DO $$
DECLARE
  rec RECORD;
  total INT := 0;
BEGIN
  FOR rec IN
    SELECT c.relname AS seq_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S'                  -- sequences
      AND n.nspname = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE %I OWNER TO eva360_app', rec.seq_name);
    total := total + 1;
  END LOOP;
  RAISE NOTICE '✓ Ownership transferido en % sequences', total;
END $$;

-- ── 6. ALTER DEFAULT PRIVILEGES (tablas/sequences futuras) ────────
\echo
\echo ── 6. ALTER DEFAULT PRIVILEGES para tablas/sequences nuevas ───────
-- Si en el futuro un script admin (corriendo como eva360 superuser) crea
-- una tabla, eva360_app recibe automaticamente los GRANTs sin requerir
-- intervencion manual.
ALTER DEFAULT PRIVILEGES FOR ROLE eva360 IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eva360_app;
ALTER DEFAULT PRIVILEGES FOR ROLE eva360 IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO eva360_app;

-- ── 7. Verificacion ─────────────────────────────────────────────────
\echo
\echo ── 7. Estado final del rol ────────────────────────────────────────
SELECT
  rolname,
  rolsuper,
  rolbypassrls,
  rolcreatedb,
  rolcreaterole,
  rolcanlogin,
  CASE
    WHEN NOT rolsuper AND NOT rolbypassrls AND rolcanlogin
    THEN '✓ Setup correcto para app'
    WHEN rolsuper THEN '✗ Es SUPERUSER — bypasea RLS, no sirve para la app'
    WHEN rolbypassrls THEN '✗ Tiene BYPASSRLS — RLS no aplicaria'
    WHEN NOT rolcanlogin THEN '✗ NO tiene LOGIN — no se puede conectar'
    ELSE '?'
  END AS status
FROM pg_roles
WHERE rolname = 'eva360_app';

\echo
\echo ── 8. Privilegios de eva360_app sobre tablas tenant-scoped ────────
\echo    (sample: 5 tablas mas grandes con tenant_id)
WITH sample_tables AS (
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
  ORDER BY pg_total_relation_size(c.oid) DESC
  LIMIT 5
)
SELECT
  s.table_name,
  has_table_privilege('eva360_app', s.table_name, 'SELECT') AS can_select,
  has_table_privilege('eva360_app', s.table_name, 'INSERT') AS can_insert,
  has_table_privilege('eva360_app', s.table_name, 'UPDATE') AS can_update,
  has_table_privilege('eva360_app', s.table_name, 'DELETE') AS can_delete
FROM sample_tables s
ORDER BY s.table_name;

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Listo. Pasos siguientes:
\echo   1. Cambiar DATABASE_URL en /docker/eva360/.env:
\echo        eva360:<password> → eva360_app:<password>
\echo   2. docker compose restart api
\echo   3. Smoke test login + dashboard
\echo   4. Recien entonces aplicar Fase B SQL:
\echo        psql < apps/api/src/database/sql/2026-04-27-F4B-enable-rls-evaluation-responses.sql
\echo
\echo Rollback (si algo se rompe):
\echo   1. Volver DATABASE_URL al rol eva360
\echo   2. docker compose restart api
\echo   3. (Opcional) Drop rol: psql < .../2026-04-28-drop-eva360-app-role.sql
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
