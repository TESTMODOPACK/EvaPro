-- ─────────────────────────────────────────────────────────────────────────
-- 2026-05-24-add-direct-report-evaluation-stage-type.sql
--
-- Agrega el valor 'direct_report_evaluation' al enum cycle_stages_type_enum.
-- Necesario tras el realineamiento taxonomía mayo 2026 (commit e61fbeb3),
-- que introdujo el StageType DIRECT_REPORT_EVALUATION para los ciclos 360°
-- (entre Evaluación de Pares y Calibración).
--
-- TypeORM no migra valores nuevos a enums existentes automáticamente
-- (synchronize:false en prod). Sin este ALTER, cualquier INSERT a
-- cycle_stages con type='direct_report_evaluation' falla con:
--   invalid input value for enum cycle_stages_type_enum
--
-- Ejecutar en el VPS:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     -f /tmp/2026-05-24-add-direct-report-evaluation-stage-type.sql
--
-- O directo:
--   docker compose exec -T db psql -U eva360 -d eva360 -c \
--     "ALTER TYPE cycle_stages_type_enum ADD VALUE IF NOT EXISTS 'direct_report_evaluation';"
--
-- Idempotente — IF NOT EXISTS hace que repetir la migración sea no-op.
-- Compatible con Postgres 9.6+.
-- ─────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo '  Migration: agregar direct_report_evaluation al enum de stages'
\echo '═══════════════════════════════════════════════════════════════════'
\echo ''

-- NOTA: ALTER TYPE ... ADD VALUE no puede correr dentro de un DO block
-- o transacción explícita en Postgres < 12. Por eso lo dejamos como
-- statement plano al nivel top del archivo SQL (psql lo ejecuta en
-- autocommit por defecto).
ALTER TYPE cycle_stages_type_enum ADD VALUE IF NOT EXISTS 'direct_report_evaluation';

\echo '  ✅ Enum cycle_stages_type_enum incluye direct_report_evaluation.'
\echo ''

-- ── Verificación ─────────────────────────────────────────────────────
\echo 'Valores actuales del enum:'
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'cycle_stages_type_enum')
ORDER BY enumsortorder;
