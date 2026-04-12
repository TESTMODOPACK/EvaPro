-- ══════════════════════════════════════════════════════════════════════
-- Fase 0 — Indices faltantes identificados en la auditoría técnica
-- ══════════════════════════════════════════════════════════════════════
--
-- Todos los indices se crean con `IF NOT EXISTS` para que la migracion
-- sea idempotente (se puede correr multiples veces sin error). NO se
-- usa `CONCURRENTLY` porque este script se ejecuta en mantenimiento,
-- no con trafico en vivo — para un tenant con pocos miles de filas la
-- diferencia es imperceptible.
--
-- Para correr en produccion Hostinger:
--   docker compose exec db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -f /tmp/migration.sql'
-- (primero copiar el .sql al container con `docker cp`)
--
-- Para correr en Render (postgres gestionado): usar psql directamente
-- con las credenciales del dashboard.
--
-- ══════════════════════════════════════════════════════════════════════

-- ─── 1. user_points(tenant_id, source) ─────────────────────────────────
-- Usado por: agregaciones de `recognition.service.ts` que suman puntos
-- por fuente (giving, receiving, challenge, etc.) para el leaderboard y
-- los graficos de dashboard. Sin este index, el GROUP BY source + filtro
-- por tenant hace full table scan.
CREATE INDEX IF NOT EXISTS idx_up_tenant_source
  ON user_points (tenant_id, source);

-- ─── 2. survey_responses(tenant_id, respondent_id) ─────────────────────
-- Usado por: listado de encuestas respondidas por un usuario especifico
-- (mi historial de encuestas). Sin este index, filtrar por respondent
-- dentro de un tenant requiere escanear el index de tenant y re-filtrar.
CREATE INDEX IF NOT EXISTS idx_survey_resp_respondent
  ON survey_responses (tenant_id, respondent_id);

-- ─── 3. audit_logs(tenant_id, entity_type, entity_id) ──────────────────
-- Usado por: "ver historial de cambios de este recurso" (ej: cambios a
-- un ciclo de evaluacion, modificaciones a un usuario, etc). Sin este
-- index, buscar el historial de un objeto especifico requiere escanear
-- todos los logs del tenant y filtrar por entity_type + entity_id.
-- audit_logs crece rapido, asi que este index es critico a escala.
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_logs (tenant_id, entity_type, entity_id);

-- ─── 4. notifications(tenant_id, type, user_id, created_at DESC) ───────
-- Usado por: `NotificationsService.createBulk()` con dedup, que busca
-- notificaciones recientes por (tenantId, type, user_id IN [...]) con
-- filtro por createdAt > cutoff. El index existente
-- `idx_notifications_tenant_unread` cubre (tenant_id, user_id, is_read),
-- NO incluye type ni createdAt. Este nuevo index es mas especifico para
-- la query de dedup (ejecutada cada 6h por el cron de recordatorios).
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications (tenant_id, type, user_id, created_at DESC);

-- ─── 5. evaluation_assignments(tenant_id, status) ──────────────────────
-- Usado por: reports y analytics que cuentan assignments por estado
-- (pending, in_progress, completed). El index existente cubre por ciclo
-- y por evaluatee/evaluator, pero NO por status. Sin este index, el
-- dashboard ejecutivo hace full scan por cada tenant para calcular
-- completion rate.
CREATE INDEX IF NOT EXISTS idx_assignments_tenant_status
  ON evaluation_assignments (tenant_id, status);

-- ─── Resumen ────────────────────────────────────────────────────────────
-- Indices agregados:  5
-- Tablas afectadas:   5 (user_points, survey_responses, audit_logs,
--                        notifications, evaluation_assignments)
-- Tamano esperado:    <10 MB por index para un tenant con ~10k filas
-- Impacto ejecucion:  <30 segundos en BD con pocos miles de filas
-- ══════════════════════════════════════════════════════════════════════
