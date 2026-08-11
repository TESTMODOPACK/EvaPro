-- ─────────────────────────────────────────────────────────────────────────
-- 2026-08-10-sync-hierarchy-level-from-positions.sql
--
-- Reconcilia el nivel jerárquico de los colaboradores con el catálogo de
-- cargos.
--
-- PROBLEMA
-- El organigrama muestra `users.hierarchy_level` (una copia guardada en la
-- persona), mientras la ficha del colaborador muestra el nivel del cargo
-- (`positions.level`). Cuando ambos divergen, el organigrama miente: por
-- ejemplo una "DIRECTORA EJECUTIVA (Nivel 1)" aparecía como Nv.2.
--
-- CAUSA
-- Al editar el nivel de un cargo, la propagación a los usuarios se hacía
-- SOLO por `position_id` (la FK). Los usuarios cargados por importación
-- masiva (CSV) suelen quedar con `position` en texto y `position_id` NULL,
-- así que nunca recibían el nuevo nivel.
--
-- QUÉ HACE
--   1. Vincula `position_id` en los usuarios que tienen el cargo en texto
--      y coinciden por nombre (case/espacios-insensible).
--   2. Sincroniza `hierarchy_level` con el `level` del cargo vinculado.
--
-- Es SEGURO e IDEMPOTENTE: solo toca filas desalineadas y no borra nada.
-- El código ya fue corregido para propagar por nombre además de por FK,
-- así que esto es el backfill de los datos existentes.
--
-- Ejecutar en el VPS:
--   docker compose cp apps/api/src/database/sql/2026-08-10-sync-hierarchy-level-from-positions.sql db:/tmp/
--   docker compose exec -T db psql -U eva360 -d eva360 -f /tmp/2026-08-10-sync-hierarchy-level-from-positions.sql
-- ─────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo '  Sincronización de nivel jerárquico con el catálogo de cargos'
\echo '═══════════════════════════════════════════════════════════════════'
\echo ''

-- ── Diagnóstico ANTES ────────────────────────────────────────────────
\echo 'Colaboradores cuyo nivel NO coincide con el de su cargo (antes):'
SELECT
  t.name                AS empresa,
  u.first_name || ' ' || u.last_name AS colaborador,
  u.position            AS cargo,
  u.hierarchy_level     AS nivel_persona,
  p.level               AS nivel_cargo,
  CASE WHEN u.position_id IS NULL THEN 'sin vincular' ELSE 'vinculado' END AS fk
FROM users u
JOIN tenants t ON t.id = u.tenant_id
JOIN positions p
  ON p.tenant_id = u.tenant_id
 AND LOWER(TRIM(p.name)) = LOWER(TRIM(u.position))
WHERE u.is_active = true
  AND u.position IS NOT NULL
  AND (u.hierarchy_level IS DISTINCT FROM p.level)
ORDER BY t.name, p.level NULLS LAST, u.last_name;

-- ── 1. Vincular la FK que falta (match exacto por nombre) ────────────
-- Solo cuando hay UN cargo que coincide, para no elegir arbitrariamente.
WITH matches AS (
  SELECT u.id AS user_id, MIN(p.id::text)::uuid AS pos_id
  FROM users u
  JOIN positions p
    ON p.tenant_id = u.tenant_id
   AND LOWER(TRIM(p.name)) = LOWER(TRIM(u.position))
  WHERE u.position_id IS NULL
    AND u.position IS NOT NULL
  GROUP BY u.id
  HAVING COUNT(DISTINCT p.id) = 1
)
UPDATE users u
SET position_id = m.pos_id
FROM matches m
WHERE u.id = m.user_id;

\echo ''
\echo 'FKs de cargo vinculadas en este paso:'
SELECT COUNT(*) AS vinculadas
FROM users u
JOIN positions p ON p.id = u.position_id
WHERE u.position_id IS NOT NULL;

-- ── 2. Sincronizar el nivel con el del cargo ─────────────────────────
UPDATE users u
SET hierarchy_level = p.level
FROM positions p
WHERE p.id = u.position_id
  AND u.hierarchy_level IS DISTINCT FROM p.level;

-- ── Verificación DESPUÉS ─────────────────────────────────────────────
\echo ''
\echo 'Colaboradores con nivel desalineado (después — debería ser 0 filas):'
SELECT
  t.name AS empresa,
  u.first_name || ' ' || u.last_name AS colaborador,
  u.position AS cargo,
  u.hierarchy_level AS nivel_persona,
  p.level AS nivel_cargo
FROM users u
JOIN tenants t ON t.id = u.tenant_id
JOIN positions p ON p.id = u.position_id
WHERE u.is_active = true
  AND u.hierarchy_level IS DISTINCT FROM p.level
ORDER BY t.name, u.last_name;

\echo ''
\echo 'Colaboradores activos con cargo en texto que NO existe en el catálogo'
\echo '(requieren crear el cargo o corregir el nombre — no se tocaron):'
SELECT
  t.name AS empresa,
  u.position AS cargo_en_texto,
  COUNT(*) AS colaboradores
FROM users u
JOIN tenants t ON t.id = u.tenant_id
WHERE u.is_active = true
  AND u.position IS NOT NULL
  AND u.position_id IS NULL
GROUP BY t.name, u.position
ORDER BY t.name, u.position;

\echo ''
\echo '✅ Sincronización completada.'
