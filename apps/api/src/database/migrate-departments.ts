/**
 * migrate-departments.ts
 *
 * One-time migration script: populates `departments` and `positions` tables
 * from tenant.settings (JSONB), then backfills user.department_id and
 * user.position_id by matching text values.
 *
 * Safe to run multiple times (idempotent).
 * Run via: npx ts-node -r tsconfig-paths/register src/database/migrate-departments.ts
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { Department } from '../modules/tenants/entities/department.entity';
import { Position } from '../modules/tenants/entities/position.entity';
import { User } from '../modules/users/entities/user.entity';

// Minimal entity list — only what we need
import { FormTemplate } from '../modules/templates/entities/form-template.entity';
import { EvaluationCycle } from '../modules/evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment } from '../modules/evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../modules/evaluations/entities/evaluation-response.entity';
import { BulkImport } from '../modules/users/entities/bulk-import.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { PeerAssignment } from '../modules/evaluations/entities/peer-assignment.entity';
import { CycleStage } from '../modules/evaluations/entities/cycle-stage.entity';
import { CheckIn } from '../modules/feedback/entities/checkin.entity';
import { QuickFeedback } from '../modules/feedback/entities/quick-feedback.entity';
import { MeetingLocation } from '../modules/feedback/entities/meeting-location.entity';
import { Objective } from '../modules/objectives/entities/objective.entity';
import { ObjectiveUpdate } from '../modules/objectives/entities/objective-update.entity';
import { ObjectiveComment } from '../modules/objectives/entities/objective-comment.entity';
import { KeyResult } from '../modules/objectives/entities/key-result.entity';
import { UserNote } from '../modules/users/entities/user-note.entity';
import { SubscriptionPlan } from '../modules/subscriptions/entities/subscription-plan.entity';
import { Subscription } from '../modules/subscriptions/entities/subscription.entity';
import { TalentAssessment } from '../modules/talent/entities/talent-assessment.entity';
import { CalibrationSession } from '../modules/talent/entities/calibration-session.entity';
import { CalibrationEntry } from '../modules/talent/entities/calibration-entry.entity';
import { Competency } from '../modules/development/entities/competency.entity';
import { DevelopmentPlan } from '../modules/development/entities/development-plan.entity';
import { DevelopmentAction } from '../modules/development/entities/development-action.entity';
import { DevelopmentComment } from '../modules/development/entities/development-comment.entity';
import { Notification } from '../modules/notifications/entities/notification.entity';
import { AiInsight } from '../modules/ai-insights/entities/ai-insight.entity';
import { OrgDevelopmentPlan } from '../modules/org-development/entities/org-development-plan.entity';
import { OrgDevelopmentInitiative } from '../modules/org-development/entities/org-development-initiative.entity';
import { OrgDevelopmentAction } from '../modules/org-development/entities/org-development-action.entity';
import { UserDeparture } from '../modules/users/entities/user-departure.entity';
import { UserMovement } from '../modules/users/entities/user-movement.entity';
import { SupportTicket } from '../modules/tenants/entities/support-ticket.entity';

const DATABASE_URL = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

const DEFAULT_DEPARTMENTS = [
  'Tecnología', 'Recursos Humanos', 'Ventas', 'Marketing',
  'Operaciones', 'Finanzas', 'Legal', 'Administración',
];

const DEFAULT_POSITIONS = [
  { name: 'Gerente General', level: 1 },
  { name: 'Gerente de Área', level: 2 },
  { name: 'Subgerente', level: 3 },
  { name: 'Jefe de Área', level: 4 },
  { name: 'Coordinador', level: 5 },
  { name: 'Analista', level: 6 },
  { name: 'Asistente', level: 7 },
];

async function migrate() {
  const ds = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    ssl: isProduction && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
    entities: [
      Tenant, Department, Position, User, FormTemplate,
      EvaluationCycle, EvaluationAssignment, EvaluationResponse,
      BulkImport, AuditLog, PeerAssignment, CycleStage,
      CheckIn, QuickFeedback, MeetingLocation,
      Objective, ObjectiveUpdate, ObjectiveComment, KeyResult,
      UserNote, UserDeparture, UserMovement, SubscriptionPlan, Subscription,
      TalentAssessment, CalibrationSession, CalibrationEntry,
      Competency, DevelopmentPlan, DevelopmentAction, DevelopmentComment,
      Notification, AiInsight, SupportTicket,
      OrgDevelopmentPlan, OrgDevelopmentInitiative, OrgDevelopmentAction,
    ],
    synchronize: false,
    logging: false,
  });

  await ds.initialize();
  console.log('Connected to database.');

  const tenantRepo = ds.getRepository(Tenant);
  const deptRepo = ds.getRepository(Department);
  const posRepo = ds.getRepository(Position);
  const userRepo = ds.getRepository(User);

  const tenants = await tenantRepo.find();
  console.log(`Found ${tenants.length} tenants.`);

  let totalDepts = 0;
  let totalPos = 0;
  let totalUsersUpdated = 0;

  for (const tenant of tenants) {
    console.log(`\nTenant: ${tenant.name} (${tenant.id})`);

    // ── Pass 1: Populate departments table ──
    const deptNames: string[] = Array.isArray(tenant.settings?.departments) && tenant.settings.departments.length > 0
      ? tenant.settings.departments
      : DEFAULT_DEPARTMENTS;

    let deptCreated = 0;
    for (let i = 0; i < deptNames.length; i++) {
      const name = deptNames[i]?.trim();
      if (!name) continue;

      const existing = await deptRepo
        .createQueryBuilder('d')
        .where('d.tenant_id = :tenantId', { tenantId: tenant.id })
        .andWhere('LOWER(d.name) = LOWER(:name)', { name })
        .getOne();
      if (existing) continue;

      await deptRepo.save(deptRepo.create({
        tenantId: tenant.id,
        name,
        sortOrder: i,
        isActive: true,
      }));
      deptCreated++;
    }
    totalDepts += deptCreated;
    console.log(`  Departments created: ${deptCreated}`);

    // Also create records for departments used by users but NOT in settings
    const userDepts = await userRepo
      .createQueryBuilder('u')
      .select('DISTINCT u.department', 'department')
      .where('u.tenant_id = :tenantId', { tenantId: tenant.id })
      .andWhere('u.department IS NOT NULL')
      .andWhere("u.department != ''")
      .getRawMany();

    for (const row of userDepts) {
      const name = row.department?.trim();
      if (!name) continue;
      const existing = await deptRepo
        .createQueryBuilder('d')
        .where('d.tenant_id = :tenantId', { tenantId: tenant.id })
        .andWhere('LOWER(d.name) = LOWER(:name)', { name })
        .getOne();
      if (existing) continue;
      await deptRepo.save(deptRepo.create({
        tenantId: tenant.id,
        name,
        sortOrder: 99,
        isActive: true,
      }));
      deptCreated++;
      totalDepts++;
    }

    // ── Pass 2: Populate positions table ──
    const posItems: { name: string; level: number }[] = Array.isArray(tenant.settings?.positions) && tenant.settings.positions.length > 0
      ? tenant.settings.positions
      : DEFAULT_POSITIONS;

    let posCreated = 0;
    for (const p of posItems) {
      const name = p.name?.trim();
      if (!name) continue;

      const existing = await posRepo
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId: tenant.id })
        .andWhere('LOWER(p.name) = LOWER(:name)', { name })
        .getOne();
      if (existing) continue;

      await posRepo.save(posRepo.create({
        tenantId: tenant.id,
        name,
        level: p.level || 0,
        isActive: true,
      }));
      posCreated++;
    }
    totalPos += posCreated;
    console.log(`  Positions created: ${posCreated}`);

    // Also create records for positions used by users but NOT in settings
    const userPositions = await userRepo
      .createQueryBuilder('u')
      .select('DISTINCT u.position', 'position')
      .where('u.tenant_id = :tenantId', { tenantId: tenant.id })
      .andWhere('u.position IS NOT NULL')
      .andWhere("u.position != ''")
      .getRawMany();

    for (const row of userPositions) {
      const name = row.position?.trim();
      if (!name) continue;
      const existing = await posRepo
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId: tenant.id })
        .andWhere('LOWER(p.name) = LOWER(:name)', { name })
        .getOne();
      if (existing) continue;
      await posRepo.save(posRepo.create({
        tenantId: tenant.id,
        name,
        level: 0,
        isActive: true,
      }));
      posCreated++;
      totalPos++;
    }

    // ── Pass 3: Backfill user.department_id and user.position_id ──
    const allDepts = await deptRepo.find({ where: { tenantId: tenant.id } });
    const deptMap = new Map<string, string>(); // lowercase name → id
    for (const d of allDepts) deptMap.set(d.name.toLowerCase().trim(), d.id);

    const allPos = await posRepo.find({ where: { tenantId: tenant.id } });
    const posMap = new Map<string, string>(); // lowercase name → id
    for (const p of allPos) posMap.set(p.name.toLowerCase().trim(), p.id);

    const usersToUpdate = await userRepo.find({
      where: { tenantId: tenant.id },
      select: ['id', 'department', 'departmentId', 'position', 'positionId'],
    });

    let updated = 0;
    for (const u of usersToUpdate) {
      const changes: any = {};

      // Department
      if (!u.departmentId && u.department) {
        const deptId = deptMap.get(u.department.toLowerCase().trim());
        if (deptId) changes.departmentId = deptId;
      }

      // Position
      if (!u.positionId && u.position) {
        const posId = posMap.get(u.position.toLowerCase().trim());
        if (posId) changes.positionId = posId;
      }

      if (Object.keys(changes).length > 0) {
        await userRepo.update(u.id, changes);
        updated++;
      }
    }
    totalUsersUpdated += updated;
    console.log(`  Users backfilled: ${updated}/${usersToUpdate.length}`);
  }

  // ── Pass 4: Backfill FK in operational entities ──
  console.log('\n--- Backfilling operational entities ---');

  // recruitment_processes.department_id + position_id
  try {
    const rpDept = await ds.query(`
      UPDATE recruitment_processes rp SET department_id = d.id
      FROM departments d WHERE rp.tenant_id = d.tenant_id
        AND LOWER(TRIM(rp.department)) = LOWER(TRIM(d.name))
        AND rp.department_id IS NULL AND rp.department IS NOT NULL
    `);
    const rpPos = await ds.query(`
      UPDATE recruitment_processes rp SET position_id = p.id
      FROM positions p WHERE rp.tenant_id = p.tenant_id
        AND LOWER(TRIM(rp.position)) = LOWER(TRIM(p.name))
        AND rp.position_id IS NULL AND rp.position IS NOT NULL
    `);
    console.log(`  recruitment_processes: ${rpDept[1] || 0} dept + ${rpPos[1] || 0} pos backfilled`);
  } catch (e) { console.log('  recruitment_processes: skipped (table may not exist)'); }

  // calibration_sessions.department_id
  try {
    const csDept = await ds.query(`
      UPDATE calibration_sessions cs SET department_id = d.id
      FROM departments d WHERE cs.tenant_id = d.tenant_id
        AND LOWER(TRIM(cs.department)) = LOWER(TRIM(d.name))
        AND cs.department_id IS NULL AND cs.department IS NOT NULL
    `);
    console.log(`  calibration_sessions: ${csDept[1] || 0} dept backfilled`);
  } catch (e) { console.log('  calibration_sessions: skipped (table may not exist)'); }

  // role_competencies.position_id
  try {
    const rcPos = await ds.query(`
      UPDATE role_competencies rc SET position_id = p.id
      FROM positions p WHERE rc.tenant_id = p.tenant_id
        AND LOWER(TRIM(rc.position)) = LOWER(TRIM(p.name))
        AND rc.position_id IS NULL AND rc.position IS NOT NULL
    `);
    console.log(`  role_competencies: ${rcPos[1] || 0} pos backfilled`);
  } catch (e) { console.log('  role_competencies: skipped (table may not exist)'); }

  // org_development_initiatives.department_id
  try {
    const odiDept = await ds.query(`
      UPDATE org_development_initiatives odi SET department_id = d.id
      FROM departments d WHERE odi.tenant_id = d.tenant_id
        AND LOWER(TRIM(odi.department)) = LOWER(TRIM(d.name))
        AND odi.department_id IS NULL AND odi.department IS NOT NULL
    `);
    console.log(`  org_development_initiatives: ${odiDept[1] || 0} dept backfilled`);
  } catch (e) { console.log('  org_development_initiatives: skipped (table may not exist)'); }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Departments created: ${totalDepts}`);
  console.log(`Positions created: ${totalPos}`);
  console.log(`Users updated: ${totalUsersUpdated}`);

  await ds.destroy();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
