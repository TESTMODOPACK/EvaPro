/**
 * schema-sync.ts
 *
 * Standalone script that drops ALL known tables then re-creates them
 * via TypeORM synchronize. Run as `db:migrate:prod` or via start:prod
 * when you need a full schema reset (e.g., adding new phases).
 *
 * ⚠️  Destructive — all existing data is lost. Safe for demo environments.
 *     For production with real data, use TypeORM migrations instead.
 */

import 'reflect-metadata';
import { Client } from 'pg';
import { DataSource } from 'typeorm';

// ── Entities: Phase 1 ────────────────────────────────────────────────────
import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { User } from '../modules/users/entities/user.entity';
import { FormTemplate } from '../modules/templates/entities/form-template.entity';
import { EvaluationCycle } from '../modules/evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment } from '../modules/evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../modules/evaluations/entities/evaluation-response.entity';
import { BulkImport } from '../modules/users/entities/bulk-import.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { PeerAssignment } from '../modules/evaluations/entities/peer-assignment.entity';
import { CycleStage } from '../modules/evaluations/entities/cycle-stage.entity';

// ── Entities: Phase 2 ────────────────────────────────────────────────────
import { CheckIn } from '../modules/feedback/entities/checkin.entity';
import { QuickFeedback } from '../modules/feedback/entities/quick-feedback.entity';
import { Objective } from '../modules/objectives/entities/objective.entity';
import { ObjectiveUpdate } from '../modules/objectives/entities/objective-update.entity';
import { ObjectiveComment } from '../modules/objectives/entities/objective-comment.entity';
import { KeyResult } from '../modules/objectives/entities/key-result.entity';

// ── Entities: Phase 3 (User history & subscriptions) ────────────────────
import { UserNote } from '../modules/users/entities/user-note.entity';
import { SubscriptionPlan } from '../modules/subscriptions/entities/subscription-plan.entity';
import { Subscription } from '../modules/subscriptions/entities/subscription.entity';

// ── Entities: Phase 4 (Talent & Calibration) ────────────────────────────
import { TalentAssessment } from '../modules/talent/entities/talent-assessment.entity';
import { CalibrationSession } from '../modules/talent/entities/calibration-session.entity';
import { CalibrationEntry } from '../modules/talent/entities/calibration-entry.entity';

// ── Entities: Phase 5 (Development Plans) ───────────────────────────────
import { Competency } from '../modules/development/entities/competency.entity';
import { DevelopmentPlan } from '../modules/development/entities/development-plan.entity';
import { DevelopmentAction } from '../modules/development/entities/development-action.entity';
import { DevelopmentComment } from '../modules/development/entities/development-comment.entity';

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

async function runSchemaSync() {
  // ── Step 1: drop ALL tables with raw pg to avoid TypeORM ALTER conflicts ──
  const pgClient = new Client({
    connectionString: DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  });

  try {
    console.log('🗑️   Dropping all tables (raw SQL with CASCADE)…');
    await pgClient.connect();

    // Drop in reverse-FK order, CASCADE handles remaining deps
    await pgClient.query(`
      -- Phase 5
      DROP TABLE IF EXISTS development_comments CASCADE;
      DROP TABLE IF EXISTS development_actions CASCADE;
      DROP TABLE IF EXISTS development_plans CASCADE;
      DROP TABLE IF EXISTS competencies CASCADE;

      -- Phase 4
      DROP TABLE IF EXISTS calibration_entries CASCADE;
      DROP TABLE IF EXISTS calibration_sessions CASCADE;
      DROP TABLE IF EXISTS talent_assessments CASCADE;

      -- Phase 3
      DROP TABLE IF EXISTS subscriptions CASCADE;
      DROP TABLE IF EXISTS subscription_plans CASCADE;
      DROP TABLE IF EXISTS user_notes CASCADE;

      -- Phase 2
      DROP TABLE IF EXISTS objective_comments CASCADE;
      DROP TABLE IF EXISTS objective_updates CASCADE;
      DROP TABLE IF EXISTS objectives CASCADE;
      DROP TABLE IF EXISTS quick_feedbacks CASCADE;
      DROP TABLE IF EXISTS checkins CASCADE;

      -- Phase 1
      DROP TABLE IF EXISTS peer_assignments CASCADE;
      DROP TABLE IF EXISTS audit_logs CASCADE;
      DROP TABLE IF EXISTS bulk_imports CASCADE;
      DROP TABLE IF EXISTS evaluation_responses CASCADE;
      DROP TABLE IF EXISTS evaluation_assignments CASCADE;
      DROP TABLE IF EXISTS evaluation_cycles CASCADE;
      DROP TABLE IF EXISTS form_templates CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS tenants CASCADE;

      -- Legacy orphaned tables
      DROP TABLE IF EXISTS calibration_adjustments CASCADE;
      DROP TABLE IF EXISTS calibration_participants CASCADE;
      DROP TABLE IF EXISTS evaluations CASCADE;

      -- Enum types
      DROP TYPE IF EXISTS evaluation_assignments_relation_type_enum CASCADE;
      DROP TYPE IF EXISTS evaluation_assignments_status_enum CASCADE;
      DROP TYPE IF EXISTS evaluation_cycles_type_enum CASCADE;
      DROP TYPE IF EXISTS evaluation_cycles_status_enum CASCADE;
      DROP TYPE IF EXISTS bulk_imports_status_enum CASCADE;
      DROP TYPE IF EXISTS checkins_status_enum CASCADE;
      DROP TYPE IF EXISTS quick_feedbacks_sentiment_enum CASCADE;
      DROP TYPE IF EXISTS objectives_type_enum CASCADE;
      DROP TYPE IF EXISTS objectives_status_enum CASCADE;
    `);
    console.log('✅  All tables dropped.');
  } catch (err) {
    console.error('❌  Failed to drop tables:', err);
    process.exit(1);
  } finally {
    await pgClient.end();
  }

  // ── Step 2: recreate ALL tables via TypeORM synchronize ──────────────────
  const dataSource = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
    entities: [
      // Phase 1
      Tenant, User, FormTemplate,
      EvaluationCycle, EvaluationAssignment, EvaluationResponse,
      BulkImport, AuditLog, PeerAssignment, CycleStage,
      // Phase 2
      CheckIn, QuickFeedback,
      Objective, ObjectiveUpdate, ObjectiveComment, KeyResult,
      // Phase 3
      UserNote, SubscriptionPlan, Subscription,
      // Phase 4
      TalentAssessment, CalibrationSession, CalibrationEntry,
      // Phase 5
      Competency, DevelopmentPlan, DevelopmentAction, DevelopmentComment,
    ],
    synchronize: true,
    logging: false,
  });

  try {
    console.log('🔄  Running TypeORM schema synchronization…');
    await dataSource.initialize();
    console.log('✅  Schema synchronization complete — all tables created.');
  } catch (err) {
    console.error('❌  Schema sync failed:', err);
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

void runSchemaSync();
