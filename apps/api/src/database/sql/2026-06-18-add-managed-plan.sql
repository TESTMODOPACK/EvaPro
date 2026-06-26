-- ─────────────────────────────────────────────────────────────────────────
-- 2026-06-18-add-managed-plan.sql
--
-- Inserta el plan "Servicio Gestionado" (code='managed') usado por el
-- modelo done-for-you: Ascenda opera el ciclo y entrega informes; el
-- cliente solo responde. Features mínimas; cobro por proyecto
-- (billingPeriod=one_time en la subscripción, no en el plan).
--
-- Idempotente: ON CONFLICT (code) DO UPDATE refresca features/descripción
-- sin duplicar. Compatible con re-ejecución.
--
-- Ejecutar en el VPS:
--   docker compose cp apps/api/src/database/sql/2026-06-18-add-managed-plan.sql db:/tmp/
--   docker compose exec -T db psql -U eva360 -d eva360 -f /tmp/2026-06-18-add-managed-plan.sql
-- ─────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo '  Plan: Servicio Gestionado (managed)'
\echo '═══════════════════════════════════════════════════════════════════'

INSERT INTO subscription_plans
  (id, name, code, description, max_employees, monthly_price, currency,
   features, max_ai_calls_per_month, is_active, display_order)
VALUES
  (gen_random_uuid(),
   'Servicio Gestionado',
   'managed',
   'Servicio gestionado por Ascenda — setup, ciclo e informes. El cliente solo responde. Cobro por proyecto.',
   9999,
   0,
   'UF',
   '["EVAL_90_180","EVAL_270","EVAL_360","BASIC_REPORTS","ENGAGEMENT_SURVEYS"]'::jsonb,
   0,
   true,
   5)
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  features    = EXCLUDED.features,
  is_active   = true,
  updated_at  = now();

\echo '  ✅ Plan "managed" insertado/actualizado.'
\echo ''
SELECT code, name, max_employees, features
FROM subscription_plans
WHERE code = 'managed';
