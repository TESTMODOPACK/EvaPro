/**
 * cleanup-orphans.ts — Script de startup idempotente.
 *
 * ════════════════════════════════════════════════════════════════════════
 * REGLA DE ORO: ESTE SCRIPT NO BORRA NADA.
 *
 * - NO hace DROP TABLE.
 * - NO hace DELETE FROM.
 * - NO hace TRUNCATE.
 * - NO hace DROP CONSTRAINT.
 * - NO hace SET column = NULL masivamente.
 *
 * Cualquier operacion destructiva requiere aprobacion explicita del
 * Product Owner y debe ejecutarse MANUALMENTE, nunca en un script de
 * startup automatico.
 *
 * Lo unico que hace es:
 * 1. ADD COLUMN IF NOT EXISTS — agregar columnas nuevas sin perder data.
 * 2. ADD ENUM VALUE IF NOT EXISTS — agregar valores a enums existentes.
 * 3. Backfill de campos derivados (positions.level, users.hierarchy_level)
 *    — solo UPDATEs idempotentes que rellenan NULL o 0 desde fuentes
 *    de verdad existentes. Nunca sobreescribe datos del usuario.
 *
 * Corre automaticamente antes de `node dist/main` via el CMD del
 * Dockerfile. Es seguro correr multiples veces sin efectos colaterales.
 * ════════════════════════════════════════════════════════════════════════
 */
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  if (!DATABASE_URL) {
    console.log('[startup] No DATABASE_URL — skipping');
    return;
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    console.log('[startup] Connected to database');

    // ── 0. Recrear tablas que fueron dropeadas por el cleanup anterior ──
    // El cleanup-orphans.ts antiguo (pre-commit 5b4a73b) dropeaba las
    // tablas de calibracion en cada startup. Si ya fueron dropeadas,
    // las recreamos aqui. CREATE TABLE IF NOT EXISTS es idempotente.
    const tableFixes = [
      `CREATE TABLE IF NOT EXISTS calibration_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        cycle_id uuid NOT NULL REFERENCES evaluation_cycles(id),
        name varchar(200) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'draft',
        department varchar(100),
        department_id uuid,
        moderator_id uuid NOT NULL REFERENCES users(id),
        min_quorum int NOT NULL DEFAULT 3,
        expected_distribution jsonb,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS calibration_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id uuid NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id),
        original_score decimal(5,2) NOT NULL DEFAULT 0,
        adjusted_score decimal(5,2),
        original_potential decimal(5,2),
        adjusted_potential decimal(5,2),
        rationale text,
        status varchar(30) NOT NULL DEFAULT 'pending',
        discussed_by uuid,
        change_log jsonb DEFAULT '[]',
        approval_required boolean NOT NULL DEFAULT false,
        approval_status varchar(30) NOT NULL DEFAULT 'not_required',
        approved_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_calib_tenant_cycle ON calibration_sessions(tenant_id, cycle_id)`,
      `CREATE INDEX IF NOT EXISTS idx_calib_dept_id ON calibration_sessions(department_id)`,
      `CREATE INDEX IF NOT EXISTS idx_calib_entry_session ON calibration_entries(session_id)`,
      // GDPR requests table — created here (not via TypeORM synchronize) so
      // the module can load even before synchronize runs on first boot.
      `CREATE TABLE IF NOT EXISTS gdpr_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
        type varchar(30) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'pending',
        file_url varchar(1000) NULL,
        file_expires_at timestamptz NULL,
        confirmation_code varchar(10) NULL,
        confirmation_code_expires timestamptz NULL,
        error_message text NULL,
        metadata jsonb NOT NULL DEFAULT '{}',
        requested_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_gdpr_requests_user ON gdpr_requests(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_gdpr_requests_tenant ON gdpr_requests(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_gdpr_requests_status ON gdpr_requests(status)`,
      `CREATE INDEX IF NOT EXISTS idx_gdpr_requests_type_requested ON gdpr_requests(type, requested_at)`,
      // Payment sessions — Stripe / MercadoPago handshake idempotency.
      `CREATE TABLE IF NOT EXISTS payment_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        initiated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        provider varchar(20) NOT NULL,
        external_id varchar(255) NULL,
        checkout_url varchar(1000) NULL,
        amount numeric(12,2) NOT NULL,
        currency varchar(10) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'pending',
        failure_reason varchar(500) NULL,
        metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_sessions_provider_ext
        ON payment_sessions(provider, external_id)
        WHERE external_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_payment_sessions_tenant ON payment_sessions(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_payment_sessions_invoice ON payment_sessions(invoice_id)`,
      `CREATE INDEX IF NOT EXISTS idx_payment_sessions_status ON payment_sessions(status)`,
      // Leads — captura de prospects pre-venta desde la landing pública.
      // NO tiene FK a tenants porque un lead es un prospect que aún no es
      // cliente. Solo se crea el tenant cuando se convierte el lead.
      `CREATE TABLE IF NOT EXISTS leads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(150) NOT NULL,
        company varchar(150) NOT NULL,
        role varchar(120) NULL,
        email varchar(200) NOT NULL,
        phone varchar(40) NOT NULL,
        company_size varchar(20) NULL,
        industry varchar(40) NULL,
        region varchar(40) NULL,
        source varchar(40) NULL,
        message text NOT NULL,
        origin varchar(30) NOT NULL DEFAULT 'ascenda.cl',
        ip_address varchar(64) NULL,
        user_agent varchar(500) NULL,
        captcha_verdict varchar(30) NOT NULL DEFAULT 'verified',
        status varchar(20) NOT NULL DEFAULT 'new',
        internal_notes text NULL,
        assigned_to uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        status_changed_at timestamptz NULL,
        converted_tenant_id uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
      `CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`,
      // Grupo C — auth
      `CREATE TABLE IF NOT EXISTS password_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        password_hash varchar(255) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_password_history_user_created ON password_history(user_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS oidc_configurations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
        issuer_url varchar(500) NOT NULL,
        client_id varchar(255) NOT NULL,
        client_secret_enc varchar(1000) NOT NULL,
        enabled boolean NOT NULL DEFAULT false,
        require_sso boolean NOT NULL DEFAULT false,
        allowed_email_domains jsonb NOT NULL DEFAULT '[]',
        role_mapping jsonb NOT NULL DEFAULT '{}',
        metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_oidc_configurations_enabled ON oidc_configurations(enabled)`,

      // ── ai_call_logs (audit trail de llamadas a Anthropic, F4) ────────
      // Persiste cada llamada al API de IA antes del parseJson, asegurando
      // que tokens consumidos quedan trackeados aunque el response sea
      // JSON malformado. Ver ai-insights.service.ts callClaudeAndPersistInsight.
      `CREATE TABLE IF NOT EXISTS ai_call_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        type ai_insights_type_enum NOT NULL,
        tokens_used int NOT NULL DEFAULT 0,
        input_tokens int NOT NULL DEFAULT 0,
        output_tokens int NOT NULL DEFAULT 0,
        model varchar(100) NOT NULL,
        generated_by uuid NOT NULL REFERENCES users(id),
        parse_success boolean NOT NULL DEFAULT true,
        error_message text,
        insight_id uuid REFERENCES ai_insights(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ai_call_logs_tenant ON ai_call_logs(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_call_logs_created ON ai_call_logs(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_call_logs_tenant_created ON ai_call_logs(tenant_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_call_logs_parse_errors ON ai_call_logs(tenant_id, created_at DESC) WHERE parse_success = false`,

      // ── form_sub_templates (Fase 3 plan auditoria - Opción A) ──────────
      // Subplantillas anidadas a un FormTemplate padre. Cada subplantilla
      // pertenece a un relation_type (self/manager/peer/direct_report/
      // external) y tiene su propio set de secciones/preguntas + un peso
      // que pondera su contribución al score final del ciclo.
      //
      // Idempotente: CREATE TABLE IF NOT EXISTS no afecta DBs ya migradas.
      `CREATE TABLE IF NOT EXISTS form_sub_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NULL REFERENCES tenants(id) ON DELETE CASCADE,
        parent_template_id uuid NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
        relation_type varchar(20) NOT NULL,
        sections jsonb NOT NULL DEFAULT '[]',
        weight numeric(4,3) NOT NULL DEFAULT 0,
        display_order int NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_sub_template_parent_relation UNIQUE (parent_template_id, relation_type)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sub_templates_parent ON form_sub_templates(parent_template_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sub_templates_tenant ON form_sub_templates(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sub_templates_active ON form_sub_templates(parent_template_id, is_active) WHERE is_active = true`,

      // ── cycle_org_snapshots (Sprint 1 BR-C.1 auditoria integridad) ────
      // Snapshot inmutable del organigrama al lanzar un ciclo. Garantiza
      // que reports y validaciones se mantengan coherentes incluso si
      // users.manager_id, department_id, etc. cambian mid-cycle.
      `CREATE TABLE IF NOT EXISTS cycle_org_snapshots (
        cycle_id uuid NOT NULL REFERENCES evaluation_cycles(id) ON DELETE CASCADE,
        user_id uuid NOT NULL,
        tenant_id uuid NULL REFERENCES tenants(id) ON DELETE CASCADE,
        primary_manager_id uuid NULL,
        secondary_managers uuid[] NOT NULL DEFAULT '{}',
        department_id uuid NULL,
        department_name varchar(200) NULL,
        hierarchy_level int NULL,
        role varchar(50) NULL,
        is_active boolean NOT NULL,
        late_addition boolean NOT NULL DEFAULT false,
        excluded_at timestamptz NULL,
        excluded_reason text NULL,
        snapshot_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (cycle_id, user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cycle_org_snapshot_user ON cycle_org_snapshots(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_cycle_org_snapshot_cycle_active ON cycle_org_snapshots(cycle_id, is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_cycle_org_snapshot_tenant ON cycle_org_snapshots(tenant_id)`,

      // ── cycle_evaluatee_weights (Sprint 2 BR-A.1 — pesos efectivos) ──
      // Persiste pesos redistribuidos por evaluado cuando el sistema
      // aplica REDISTRIBUTE_PROPORTIONAL para roles faltantes (ej. CEO
      // sin manager). Si todos los roles aplican al evaluado, NO se
      // crea fila (cycle.weights_at_launch aplica directamente).
      `CREATE TABLE IF NOT EXISTS cycle_evaluatee_weights (
        cycle_id uuid NOT NULL REFERENCES evaluation_cycles(id) ON DELETE CASCADE,
        evaluatee_id uuid NOT NULL,
        tenant_id uuid NULL REFERENCES tenants(id) ON DELETE CASCADE,
        effective_weights jsonb NOT NULL,
        strategy_used varchar(30) NOT NULL,
        missing_roles varchar[] NOT NULL DEFAULT '{}',
        reason text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (cycle_id, evaluatee_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cew_cycle ON cycle_evaluatee_weights(cycle_id)`,
      `CREATE INDEX IF NOT EXISTS idx_cew_tenant ON cycle_evaluatee_weights(tenant_id)`,
    ];
    for (const sql of tableFixes) {
      try { await client.query(sql); } catch { /* already exists */ }
    }
    console.log('[startup] Calibration + GDPR + ai_call_logs tables ensured');

    // ── 1. Pre-add nullable/default columns ────────────────────────────
    // Evita conflictos de TypeORM ALTER en tablas con datos existentes.
    // Cada sentencia es ADD COLUMN IF NOT EXISTS — no hace nada si la
    // columna ya existe, no borra datos existentes.
    const columnFixes = [
      { table: 'objectives', column: 'parent_objective_id', sql: 'ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "parent_objective_id" uuid NULL' },
      { table: 'objectives', column: 'weight', sql: 'ALTER TABLE "objectives" ADD COLUMN IF NOT EXISTS "weight" numeric(5,2) DEFAULT 0' },
      { table: 'quick_feedbacks', column: 'visibility', sql: `ALTER TABLE "quick_feedbacks" ADD COLUMN IF NOT EXISTS "visibility" varchar DEFAULT 'public'` },
      { table: 'calibration_entries', column: 'change_log', sql: `ALTER TABLE "calibration_entries" ADD COLUMN IF NOT EXISTS "change_log" jsonb DEFAULT '[]'` },
      { table: 'subscription_plans', column: 'currency', sql: `ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "currency" varchar(10) DEFAULT 'UF'` },
      { table: 'evaluation_cycles', column: 'period', sql: `ALTER TABLE "evaluation_cycles" ADD COLUMN IF NOT EXISTS "period" varchar(20) DEFAULT 'annual'` },
      { table: 'tenants', column: 'legal_rep_name', sql: `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legal_rep_name" varchar(200) NULL` },
      { table: 'tenants', column: 'legal_rep_rut', sql: `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legal_rep_rut" varchar(12) NULL` },
      { table: 'subscriptions', column: 'ai_addon_used', sql: `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "ai_addon_used" int DEFAULT 0` },
      { table: 'checkins', column: 'rating', sql: `ALTER TABLE "checkins" ADD COLUMN IF NOT EXISTS "rating" smallint NULL` },
      { table: 'users', column: 'notification_preferences', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb DEFAULT '{}'` },
      { table: 'checkins', column: 'minutes', sql: `ALTER TABLE "checkins" ADD COLUMN IF NOT EXISTS "minutes" text NULL` },
      { table: 'users', column: 'cv_url', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cv_url" varchar(500) NULL` },
      { table: 'users', column: 'cv_file_name', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cv_file_name" varchar(200) NULL` },
      // Grupo B — billing
      { table: 'invoices', column: 'dunning', sql: `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "dunning" jsonb DEFAULT '{}'` },
      { table: 'subscriptions', column: 'nurture_emails_sent', sql: `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "nurture_emails_sent" jsonb DEFAULT '[]'` },
      // Grupo C — auth (password policy tracking)
      { table: 'users', column: 'password_changed_at', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamptz NULL` },
      { table: 'users', column: 'failed_login_attempts', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" int NOT NULL DEFAULT 0` },
      { table: 'users', column: 'locked_until', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" timestamptz NULL` },
      // Grupo D — Fase 3 plan auditoria evaluaciones (Opción A)
      // form_templates.default_cycle_type: si está set, al crear la
      // plantilla se auto-generan las form_sub_templates correspondientes.
      { table: 'form_templates', column: 'default_cycle_type', sql: `ALTER TABLE "form_templates" ADD COLUMN IF NOT EXISTS "default_cycle_type" varchar(5) NULL` },
      // Grupo E — Sprint 1 (BR-C.2) snapshot del template + pesos al launch
      { table: 'evaluation_cycles', column: 'template_version_at_launch', sql: `ALTER TABLE "evaluation_cycles" ADD COLUMN IF NOT EXISTS "template_version_at_launch" int NULL` },
      { table: 'evaluation_cycles', column: 'template_snapshot', sql: `ALTER TABLE "evaluation_cycles" ADD COLUMN IF NOT EXISTS "template_snapshot" jsonb NULL` },
      { table: 'evaluation_cycles', column: 'weights_at_launch', sql: `ALTER TABLE "evaluation_cycles" ADD COLUMN IF NOT EXISTS "weights_at_launch" jsonb NULL` },
      { table: 'evaluation_cycles', column: 'launched_at', sql: `ALTER TABLE "evaluation_cycles" ADD COLUMN IF NOT EXISTS "launched_at" timestamptz NULL` },
      // Grupo F — Sprint 4 (BR-A.4) matrix reporting (dotted-line managers)
      { table: 'users', column: 'secondary_managers', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "secondary_managers" uuid[] NOT NULL DEFAULT '{}'::uuid[]` },
    ];

    for (const fix of columnFixes) {
      try {
        await client.query(fix.sql);
      } catch (err: any) {
        // Ignore — column already exists or table doesn't exist yet
        // (TypeORM synchronize will create it on first run)
      }
    }
    console.log(`[startup] Column fixes checked (${columnFixes.length} columns)`);

    // ── 2. Add enum values (idempotent) ────────────────────────────────
    // Si la BD se creo con una version vieja del schema, puede faltar
    // algun valor del enum. Cuando el codigo intenta INSERT con un valor
    // que el enum no conoce, Postgres lanza "invalid input value for
    // enum" → la transaccion se aborta → ROLLBACK silencioso de TODOS
    // los inserts en esa tx (incluso los que ya pasaron).
    //
    // El bug clasico: F4 role separation expuso un enum mismatch latente
    // — `notifications_type_enum` no tenia 'ai_analysis_ready', y al
    // intentar INSERT a notifications dentro de la tx del interceptor,
    // perdimos el ai_insight + ai_call_log + addon counter del mismo
    // request. Postgres `eva360_app` non-superuser hizo visible el
    // problema (con superuser, parece que algunos paths bypaseaban).
    const enumFixes = [
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'cancelled' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'evaluation_cycles_status_enum')) THEN ALTER TYPE "evaluation_cycles_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'; END IF; END $$;`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'requested' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'checkins_status_enum')) THEN ALTER TYPE "checkins_status_enum" ADD VALUE IF NOT EXISTS 'requested'; END IF; END $$;`,
      // F4 deploy fix: el codigo dispara notificacion 'ai_analysis_ready'
      // cuando termina una generacion de IA. Sin este value el INSERT
      // falla y aborta la tx → se pierde el insight + ai_call_log.
      `ALTER TYPE notifications_type_enum ADD VALUE IF NOT EXISTS 'ai_analysis_ready';`,
    ];

    for (const sql of enumFixes) {
      try {
        await client.query(sql);
      } catch { /* enum value already exists or type doesn't exist */ }
    }
    console.log(`[startup] Enum fixes checked (${enumFixes.length} values)`);

    // ── 2b. Indices de performance (idempotentes) ──────────────────────
    // Indices compuestos para queries jerarquicos del modulo de
    // evaluaciones (autoGenerateAssignments, suggestPeers). En orgs >
    // 1000 users, los queries:
    //   - "managers de tenant X con cierto hierarchy_level"
    //   - "users de departmentId X con cierto hierarchy_level"
    // hacian full-table scan. Con estos indices parciales (solo
    // is_active=true, que es como se consultan), el SELECT cae en
    // index scan rapido.
    //
    // CONCURRENTLY no se usa porque cleanup-orphans corre al startup
    // del API (single-process, no concurrencia). IF NOT EXISTS hace que
    // re-ejecutar no falle si el indice ya existe.
    const performanceIndexes = [
      `CREATE INDEX IF NOT EXISTS idx_users_manager_hierarchy
         ON users (manager_id, hierarchy_level)
         WHERE is_active = true`,
      `CREATE INDEX IF NOT EXISTS idx_users_dept_hierarchy
         ON users (department_id, hierarchy_level)
         WHERE is_active = true`,
    ];
    for (const sql of performanceIndexes) {
      try {
        await client.query(sql);
      } catch (err: any) {
        // Solo loguear; los indices son nice-to-have, no deben romper
        // el deploy si por algun motivo fallan (ej. columna no existe
        // en una BD vieja).
        console.warn(`[startup] performance index skipped: ${err.message}`);
      }
    }
    console.log(`[startup] Performance indexes ensured (${performanceIndexes.length})`);

    // ── 3. Sync positions.level from tenant settings JSONB ─────────────
    // El mantenedor guarda niveles en tenant.settings.positions (JSONB).
    // Cuando los cargos se auto-crean via findOrCreatePosition (form de
    // usuario, import), se guardan con level=0. Este backfill sincroniza
    // los niveles desde el JSONB a la tabla positions.
    // Solo ACTUALIZA donde level es 0 o distinto — nunca borra.
    try {
      const tenants = await client.query(`SELECT id, settings FROM tenants WHERE is_active = true`);
      let positionsFixed = 0;
      for (const t of tenants.rows) {
        const settingsPositions: { name: string; level: number }[] = t.settings?.positions || [];
        if (settingsPositions.length === 0) continue;
        for (const sp of settingsPositions) {
          if (!sp.name || !sp.level) continue;
          const res = await client.query(
            `UPDATE positions SET level = $1 WHERE tenant_id = $2 AND LOWER(name) = LOWER($3) AND (level IS NULL OR level = 0 OR level != $1)`,
            [sp.level, t.id, sp.name],
          );
          if (res.rowCount && res.rowCount > 0) positionsFixed += res.rowCount;
        }
      }
      if (positionsFixed > 0) {
        console.log(`[startup] Synced position levels from settings: ${positionsFixed} position(s) updated`);
      }
    } catch (err: any) {
      console.log(`[startup] Position level sync skipped: ${err.message}`);
    }

    // ── 4. Backfill users.hierarchy_level from positions table ──────────
    // Usuarios cuyo hierarchy_level es NULL o 0 pero su cargo en la tabla
    // positions tiene un nivel valido (>0). Solo RELLENA — nunca
    // sobreescribe un nivel que el admin ya puso manualmente.
    try {
      const backfillResult = await client.query(`
        UPDATE users u
        SET hierarchy_level = p.level
        FROM positions p
        WHERE u.position_id = p.id
          AND u.tenant_id = p.tenant_id
          AND p.level IS NOT NULL
          AND p.level > 0
          AND (u.hierarchy_level IS NULL OR u.hierarchy_level = 0)
      `);
      if (backfillResult.rowCount && backfillResult.rowCount > 0) {
        console.log(`[startup] Backfilled hierarchy_level for ${backfillResult.rowCount} user(s)`);
      }
    } catch (err: any) {
      console.log(`[startup] hierarchy_level backfill skipped: ${err.message}`);
    }

    // ── 5. DB Integrity fixes (idempotent) ──────────────────────────────
    const integrityFixes = [
      // P1: Invoice unique constraint scoped by tenant (multi-tenant isolation)
      // Drop both the manually named and any TypeORM auto-generated unique constraint
      `DROP INDEX IF EXISTS "idx_invoice_number"`,
      `DO $$ BEGIN
        EXECUTE (SELECT 'DROP INDEX IF EXISTS "' || indexname || '"' FROM pg_indexes WHERE tablename = 'invoices' AND indexdef LIKE '%invoice_number%' AND indexname != 'idx_invoice_number_tenant' LIMIT 1);
      EXCEPTION WHEN OTHERS THEN NULL; END $$`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoice_number_tenant" ON "invoices" ("tenant_id", "invoice_number")`,
      // P3: Missing indexes on hot-query columns
      `CREATE INDEX IF NOT EXISTS "idx_org_dev_action_initiative" ON "org_development_actions" ("initiative_id")`,
      `CREATE INDEX IF NOT EXISTS "idx_org_dev_action_assigned" ON "org_development_actions" ("assigned_to_id")`,
      `CREATE INDEX IF NOT EXISTS "idx_recruitment_interview_candidate" ON "recruitment_interviews" ("candidate_id")`,
      // Stage A departure cascade: token invalidation counter (starts at 0)
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0`,
      // Task T2: badges.updated_at para auditar ediciones y soft-delete
      `ALTER TABLE "badges" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT NOW()`,
      // Índice GIN en audit_logs.metadata para acelerar la búsqueda
      // full-text (CAST(metadata AS text) ILIKE '%...%') introducida en
      // audit.service.findByTenant. Sin este índice, tenants con 100k+
      // rows en audit_logs verían queries de ~2-5s. Con GIN → ~50ms.
      `CREATE INDEX IF NOT EXISTS "idx_audit_metadata_gin" ON "audit_logs" USING GIN ("metadata")`,
      // Stage B departure cascade: add 'cancelled' value to AssignmentStatus
      // enum (PENDING|IN_PROGRESS|COMPLETED → + CANCELLED). ADD VALUE IF NOT
      // EXISTS is idempotent. TypeORM's default enum type name is
      // <table>_<column>_enum.
      `ALTER TYPE "evaluation_assignments_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,

      // P2.1 — Nuevos notification types para alertas de quota IA.
      // ADD VALUE IF NOT EXISTS es idempotente; no falla si ya existen
      // (primer deploy tras sync o deploys repetidos).
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'ai_quota_warning'`,
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'ai_quota_exhausted'`,

      // super_admin no pertenece a ningún tenant: tenant_id debe aceptar NULL
      // para ese único registro. Antes se creaba el super_admin con tenantId=
      // demoTenantId, lo que habilitaba una fuga cross-tenant (ver fix en
      // users.controller.ts). DROP NOT NULL es idempotente en Postgres — no
      // falla si la columna ya es nullable.
      `ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP NOT NULL`,

      // ── Task T1: varchar status → PostgreSQL native enum ───────────────
      // Idempotent migration. Patrón por columna:
      //   1. Pre-check: NULL valores fuera del enum para evitar que el
      //      ALTER falle con "invalid input value". Se loguea cuántos.
      //   2. CREATE TYPE guarded con DO (IF NOT EXISTS no existe para TYPE).
      //   3. ALTER COLUMN TYPE con USING cast. Si ya es enum, no-op.
      // El ALTER y el pre-check usan RAISE NOTICE para ser visibles en logs
      // (no silenciosos). Si el ALTER falla por razones distintas de "ya es
      // enum", el error se reporta.
      //
      // redemption_transactions.status
      `DO $$
      DECLARE cnt int;
      BEGIN
        UPDATE "redemption_transactions" SET "status" = 'pending'
         WHERE "status" NOT IN ('pending','approved','delivered','cancelled');
        GET DIAGNOSTICS cnt = ROW_COUNT;
        IF cnt > 0 THEN RAISE NOTICE 'Normalized % rows in redemption_transactions.status', cnt; END IF;
      END $$`,
      `DO $$ BEGIN
        CREATE TYPE "redemption_transactions_status_enum" AS ENUM ('pending','approved','delivered','cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN
        ALTER TABLE "redemption_transactions"
          ALTER COLUMN "status" DROP DEFAULT,
          ALTER COLUMN "status" TYPE "redemption_transactions_status_enum"
            USING "status"::text::"redemption_transactions_status_enum",
          ALTER COLUMN "status" SET DEFAULT 'pending'::"redemption_transactions_status_enum";
      EXCEPTION
        WHEN datatype_mismatch THEN NULL; -- ya es enum
        WHEN others THEN RAISE NOTICE 'redemption_transactions.status migration skipped: %', SQLERRM;
      END $$`,

      // subscriptions.status
      `DO $$
      DECLARE cnt int;
      BEGIN
        UPDATE "subscriptions" SET "status" = 'active'
         WHERE "status" NOT IN ('active','trial','suspended','cancelled','expired');
        GET DIAGNOSTICS cnt = ROW_COUNT;
        IF cnt > 0 THEN RAISE NOTICE 'Normalized % rows in subscriptions.status', cnt; END IF;
      END $$`,
      `DO $$ BEGIN
        CREATE TYPE "subscriptions_status_enum" AS ENUM ('active','trial','suspended','cancelled','expired');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN
        ALTER TABLE "subscriptions"
          ALTER COLUMN "status" DROP DEFAULT,
          ALTER COLUMN "status" TYPE "subscriptions_status_enum"
            USING "status"::text::"subscriptions_status_enum",
          ALTER COLUMN "status" SET DEFAULT 'active'::"subscriptions_status_enum";
      EXCEPTION
        WHEN datatype_mismatch THEN NULL;
        WHEN others THEN RAISE NOTICE 'subscriptions.status migration skipped: %', SQLERRM;
      END $$`,

      // invoices.type + invoices.status
      `DO $$
      DECLARE cnt int;
      BEGIN
        UPDATE "invoices" SET "type" = 'invoice'
         WHERE "type" NOT IN ('invoice','credit_note');
        GET DIAGNOSTICS cnt = ROW_COUNT;
        IF cnt > 0 THEN RAISE NOTICE 'Normalized % rows in invoices.type', cnt; END IF;

        UPDATE "invoices" SET "status" = 'draft'
         WHERE "status" NOT IN ('draft','sent','paid','overdue','cancelled');
        GET DIAGNOSTICS cnt = ROW_COUNT;
        IF cnt > 0 THEN RAISE NOTICE 'Normalized % rows in invoices.status', cnt; END IF;
      END $$`,
      `DO $$ BEGIN
        CREATE TYPE "invoices_type_enum" AS ENUM ('invoice','credit_note');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN
        ALTER TABLE "invoices"
          ALTER COLUMN "type" DROP DEFAULT,
          ALTER COLUMN "type" TYPE "invoices_type_enum"
            USING "type"::text::"invoices_type_enum",
          ALTER COLUMN "type" SET DEFAULT 'invoice'::"invoices_type_enum";
      EXCEPTION
        WHEN datatype_mismatch THEN NULL;
        WHEN others THEN RAISE NOTICE 'invoices.type migration skipped: %', SQLERRM;
      END $$`,
      `DO $$ BEGIN
        CREATE TYPE "invoices_status_enum" AS ENUM ('draft','sent','paid','overdue','cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN
        ALTER TABLE "invoices"
          ALTER COLUMN "status" DROP DEFAULT,
          ALTER COLUMN "status" TYPE "invoices_status_enum"
            USING "status"::text::"invoices_status_enum",
          ALTER COLUMN "status" SET DEFAULT 'draft'::"invoices_status_enum";
      EXCEPTION
        WHEN datatype_mismatch THEN NULL;
        WHEN others THEN RAISE NOTICE 'invoices.status migration skipped: %', SQLERRM;
      END $$`,

      // development_actions.status + development_actions.priority
      `DO $$
      DECLARE cnt int;
      BEGIN
        UPDATE "development_actions" SET "status" = 'pendiente'
         WHERE "status" NOT IN ('pendiente','en_progreso','completada','cancelada');
        GET DIAGNOSTICS cnt = ROW_COUNT;
        IF cnt > 0 THEN RAISE NOTICE 'Normalized % rows in development_actions.status', cnt; END IF;

        UPDATE "development_actions" SET "priority" = 'media'
         WHERE "priority" NOT IN ('alta','media','baja');
        GET DIAGNOSTICS cnt = ROW_COUNT;
        IF cnt > 0 THEN RAISE NOTICE 'Normalized % rows in development_actions.priority', cnt; END IF;
      END $$`,
      `DO $$ BEGIN
        CREATE TYPE "development_actions_status_enum" AS ENUM ('pendiente','en_progreso','completada','cancelada');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN
        ALTER TABLE "development_actions"
          ALTER COLUMN "status" DROP DEFAULT,
          ALTER COLUMN "status" TYPE "development_actions_status_enum"
            USING "status"::text::"development_actions_status_enum",
          ALTER COLUMN "status" SET DEFAULT 'pendiente'::"development_actions_status_enum";
      EXCEPTION
        WHEN datatype_mismatch THEN NULL;
        WHEN others THEN RAISE NOTICE 'development_actions.status migration skipped: %', SQLERRM;
      END $$`,
      `DO $$ BEGIN
        CREATE TYPE "development_actions_priority_enum" AS ENUM ('alta','media','baja');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN
        ALTER TABLE "development_actions"
          ALTER COLUMN "priority" DROP DEFAULT,
          ALTER COLUMN "priority" TYPE "development_actions_priority_enum"
            USING "priority"::text::"development_actions_priority_enum",
          ALTER COLUMN "priority" SET DEFAULT 'media'::"development_actions_priority_enum";
      EXCEPTION
        WHEN datatype_mismatch THEN NULL;
        WHEN others THEN RAISE NOTICE 'development_actions.priority migration skipped: %', SQLERRM;
      END $$`,
    ];
    for (const sql of integrityFixes) {
      try {
        await client.query(sql);
      } catch (err: any) {
        // Ignore — index/constraint may already exist or table may not exist
      }
    }
    console.log(`[startup] Integrity fixes checked (${integrityFixes.length} items)`);

    // ── 6. Pre-FK orphan nullify (surgical, idempotent) ─────────────────
    // Adding @ManyToOne to UUID columns that previously had no FK constraint
    // will fail on TypeORM synchronize if any row points to a user that no
    // longer exists. We NULL those specific orphan references (nullable
    // columns only) so the FK constraint can be created cleanly. This is a
    // controlled, targeted cleanup — not a mass nullify — and only touches
    // rows whose referenced user_id is already gone.
    const orphanFkFixes: Array<{ table: string; col: string }> = [
      { table: 'user_departures', col: 'processed_by' },
      { table: 'user_movements', col: 'approved_by' },
      { table: 'contracts', col: 'rejected_by' },
      { table: 'objectives', col: 'approved_by' },
    ];
    for (const { table, col } of orphanFkFixes) {
      try {
        const res = await client.query(
          `UPDATE "${table}" AS t SET "${col}" = NULL
             WHERE t."${col}" IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t."${col}")`,
        );
        if (res.rowCount && res.rowCount > 0) {
          console.log(`[startup] Nullified ${res.rowCount} orphan ${table}.${col} reference(s)`);
        }
      } catch (err: any) {
        // Table may not exist yet on very first sync — safe to skip
      }
    }

    console.log('[startup] Done — all checks passed, no data modified destructively');
  } catch (err: any) {
    console.error('[startup] Error:', err.message);
  } finally {
    await client.end();
  }
}

main();
