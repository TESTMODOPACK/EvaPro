-- F4 Role separation — ROLLBACK del rol eva360_app
--
-- Ejecutar SI Y SOLO SI hay que revertir la separacion de roles
-- (ej. la app no funciona con eva360_app por algun privilegio que falto).
--
-- IMPORTANTE: antes de ejecutar este script, revertir DATABASE_URL al
-- rol `eva360` y reiniciar el API. Sino el DROP ROLE falla porque hay
-- conexiones activas con eva360_app.
--
-- Idempotente: re-ejecutar es safe.
--
-- Uso:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-28-drop-eva360-app-role.sql

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo F4 — ROLLBACK rol eva360_app
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo

-- ── 1. Verificar que no hay conexiones activas como eva360_app ─────
\echo ── 1. Conexiones activas como eva360_app (esperado: 0) ────────────
SELECT pid, usename, application_name, client_addr, state
FROM pg_stat_activity
WHERE usename = 'eva360_app';

-- Si hay conexiones, fail explicito para no DROP con sesiones activas.
DO $$
DECLARE
  active_count INT;
BEGIN
  SELECT COUNT(*) INTO active_count
  FROM pg_stat_activity
  WHERE usename = 'eva360_app';

  IF active_count > 0 THEN
    RAISE EXCEPTION 'Hay % conexiones activas como eva360_app — revertir DATABASE_URL y restart API antes de drop', active_count;
  END IF;
END $$;

-- ── 2. Revertir ownership de tablas + sequences a eva360 ───────────
\echo
\echo ── 2. Revirtiendo ownership de tablas + sequences a eva360 ────────
DO $$
DECLARE
  rec RECORD;
  total_t INT := 0;
  total_s INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eva360_app') THEN
    FOR rec IN
      SELECT c.relname, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'S')
        AND r.rolname = 'eva360_app'
    LOOP
      IF rec.relkind = 'r' THEN
        EXECUTE format('ALTER TABLE %I OWNER TO eva360', rec.relname);
        total_t := total_t + 1;
      ELSIF rec.relkind = 'S' THEN
        EXECUTE format('ALTER SEQUENCE %I OWNER TO eva360', rec.relname);
        total_s := total_s + 1;
      END IF;
    END LOOP;
    RAISE NOTICE '✓ Ownership revertido: % tablas + % sequences', total_t, total_s;
  END IF;
END $$;

-- ── 3. Revocar privilegios + DROP role ─────────────────────────────
\echo
\echo ── 3. Revocando privilegios + drop ────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eva360_app') THEN
    -- Revocar default privileges (ALTER DEFAULT)
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE eva360 IN SCHEMA public REVOKE ALL ON TABLES FROM eva360_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE eva360 IN SCHEMA public REVOKE ALL ON SEQUENCES FROM eva360_app';
    -- Revocar privilegios actuales en objetos existentes
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM eva360_app';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM eva360_app';
    EXECUTE 'REVOKE USAGE ON SCHEMA public FROM eva360_app';
    EXECUTE 'REVOKE CONNECT ON DATABASE eva360 FROM eva360_app';
    -- Drop
    EXECUTE 'DROP ROLE eva360_app';
    RAISE NOTICE '✓ Rol eva360_app eliminado';
  ELSE
    RAISE NOTICE '⚠ Rol eva360_app no existia';
  END IF;
END $$;

-- ── 4. Verificacion ──────────────────────────────────────────────────
\echo
\echo ── 4. Confirmar que el rol fue eliminado ─────────────────────────
SELECT COUNT(*) AS eva360_app_exists
FROM pg_roles
WHERE rolname = 'eva360_app';
-- Esperado: 0

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Rollback completo. La app vuelve a usar el rol eva360 (superuser).
\echo Si Fase B/C de RLS estan activas, RLS pasa a ser decorativa hasta
\echo que se vuelva a aplicar role separation.
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
