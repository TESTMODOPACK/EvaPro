-- 2026-04-23 — F-002 + F-003 tech debt
--
-- F-002 — Signature rerouting al desvincular firmante
--   Agrega columnas de auditoría a document_signatures para rastrear
--   cuando una firma de un user desvinculado se delega a otro user
--   (reassignToManagerId). NO afecta firmas existentes.
--
-- F-003 — Calibration moderator reassignment
--   No requiere migración estructural (moderator_id ya existe). Solo
--   asegura un índice adicional para el flujo de reassign masivo.
--
-- Idempotente — safe to re-run.

BEGIN;

-- F-002 ──────────────────────────────────────────────────────────────
ALTER TABLE document_signatures
  ADD COLUMN IF NOT EXISTS rerouted_to uuid NULL,
  ADD COLUMN IF NOT EXISTS rerouted_at timestamptz NULL;

-- FK (sin cascada — preservamos el record aunque el user rerouter se borre)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_dsig_rerouted_to_user'
  ) THEN
    ALTER TABLE document_signatures
      ADD CONSTRAINT fk_dsig_rerouted_to_user
      FOREIGN KEY (rerouted_to) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_dsig_rerouted_to
  ON document_signatures (tenant_id, rerouted_to)
  WHERE rerouted_to IS NOT NULL;

-- F-003 ──────────────────────────────────────────────────────────────
-- Índice parcial para acelerar el reassign masivo de moderadores al
-- desvincular un user: WHERE moderator_id = $1 AND status != 'closed'.
CREATE INDEX IF NOT EXISTS idx_calibration_sessions_moderator_open
  ON calibration_sessions (tenant_id, moderator_id)
  WHERE status <> 'closed';

COMMIT;
