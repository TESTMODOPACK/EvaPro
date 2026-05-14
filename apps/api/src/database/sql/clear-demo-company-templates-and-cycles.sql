-- ─────────────────────────────────────────────────────────────────────────
-- clear-demo-company-templates-and-cycles.sql
--
-- Elimina TODOS los ciclos de evaluación Y TODAS las plantillas del tenant
-- "DEMO Company". A diferencia de clear-demo-company-evaluations.sql, este
-- script SÍ borra form_templates y form_sub_templates.
--
-- Preserva: usuarios, departamentos, competencias, organigrama, leads,
-- talent_assessments fuera de ciclos demo, etc.
--
-- Ejecutar en el VPS:
--   docker compose cp apps/api/src/database/sql/clear-demo-company-templates-and-cycles.sql db:/tmp/
--   docker compose exec -T db psql -U eva360 -d eva360 -f /tmp/clear-demo-company-templates-and-cycles.sql
--
-- Idempotente: si el tenant no existe o no tiene plantillas/ciclos, no hace
-- nada y termina con éxito.
-- ─────────────────────────────────────────────────────────────────────────

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo '  Limpieza de plantillas + ciclos — Tenant DEMO Company'
\echo '═══════════════════════════════════════════════════════════════════'
\echo ''

DO $$
DECLARE
  v_demo_tenant_id UUID;
  v_demo_tenant_name TEXT;
  v_cycle_ids UUID[];
  v_template_ids UUID[];
  v_cycle_count INT;
  v_template_count INT;
  v_sub_template_count INT;
  v_assignment_count INT;
  v_response_count INT;
  v_peer_assignment_count INT;
  v_stage_count INT;
  v_talent_count INT;
  v_calibration_session_count INT;
  v_calibration_entry_count INT;
  v_ai_insight_count INT;
  v_ai_call_log_count INT;
  v_org_snapshot_count INT;
  v_evaluatee_weight_count INT;
  v_obj_snapshot_count INT;
BEGIN
  -- ── 1. Encontrar el tenant DEMO Company ─────────────────────────────
  SELECT id, name INTO v_demo_tenant_id, v_demo_tenant_name
  FROM tenants
  WHERE slug = 'demo' OR name ILIKE '%demo%company%' OR name ILIKE 'demo company'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_demo_tenant_id IS NULL THEN
    RAISE NOTICE '⚠️  No se encontró tenant DEMO Company. Nada que limpiar.';
    RETURN;
  END IF;

  RAISE NOTICE 'Tenant encontrado: % (id=%)', v_demo_tenant_name, v_demo_tenant_id;
  RAISE NOTICE '';

  -- RLS: contexto del tenant para que las policies permitan los DELETE.
  PERFORM set_config('app.current_tenant_id', v_demo_tenant_id::TEXT, true);

  -- ── 2. Recopilar IDs de ciclos y plantillas ─────────────────────────
  SELECT array_agg(id), COUNT(*)
    INTO v_cycle_ids, v_cycle_count
  FROM evaluation_cycles
  WHERE tenant_id = v_demo_tenant_id;

  SELECT array_agg(id), COUNT(*)
    INTO v_template_ids, v_template_count
  FROM form_templates
  WHERE tenant_id = v_demo_tenant_id;

  IF v_cycle_count = 0 AND v_template_count = 0 THEN
    RAISE NOTICE '✅ Tenant no tiene ciclos ni plantillas. Nada que limpiar.';
    RETURN;
  END IF;

  -- ── 3. Conteo informativo (antes de borrar) ─────────────────────────
  SELECT COUNT(*) INTO v_sub_template_count
  FROM form_sub_templates
  WHERE tenant_id = v_demo_tenant_id;

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

  IF v_cycle_ids IS NOT NULL THEN
    SELECT COUNT(*) INTO v_ai_insight_count
    FROM ai_insights
    WHERE tenant_id = v_demo_tenant_id
      AND cycle_id = ANY(v_cycle_ids);
  ELSE
    v_ai_insight_count := 0;
  END IF;

  SELECT COUNT(*) INTO v_ai_call_log_count
  FROM ai_call_logs
  WHERE tenant_id = v_demo_tenant_id;

  RAISE NOTICE '┌─ Datos a eliminar ─────────────────────────────────┐';
  RAISE NOTICE '│ Plantillas (form_templates):    % │', LPAD(v_template_count::TEXT, 18);
  RAISE NOTICE '│ Subplantillas (form_sub_*):     % │', LPAD(v_sub_template_count::TEXT, 18);
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

  -- 4.3 talent_assessments del tenant (todos, ligados o no a ciclos)
  DELETE FROM talent_assessments WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_talent_count = ROW_COUNT;
  RAISE NOTICE '  ✅ talent_assessments eliminados: %', v_talent_count;

  -- 4.4 ai_insights de ciclos
  IF v_cycle_ids IS NOT NULL THEN
    DELETE FROM ai_insights
    WHERE tenant_id = v_demo_tenant_id
      AND cycle_id = ANY(v_cycle_ids);
    GET DIAGNOSTICS v_ai_insight_count = ROW_COUNT;
    RAISE NOTICE '  ✅ ai_insights de ciclos eliminados: %', v_ai_insight_count;
  END IF;

  -- 4.5 ai_call_logs del tenant
  DELETE FROM ai_call_logs WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_ai_call_log_count = ROW_COUNT;
  RAISE NOTICE '  ✅ ai_call_logs eliminados: %', v_ai_call_log_count;

  -- 4.6 peer_assignments
  DELETE FROM peer_assignments WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_peer_assignment_count = ROW_COUNT;
  RAISE NOTICE '  ✅ peer_assignments eliminadas: %', v_peer_assignment_count;

  -- 4.7 evaluation_responses
  DELETE FROM evaluation_responses WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_response_count = ROW_COUNT;
  RAISE NOTICE '  ✅ evaluation_responses eliminadas: %', v_response_count;

  -- 4.8 evaluation_assignments
  DELETE FROM evaluation_assignments WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_assignment_count = ROW_COUNT;
  RAISE NOTICE '  ✅ evaluation_assignments eliminadas: %', v_assignment_count;

  -- 4.9 cycle_stages
  DELETE FROM cycle_stages WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_stage_count = ROW_COUNT;
  RAISE NOTICE '  ✅ cycle_stages eliminadas: %', v_stage_count;

  -- 4.10 cycle_org_snapshots (Sprint 1 BR-C.1)
  IF v_cycle_ids IS NOT NULL THEN
    DELETE FROM cycle_org_snapshots WHERE cycle_id = ANY(v_cycle_ids);
    GET DIAGNOSTICS v_org_snapshot_count = ROW_COUNT;
    RAISE NOTICE '  ✅ cycle_org_snapshots eliminados: %', v_org_snapshot_count;
  END IF;

  -- 4.11 cycle_evaluatee_weights (Sprint 2 BR-A.1)
  IF v_cycle_ids IS NOT NULL THEN
    DELETE FROM cycle_evaluatee_weights WHERE cycle_id = ANY(v_cycle_ids);
    GET DIAGNOSTICS v_evaluatee_weight_count = ROW_COUNT;
    RAISE NOTICE '  ✅ cycle_evaluatee_weights eliminados: %', v_evaluatee_weight_count;
  END IF;

  -- 4.12 evaluation_objective_snapshots (si existe FK a cycles)
  IF v_cycle_ids IS NOT NULL THEN
    BEGIN
      DELETE FROM evaluation_objective_snapshots WHERE cycle_id = ANY(v_cycle_ids);
      GET DIAGNOSTICS v_obj_snapshot_count = ROW_COUNT;
      RAISE NOTICE '  ✅ evaluation_objective_snapshots eliminados: %', v_obj_snapshot_count;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END IF;

  -- 4.13 development_plans con cycle_id → NULL (preservar PDIs sin ciclo)
  IF v_cycle_ids IS NOT NULL THEN
    BEGIN
      UPDATE development_plans SET cycle_id = NULL
        WHERE cycle_id = ANY(v_cycle_ids);
      RAISE NOTICE '  ✅ development_plans desligados del ciclo (cycle_id → NULL)';
    EXCEPTION WHEN undefined_column THEN
      NULL;
    END;
  END IF;

  -- 4.14 evaluation_cycles
  DELETE FROM evaluation_cycles WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_cycle_count = ROW_COUNT;
  RAISE NOTICE '  ✅ evaluation_cycles eliminados: %', v_cycle_count;

  -- 4.15 form_sub_templates (FK CASCADE en form_templates pero
  --      borramos explicito para tener conteo informativo)
  DELETE FROM form_sub_templates WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_sub_template_count = ROW_COUNT;
  RAISE NOTICE '  ✅ form_sub_templates eliminadas: %', v_sub_template_count;

  -- 4.16 form_templates
  DELETE FROM form_templates WHERE tenant_id = v_demo_tenant_id;
  GET DIAGNOSTICS v_template_count = ROW_COUNT;
  RAISE NOTICE '  ✅ form_templates eliminadas: %', v_template_count;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  ✅ Limpieza completada para tenant: %', v_demo_tenant_name;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Datos preservados (NO modificados):';
  RAISE NOTICE '  • Usuarios y roles';
  RAISE NOTICE '  • Departamentos y organigrama';
  RAISE NOTICE '  • Competencias';
  RAISE NOTICE '  • Posiciones / Cargos';
  RAISE NOTICE '  • Notificaciones existentes';
  RAISE NOTICE '  • Objetivos / OKRs';
  RAISE NOTICE '  • Development plans (sólo se desligaron del ciclo)';
END $$;

-- ── 5. Verificación post-limpieza ─────────────────────────────────────
\echo ''
\echo 'Verificación: plantillas y ciclos restantes del tenant DEMO Company'

SELECT 'form_templates' AS tabla, COUNT(*) AS restantes
FROM form_templates t
JOIN tenants tn ON tn.id = t.tenant_id
WHERE tn.slug = 'demo' OR tn.name ILIKE '%demo%company%'
UNION ALL
SELECT 'form_sub_templates', COUNT(*)
FROM form_sub_templates s
JOIN tenants tn ON tn.id = s.tenant_id
WHERE tn.slug = 'demo' OR tn.name ILIKE '%demo%company%'
UNION ALL
SELECT 'evaluation_cycles', COUNT(*)
FROM evaluation_cycles c
JOIN tenants tn ON tn.id = c.tenant_id
WHERE tn.slug = 'demo' OR tn.name ILIKE '%demo%company%';
