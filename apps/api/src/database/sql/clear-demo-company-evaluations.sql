-- ─────────────────────────────────────────────────────────────────────────
-- clear-demo-company-evaluations.sql
--
-- Elimina TODOS los datos de ciclos de evaluación del tenant "DEMO Company".
-- NO toca usuarios, plantillas, competencias, departamentos ni otros datos.
--
-- Ejecutar en el VPS:
--   docker compose exec -T db psql -U eva360 -d eva360 \
--     -f /docker-entrypoint-initdb.d/clear-demo-company-evaluations.sql
--
-- O copiar al contenedor y ejecutar:
--   docker compose cp apps/api/src/database/sql/clear-demo-company-evaluations.sql db:/tmp/
--   docker compose exec -T db psql -U eva360 -d eva360 -f /tmp/clear-demo-company-evaluations.sql
--
-- Idempotente: si DEMO Company no existe o no tiene ciclos, no hace nada.
-- ─────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo '  Limpieza de evaluaciones — Tenant DEMO Company'
\echo '═══════════════════════════════════════════════════════════════════'
\echo ''

DO $$
DECLARE
  v_demo_tenant_id UUID;
  v_demo_tenant_name TEXT;
  v_cycle_ids UUID[];
  v_cycle_count INT;
  v_assignment_count INT;
  v_response_count INT;
  v_peer_assignment_count INT;
  v_stage_count INT;
  v_talent_count INT;
  v_calibration_session_count INT;
  v_calibration_entry_count INT;
  v_ai_insight_count INT;
  v_ai_call_log_count INT;
BEGIN
  -- ── 1. Encontrar el tenant DEMO Company ─────────────────────────────
  SELECT id, name INTO v_demo_tenant_id, v_demo_tenant_name
  FROM tenants
  WHERE slug = 'demo' OR name ILIKE '%demo%company%' OR name ILIKE 'demo company'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_demo_tenant_id IS NULL THEN
    RAISE NOTICE '⚠️  No se encontró tenant DEMO Company. Nada que limpiar.';
    RAISE NOTICE '    (Buscado por slug=demo o name ILIKE demo*)';
    RETURN;
  END IF;

  RAISE NOTICE 'Tenant encontrado: % (id=%)', v_demo_tenant_name, v_demo_tenant_id;
  RAISE NOTICE '';

  -- ── 2. Recopilar IDs de ciclos del tenant ───────────────────────────
  SELECT array_agg(id), COUNT(*)
    INTO v_cycle_ids, v_cycle_count
  FROM evaluation_cycles
  WHERE tenant_id = v_demo_tenant_id;

  IF v_cycle_count = 0 THEN
    RAISE NOTICE '✅ Tenant no tiene ciclos de evaluación. Nada que limpiar.';
    RETURN;
  END IF;

  -- ── 3. Conteo informativo (antes de borrar) ─────────────────────────
  SELECT COUNT(*) INTO v_assignment_count
  FROM evaluation_assignments
  WHERE tenant_id = v_demo_tenant_id;

  SELECT COUNT(*) INTO v_response_count
  FROM evaluation_responses
  WHERE tenant_id = v_demo_tenant_id;

  SELECT COUNT(*) INTO v_peer_assignment_count
  FROM peer_assignments
  WHERE tenant_id = v_demo_tenant_id;

  SELECT COUNT(*) INTO v_stage_count
  FROM cycle_stages
  WHERE tenant_id = v_demo_tenant_id;

  SELECT COUNT(*) INTO v_talent_count
  FROM talent_assessments
  WHERE tenant_id = v_demo_tenant_id;

  SELECT COUNT(*) INTO v_calibration_session_count
  FROM calibration_sessions
  WHERE tenant_id = v_demo_tenant_id;

  SELECT COUNT(*) INTO v_calibration_entry_count
  FROM calibration_entries
  WHERE session_id IN (
    SELECT id FROM calibration_sessions WHERE tenant_id = v_demo_tenant_id
  );

  -- ai_insights tiene columna cycle_id directa (no metadata)
  SELECT COUNT(*) INTO v_ai_insight_count
  FROM ai_insights
  WHERE tenant_id = v_demo_tenant_id
    AND cycle_id = ANY(v_cycle_ids);

  -- ai_call_logs solo borra los relacionados a cycles del tenant
  -- (sin tenant_id directo en metadata, solo limpiamos por tenant_id)
  SELECT COUNT(*) INTO v_ai_call_log_count
  FROM ai_call_logs
  WHERE tenant_id = v_demo_tenant_id;

  RAISE NOTICE '┌─ Datos a eliminar ─────────────────────────────────┐';
  RAISE NOTICE '│ Ciclos de evaluación:           % │', LPAD(v_cycle_count::TEXT, 18);
  RAISE NOTICE '│ Etapas de ciclo:                % │', LPAD(v_stage_count::TEXT, 18);
  RAISE NOTICE '│ Asignaciones:                   % │', LPAD(v_assignment_count::TEXT, 18);
  RAISE NOTICE '│ Respuestas:                     % │', LPAD(v_response_count::TEXT, 18);
  RAISE NOTICE '│ Asignaciones de pares:          % │', LPAD(v_peer_assignment_count::TEXT, 18);
  RAISE NOTICE '│ Talent assessments (Nine Box):  % │', LPAD(v_talent_count::TEXT, 18);
  RAISE NOTICE '│ Sesiones de calibración:        % │', LPAD(v_calibration_session_count::TEXT, 18);
  RAISE NOTICE '│ Entradas de calibración:        % │', LPAD(v_calibration_entry_count::TEXT, 18);
  RAISE NOTICE '│ AI insights de ciclos:          % │', LPAD(v_ai_insight_count::TEXT, 18);
  RAISE NOTICE '│ AI call logs (tenant):          % │', LPAD(v_ai_call_log_count::TEXT, 18);
  RAISE NOTICE '└────────────────────────────────────────────────────┘';
  RAISE NOTICE '';

  -- ── 4. Borrar en orden (FK dependencies) ────────────────────────────

  -- 4.1 calibration_entries (depende de calibration_sessions)
  DELETE FROM calibration_entries
  WHERE session_id IN (
    SELECT id FROM calibration_sessions WHERE tenant_id = v_demo_tenant_id
  );
  GET DIAGNOSTICS v_calibration_entry_count = ROW_COUNT;
  RAISE NOTICE '  ✅ calibration_entries eliminadas: %', v_calibration_entry_count;

  -- 4.2 calibration_sessions
  DELETE FROM calibration_sessions WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_calibration_session_count = ROW_COUNT;
  RAISE NOTICE '  ✅ calibration_sessions eliminadas: %', v_calibration_session_count;

  -- 4.3 talent_assessments
  DELETE FROM talent_assessments WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_talent_count = ROW_COUNT;
  RAISE NOTICE '  ✅ talent_assessments eliminados: %', v_talent_count;

  -- 4.4 ai_insights de ciclos (columna cycle_id directa, no metadata)
  DELETE FROM ai_insights
  WHERE tenant_id = v_demo_tenant_id
    AND cycle_id = ANY(v_cycle_ids);
  GET DIAGNOSTICS v_ai_insight_count = ROW_COUNT;
  RAISE NOTICE '  ✅ ai_insights de ciclos eliminados: %', v_ai_insight_count;

  -- 4.5 ai_call_logs del tenant (audit trail completo del tenant DEMO)
  DELETE FROM ai_call_logs WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_ai_call_log_count = ROW_COUNT;
  RAISE NOTICE '  ✅ ai_call_logs eliminados: %', v_ai_call_log_count;

  -- 4.6 peer_assignments
  DELETE FROM peer_assignments WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_peer_assignment_count = ROW_COUNT;
  RAISE NOTICE '  ✅ peer_assignments eliminadas: %', v_peer_assignment_count;

  -- 4.7 evaluation_responses (depende de assignments)
  DELETE FROM evaluation_responses WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_response_count = ROW_COUNT;
  RAISE NOTICE '  ✅ evaluation_responses eliminadas: %', v_response_count;

  -- 4.8 evaluation_assignments (depende de cycles)
  DELETE FROM evaluation_assignments WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_assignment_count = ROW_COUNT;
  RAISE NOTICE '  ✅ evaluation_assignments eliminadas: %', v_assignment_count;

  -- 4.9 cycle_stages (depende de cycles)
  DELETE FROM cycle_stages WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_stage_count = ROW_COUNT;
  RAISE NOTICE '  ✅ cycle_stages eliminadas: %', v_stage_count;

  -- 4.10 evaluation_cycles (raíz)
  DELETE FROM evaluation_cycles WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_cycle_count = ROW_COUNT;
  RAISE NOTICE '  ✅ evaluation_cycles eliminados: %', v_cycle_count;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  ✅ Limpieza completada para tenant: %', v_demo_tenant_name;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Datos preservados (NO modificados):';
  RAISE NOTICE '  • Usuarios y roles';
  RAISE NOTICE '  • Plantillas (form_templates)';
  RAISE NOTICE '  • Competencias';
  RAISE NOTICE '  • Departamentos';
  RAISE NOTICE '  • Posiciones / Cargos';
  RAISE NOTICE '  • Notificaciones existentes';
  RAISE NOTICE '  • Cualquier otro dato del tenant';
END $$;

-- ── 5. Verificación post-limpieza ─────────────────────────────────────
\echo ''
\echo 'Verificación: ciclos restantes del tenant DEMO Company'
SELECT
  c.id,
  c.name,
  c.type,
  c.status
FROM evaluation_cycles c
JOIN tenants t ON t.id = c.tenant_id
WHERE t.slug = 'demo' OR t.name ILIKE '%demo%company%'
ORDER BY c.created_at DESC;
