-- ══════════════════════════════════════════════════════════════════════
-- Fix de colision de nombres: idx_rc_tenant ya existia en prod
-- ══════════════════════════════════════════════════════════════════════
--
-- La migracion 2026-04-24-missing-tenant-indexes.sql (version original)
-- usaba el nombre abreviado `idx_rc_tenant` para
-- recognition_comments(tenant_id). En prod Hostinger ya existia un
-- indice con ese mismo nombre sobre recruitment_candidates (creado por
-- alguna migracion anterior que no cubrimos en la auditoria).
--
-- Los indices PostgreSQL son UNICOS por schema (no por tabla), asi que
-- `CREATE INDEX IF NOT EXISTS idx_rc_tenant` fue no-op y
-- recognition_comments quedo sin indice en tenant_id.
--
-- Verificacion:
--   SELECT tablename FROM pg_indexes WHERE indexname = 'idx_rc_tenant';
--   → 'recruitment_candidates'  (no 'recognition_comments' como esperado)
--
-- Este script:
--   1. Crea el indice con nombre completo sobre recognition_comments.
--   2. Cleanup defensivo: si idx_rc_tenant resulta estar sobre
--      recognition_comments (escenario de fresh deploy donde no hubo
--      colision con recruitment_candidates), lo elimina para no dejar
--      indices duplicados en la misma columna.
--
-- Idempotente: seguro de correr multiples veces.
--
-- Aplicar en prod Hostinger:
--   docker cp 2026-04-24-fix-rc-tenant-collision.sql eva360_db:/tmp/fix.sql
--   docker compose exec db sh -c \
--     'psql -U $POSTGRES_USER -d $POSTGRES_DB -f /tmp/fix.sql'
-- ══════════════════════════════════════════════════════════════════════

-- 1. Crear el indice con el nombre correcto sobre recognition_comments.
CREATE INDEX IF NOT EXISTS idx_recognition_comments_tenant
  ON recognition_comments (tenant_id);

-- 2. Cleanup defensivo: solo elimina idx_rc_tenant si resulta estar
--    sobre recognition_comments. Si esta sobre recruitment_candidates
--    (prod Hostinger), NO se toca — ese es un indice ajeno pre-existente.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_rc_tenant'
      AND tablename = 'recognition_comments'
      AND schemaname = 'public'
  ) THEN
    EXECUTE 'DROP INDEX public.idx_rc_tenant';
    RAISE NOTICE 'Dropped redundant idx_rc_tenant on recognition_comments (replaced by idx_recognition_comments_tenant)';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════
-- Verificacion post-fix:
--   SELECT indexname, tablename FROM pg_indexes
--   WHERE tablename = 'recognition_comments' AND indexdef ILIKE '%tenant_id%';
-- Esperado: exactamente 1 fila con idx_recognition_comments_tenant.
-- ══════════════════════════════════════════════════════════════════════
