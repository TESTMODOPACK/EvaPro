/**
 * F4 — Schema baseline para Row-Level Security.
 *
 * Lista canonica de las tablas que TIENEN columna `tenant_id` en la BD
 * y por lo tanto van a recibir politicas RLS en Fase B/C. Generada en
 * Fase A1 a partir de un grep de los @Entity con `tenantId` en
 * apps/api/src/modules.
 *
 * Mantenimiento:
 *   - Cuando se agregue una nueva tabla con tenant_id → agregarla aqui.
 *   - Cuando se renombre/borre una tabla → actualizar la lista.
 *   - El validador `validateTenantSchemaDrift()` (este modulo) detecta
 *     cuando la lista esta desactualizada vs la BD real.
 *
 * Ver `docs/F4-RLS-PLAN.md` para el plan completo de las 5 fases.
 */
import type { DataSource } from 'typeorm';

/**
 * 69 tablas con `tenant_id`. Ordenadas alfabeticamente para que un
 * diff git sea legible cuando se agregue/quite una.
 *
 * 2026-04-28: agregada `form_sub_templates` (Fase 3 plan auditoria - Opción A).
 */
export const EXPECTED_TENANT_TABLES: ReadonlyArray<string> = [
  'ai_call_logs',
  'ai_insights',
  'audit_logs',
  'badges',
  'bulk_imports',
  'calibration_sessions',
  'challenge_progress',
  'challenges',
  'checkins',
  'competencies',
  'contracts',
  'custom_kpis',
  'cycle_stages',
  'dei_corrective_actions',
  'departments',
  'development_actions',
  'development_comments',
  'development_plans',
  'document_signatures',
  'engagement_surveys',
  'evaluation_assignments',
  'evaluation_cycles',
  'evaluation_responses',
  'form_sub_templates',
  'form_templates',
  'gdpr_requests',
  'invoices',
  'key_results',
  'leads',
  'meeting_locations',
  'mood_checkins',
  'mvp_of_the_month',
  'notifications',
  'objective_comments',
  'objective_updates',
  'objectives',
  'oidc_configurations',
  'org_dev_initiative_participants',
  'org_development_actions',
  'org_development_initiatives',
  'org_development_plans',
  'payment_history',
  'payment_sessions',
  'peer_assignments',
  'points_budgets',
  'positions',
  'push_subscriptions',
  'quick_feedbacks',
  'recognition_comments',
  'recognitions',
  'recruitment_candidates',
  'recruitment_processes',
  'redemption_items',
  'redemption_transactions',
  'role_competencies',
  'subscription_requests',
  'subscriptions',
  'support_tickets',
  'survey_assignments',
  'survey_responses',
  'talent_assessments',
  'team_meetings',
  'user_badges',
  'user_departures',
  'user_movements',
  'user_notes',
  'user_points',
  'user_points_summary',
  'users',
] as const;

/**
 * Tablas SIN columna `tenant_id` que son legitimamente globales o que
 * heredan el scope tenant via parent FK. NO van a recibir RLS directa
 * — el aislamiento se hereda del parent (que SI tiene tenant_id) via
 * los joins.
 *
 * Si una tabla nueva aparece sin tenant_id y no esta aqui, el
 * validador la flaggea como sospechosa (probable bug — falta el
 * campo).
 */
export const ALLOWED_NO_TENANT_TABLES: ReadonlyArray<string> = [
  // Tablas globales (catalogos compartidos entre tenants):
  'subscription_plans',     // catalogo de planes (Free/Pro/Enterprise)
  'system_changelog',       // log global de versiones
  'tenants',                // raiz — la tabla que almacena los tenants

  // Tablas que heredan tenant_id via parent FK (el join asegura scope):
  'invoice_lines',          // FK invoice_id → invoices.tenant_id
  'password_histories',     // FK user_id → users.tenant_id
  'recruitment_evaluators', // FK process_id → recruitment_processes.tenant_id
  'recruitment_interviews', // FK process_id → recruitment_processes.tenant_id
  'survey_questions',       // FK survey_id → engagement_surveys.tenant_id
  'calibration_entries',    // FK session_id → calibration_sessions.tenant_id
  'team_meeting_participants', // FK meeting_id → team_meetings.tenant_id

  // Tablas de infraestructura (no tienen datos de negocio):
  'migrations',
  'typeorm_metadata',
] as const;

/**
 * Resultado de la comparacion entre la lista esperada y la BD real.
 * Sirve para detectar drift (tablas agregadas/borradas sin actualizar
 * el baseline).
 */
export interface SchemaDriftReport {
  /** Tablas en BD con tenant_id que NO estan en EXPECTED_TENANT_TABLES.
   *  → Probable: alguien agrego una tabla sin actualizar el baseline.
   *  → Riesgo: cuando se ejecute la migration de RLS en Fase C, esta
   *  tabla NO va a recibir politica → leak silencioso. */
  missingFromBaseline: string[];

  /** Tablas en EXPECTED_TENANT_TABLES que NO existen en BD.
   *  → Probable: tabla renombrada/borrada sin actualizar baseline.
   *  → Riesgo: lista desactualizada, dificulta auditoria. */
  removedFromDatabase: string[];

  /** Tablas en BD sin tenant_id que NO estan en ALLOWED_NO_TENANT_TABLES.
   *  → Probable: alguien agrego una tabla y olvido el tenant_id.
   *  → Riesgo: leak cross-tenant si la tabla guarda datos de negocio. */
  suspiciousNoTenant: string[];
}

/**
 * Compara la lista esperada vs la BD real consultando
 * information_schema. Solo lectura, idempotente. Util en:
 *   - Startup check (warn en logs si hay drift)
 *   - CI pipeline (fail si hay drift en main)
 *   - Manual: `pnpm tsx ...` ad hoc
 *
 * @param dataSource — un TypeORM DataSource conectado.
 */
export async function validateTenantSchemaDrift(
  dataSource: DataSource,
): Promise<SchemaDriftReport> {
  // 1) Tablas reales en public schema con tenant_id
  const tenantTablesQuery = `
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
    ORDER BY c.table_name
  `;
  const tenantRows: Array<{ table_name: string }> =
    await dataSource.query(tenantTablesQuery);
  const realTenantTables = new Set(tenantRows.map((r) => r.table_name));

  // 2) Todas las tablas en public (para detectar las que NO tienen tenant)
  const allTablesQuery = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const allRows: Array<{ table_name: string }> =
    await dataSource.query(allTablesQuery);
  const realAllTables = new Set(allRows.map((r) => r.table_name));
  const realNoTenantTables = new Set(
    [...realAllTables].filter((t) => !realTenantTables.has(t)),
  );

  // 3) Computar diffs
  const expectedSet = new Set(EXPECTED_TENANT_TABLES);
  const allowedSet = new Set(ALLOWED_NO_TENANT_TABLES);

  const missingFromBaseline = [...realTenantTables]
    .filter((t) => !expectedSet.has(t))
    .sort();
  const removedFromDatabase = [...expectedSet]
    .filter((t) => !realTenantTables.has(t))
    .sort();
  const suspiciousNoTenant = [...realNoTenantTables]
    .filter((t) => !allowedSet.has(t))
    .sort();

  return {
    missingFromBaseline,
    removedFromDatabase,
    suspiciousNoTenant,
  };
}

/**
 * Helper para imprimir el reporte en formato legible (para logs o CI).
 */
export function formatSchemaDriftReport(report: SchemaDriftReport): string {
  const lines: string[] = [];
  const hasDrift =
    report.missingFromBaseline.length > 0 ||
    report.removedFromDatabase.length > 0 ||
    report.suspiciousNoTenant.length > 0;

  if (!hasDrift) {
    return '✓ Schema baseline alineado con BD real (sin drift)';
  }

  lines.push('⚠ Schema drift detectado:');
  if (report.missingFromBaseline.length > 0) {
    lines.push(
      `  Tablas con tenant_id en BD que faltan en EXPECTED_TENANT_TABLES (${report.missingFromBaseline.length}):`,
    );
    report.missingFromBaseline.forEach((t) => lines.push(`    - ${t}`));
  }
  if (report.removedFromDatabase.length > 0) {
    lines.push(
      `  Tablas en EXPECTED_TENANT_TABLES que ya no existen en BD (${report.removedFromDatabase.length}):`,
    );
    report.removedFromDatabase.forEach((t) => lines.push(`    - ${t}`));
  }
  if (report.suspiciousNoTenant.length > 0) {
    lines.push(
      `  Tablas SIN tenant_id que no estan en ALLOWED_NO_TENANT_TABLES (${report.suspiciousNoTenant.length}):`,
    );
    lines.push(
      `    (probable bug: alguien agrego una tabla sin tenant_id — verifica si es legitima global)`,
    );
    report.suspiciousNoTenant.forEach((t) => lines.push(`    - ${t}`));
  }

  return lines.join('\n');
}
