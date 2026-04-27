-- Crear tabla ai_call_logs — audit trail independiente de ai_insights.
--
-- Cada llamada al API de Anthropic se registra aqui ANTES del parseJson,
-- garantizando que tokens consumidos siempre quedan trackeados aunque
-- el response sea JSON malformado.
--
-- Idempotente: re-ejecutar es safe (CREATE TABLE IF NOT EXISTS).
--
-- Uso:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     < apps/api/src/database/sql/2026-04-27-create-ai-call-logs.sql

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Crear tabla ai_call_logs (audit trail de llamadas al API Anthropic)
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo

CREATE TABLE IF NOT EXISTS ai_call_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type            ai_insights_type_enum NOT NULL,
  tokens_used     int NOT NULL DEFAULT 0,
  input_tokens    int NOT NULL DEFAULT 0,
  output_tokens   int NOT NULL DEFAULT 0,
  model           varchar(100) NOT NULL,
  generated_by    uuid NOT NULL REFERENCES users(id),
  parse_success   boolean NOT NULL DEFAULT true,
  error_message   text,
  insight_id      uuid REFERENCES ai_insights(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indices:
--   - idx_ai_call_logs_tenant: filtro principal por tenant (RLS + queries)
--   - idx_ai_call_logs_created: queries con range filter por fecha
--   - idx_ai_call_logs_tenant_created: composite para listados paginados
--     ordenados DESC por fecha dentro de un tenant (caso comun del endpoint
--     /ai/usage-log)
CREATE INDEX IF NOT EXISTS idx_ai_call_logs_tenant
  ON ai_call_logs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_ai_call_logs_created
  ON ai_call_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_ai_call_logs_tenant_created
  ON ai_call_logs(tenant_id, created_at DESC);

-- Index parcial para investigar errores de parse (suele ser <5% del total)
CREATE INDEX IF NOT EXISTS idx_ai_call_logs_parse_errors
  ON ai_call_logs(tenant_id, created_at DESC)
  WHERE parse_success = false;

\echo
\echo ── Verificacion ───────────────────────────────────────────────────
SELECT
  c.relname AS table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  CASE WHEN c.relrowsecurity THEN 'RLS ENABLED' ELSE 'no RLS' END AS rls_status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'ai_call_logs' AND n.nspname = 'public';

\echo
\echo ── Indices creados ────────────────────────────────────────────────
SELECT indexname FROM pg_indexes
WHERE tablename = 'ai_call_logs' AND schemaname = 'public'
ORDER BY indexname;

\echo
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\echo Listo. Si F4 RLS Fase C ya fue aplicada, re-ejecutar
\echo 2026-04-27-F4C-rls-all-tenant-tables.sql para activar RLS en esta
\echo tabla nueva (idempotente, cubre tablas con tenant_id automaticamente).
\echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
