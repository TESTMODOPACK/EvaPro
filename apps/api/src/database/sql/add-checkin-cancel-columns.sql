-- ─────────────────────────────────────────────────────────────────────────
-- add-checkin-cancel-columns.sql
--
-- Auditoría feedback (Fix B / PR1). Agrega columnas de metadata de
-- anulación a `checkins`. El datasource runtime corre con
-- synchronize:false, por lo que en producción este ALTER debe aplicarse
-- explícitamente (o vía schema-sync.ts en entornos que lo usen).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS — seguro de re-ejecutar.
--
-- Ejecutar en el VPS:
--   docker compose cp apps/api/src/database/sql/add-checkin-cancel-columns.sql db:/tmp/
--   docker compose exec -T db psql -U eva360 -d eva360 -f /tmp/add-checkin-cancel-columns.sql
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

\echo 'checkins.cancelled_at / cancel_reason listas.'
