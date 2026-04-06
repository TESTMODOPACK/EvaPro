/**
 * seed-demo-full.ts — Creates a COMPLETE demo dataset for client presentations.
 * Adds to existing seed data: more users, 180°/360° cycles, OKRs, feedback,
 * check-ins, development plans, talent assessments, and calibration.
 *
 * Run via: pnpm --filter @repo/api run db:seed-full
 * IDEMPOTENT: checks existence before creating. Safe to run multiple times.
 */

import 'reflect-metadata';
import { DataSource, In } from 'typeorm';
import * as bcrypt from 'bcrypt';

// ── All entities ────────────────────────────────────────────────────────────
import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { User } from '../modules/users/entities/user.entity';
import { FormTemplate } from '../modules/templates/entities/form-template.entity';
import { EvaluationCycle, CycleStatus, CycleType, CyclePeriod } from '../modules/evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment, AssignmentStatus, RelationType } from '../modules/evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../modules/evaluations/entities/evaluation-response.entity';
import { CycleStage, StageType, StageStatus } from '../modules/evaluations/entities/cycle-stage.entity';
import { PeerAssignment } from '../modules/evaluations/entities/peer-assignment.entity';
import { BulkImport } from '../modules/users/entities/bulk-import.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';

import { CheckIn } from '../modules/feedback/entities/checkin.entity';
import { QuickFeedback } from '../modules/feedback/entities/quick-feedback.entity';
import { MeetingLocation } from '../modules/feedback/entities/meeting-location.entity';

import { Objective } from '../modules/objectives/entities/objective.entity';
import { ObjectiveUpdate } from '../modules/objectives/entities/objective-update.entity';
import { ObjectiveComment } from '../modules/objectives/entities/objective-comment.entity';
import { KeyResult, KRStatus } from '../modules/objectives/entities/key-result.entity';

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

import { Notification, NotificationType } from '../modules/notifications/entities/notification.entity';
import { EngagementSurvey } from '../modules/surveys/entities/engagement-survey.entity';
import { SurveyQuestion } from '../modules/surveys/entities/survey-question.entity';
import { SurveyResponse } from '../modules/surveys/entities/survey-response.entity';
import { SurveyAssignment } from '../modules/surveys/entities/survey-assignment.entity';
import { AiInsight } from '../modules/ai-insights/entities/ai-insight.entity';
import { RoleCompetency } from '../modules/development/entities/role-competency.entity';
import { PaymentHistory, BillingPeriod, PaymentStatus } from '../modules/subscriptions/entities/payment-history.entity';
import { SystemChangelog, ChangelogType } from '../modules/system/entities/system-changelog.entity';
import { Recognition } from '../modules/recognition/entities/recognition.entity';
import { Badge } from '../modules/recognition/entities/badge.entity';
import { UserBadge } from '../modules/recognition/entities/user-badge.entity';
import { UserPoints, PointsSource } from '../modules/recognition/entities/user-points.entity';

// ── PDO: Org Development ─────────────────────────────────────────────────
import { OrgDevelopmentPlan } from '../modules/org-development/entities/org-development-plan.entity';
import { OrgDevelopmentInitiative } from '../modules/org-development/entities/org-development-initiative.entity';
import { OrgDevelopmentAction } from '../modules/org-development/entities/org-development-action.entity';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1); }

const ds = new DataSource({
  type: 'postgres', url: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  entities: [
    Tenant, User, FormTemplate, EvaluationCycle, EvaluationAssignment, EvaluationResponse,
    BulkImport, AuditLog, PeerAssignment, CycleStage,
    CheckIn, QuickFeedback, MeetingLocation,
    Objective, ObjectiveUpdate, ObjectiveComment, KeyResult,
    UserNote, SubscriptionPlan, Subscription,
    TalentAssessment, CalibrationSession, CalibrationEntry,
    Competency, RoleCompetency, DevelopmentPlan, DevelopmentAction, DevelopmentComment,
    Notification, AiInsight,
    Recognition, Badge, UserBadge, UserPoints,
    PaymentHistory,
    SystemChangelog,
    // PDO: Org Development
    OrgDevelopmentPlan, OrgDevelopmentInitiative, OrgDevelopmentAction,
    // Surveys
    EngagementSurvey, SurveyQuestion, SurveyResponse, SurveyAssignment,
  ],
  synchronize: true, logging: false,
});

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function calcScore(answers: Record<string, any>): number {
  const vals = Object.values(answers).filter((v) => typeof v === 'number' && !isNaN(v)) as number[];
  if (vals.length === 0) return 0;
  return Math.round(((vals.reduce((s, v) => s + v, 0) / vals.length / 5) * 10) * 100) / 100;
}

function daysAgo(n: number): Date { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysFromNow(n: number): Date { const d = new Date(); d.setDate(d.getDate() + n); return d; }

function randomScore(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

function randomAnswers(low: number, high: number, questionIds: string[]): Record<string, any> {
  const ans: Record<string, any> = {};
  for (const qId of questionIds) {
    if (qId.startsWith('q5') || qId.startsWith('q6') || qId.includes('text')) continue;
    ans[qId] = Math.floor(low + Math.random() * (high - low + 1));
  }
  return ans;
}

async function seedDemoFull() {
  try {
    console.log('🌱 Connecting to database for full demo seed...');
    await ds.initialize();

    const tenantRepo = ds.getRepository(Tenant);
    const userRepo = ds.getRepository(User);
    const templateRepo = ds.getRepository(FormTemplate);
    const cycleRepo = ds.getRepository(EvaluationCycle);
    const assignRepo = ds.getRepository(EvaluationAssignment);
    const respRepo = ds.getRepository(EvaluationResponse);
    const stageRepo = ds.getRepository(CycleStage);
    const objRepo = ds.getRepository(Objective);
    const krRepo = ds.getRepository(KeyResult);
    const objUpdateRepo = ds.getRepository(ObjectiveUpdate);
    const objCommentRepo = ds.getRepository(ObjectiveComment);
    const feedbackRepo = ds.getRepository(QuickFeedback);
    const checkInRepo = ds.getRepository(CheckIn);
    const devPlanRepo = ds.getRepository(DevelopmentPlan);
    const devActionRepo = ds.getRepository(DevelopmentAction);
    const devCommentRepo = ds.getRepository(DevelopmentComment);
    const talentRepo = ds.getRepository(TalentAssessment);
    const calSessionRepo = ds.getRepository(CalibrationSession);
    const calEntryRepo = ds.getRepository(CalibrationEntry);
    const compRepo = ds.getRepository(Competency);

    /* ── 1. Get existing tenant & users ──────────────────────────────────── */
    const tenant = await tenantRepo.findOne({ where: { slug: 'demo' } });
    if (!tenant) { console.error('❌ Demo tenant not found. Run db:seed first.'); return; }
    const tid = tenant.id;
    console.log(`✅ Tenant found: ${tenant.name} (${tid})`);

    const admin = await userRepo.findOne({ where: { email: 'admin@evapro.demo', tenantId: tid } });
    const manager = await userRepo.findOne({ where: { email: 'carlos.lopez@evapro.demo', tenantId: tid } });
    if (!admin || !manager) { console.error('❌ Admin or Manager not found.'); return; }

    /* ── 2. Create additional employees ──────────────────────────────────── */
    const newEmployees = [
      // Tecnologia (10)
      { email: 'pedro.silva@evapro.demo', firstName: 'Pedro', lastName: 'Silva', department: 'Tecnología', position: 'Desarrollador Frontend' },
      { email: 'felipe.vargas@evapro.demo', firstName: 'Felipe', lastName: 'Vargas', department: 'Tecnología', position: 'Ingeniero de Infraestructura' },
      { email: 'gabriel.nunez@evapro.demo', firstName: 'Gabriel', lastName: 'Nunez', department: 'Tecnología', position: 'Desarrollador Backend' },
      { email: 'natalia.pena@evapro.demo', firstName: 'Natalia', lastName: 'Pena', department: 'Tecnología', position: 'Analista de Datos' },
      { email: 'tomas.reyes@evapro.demo', firstName: 'Tomas', lastName: 'Reyes', department: 'Tecnología', position: 'Ingeniero QA' },
      { email: 'daniela.fuentes@evapro.demo', firstName: 'Daniela', lastName: 'Fuentes', department: 'Tecnología', position: 'Scrum Master' },
      { email: 'matias.soto@evapro.demo', firstName: 'Matias', lastName: 'Soto', department: 'Tecnología', position: 'Arquitecto de Software' },
      { email: 'paula.vera@evapro.demo', firstName: 'Paula', lastName: 'Vera', department: 'Tecnología', position: 'Desarrolladora Mobile' },
      { email: 'nicolas.bravo@evapro.demo', firstName: 'Nicolas', lastName: 'Bravo', department: 'Tecnología', position: 'DevOps Engineer' },
      { email: 'catalina.mora@evapro.demo', firstName: 'Catalina', lastName: 'Mora', department: 'Tecnología', position: 'Product Owner' },
      // Ventas (7)
      { email: 'maria.gonzalez@evapro.demo', firstName: 'Maria', lastName: 'Gonzalez', department: 'Ventas', position: 'Ejecutiva de Ventas' },
      { email: 'andres.castro@evapro.demo', firstName: 'Andres', lastName: 'Castro', department: 'Ventas', position: 'Account Manager' },
      { email: 'javiera.lagos@evapro.demo', firstName: 'Javiera', lastName: 'Lagos', department: 'Ventas', position: 'Ejecutiva Comercial' },
      { email: 'sebastian.diaz@evapro.demo', firstName: 'Sebastian', lastName: 'Diaz', department: 'Ventas', position: 'Key Account Manager' },
      { email: 'francisca.rivas@evapro.demo', firstName: 'Francisca', lastName: 'Rivas', department: 'Ventas', position: 'Analista de Ventas' },
      { email: 'rodrigo.pinto@evapro.demo', firstName: 'Rodrigo', lastName: 'Pinto', department: 'Ventas', position: 'Ejecutivo de Cuentas' },
      { email: 'lorena.campos@evapro.demo', firstName: 'Lorena', lastName: 'Campos', department: 'Ventas', position: 'Coordinadora Comercial' },
      // Marketing (6)
      { email: 'camila.herrera@evapro.demo', firstName: 'Camila', lastName: 'Herrera', department: 'Marketing', position: 'Content Manager' },
      { email: 'valentina.rojas@evapro.demo', firstName: 'Valentina', lastName: 'Rojas', department: 'Marketing', position: 'Disenadora UI' },
      { email: 'ignacio.tapia@evapro.demo', firstName: 'Ignacio', lastName: 'Tapia', department: 'Marketing', position: 'Community Manager' },
      { email: 'fernanda.silva@evapro.demo', firstName: 'Fernanda', lastName: 'Silva', department: 'Marketing', position: 'Analista de Marketing Digital' },
      { email: 'martin.vidal@evapro.demo', firstName: 'Martin', lastName: 'Vidal', department: 'Marketing', position: 'Disenador Grafico' },
      { email: 'constanza.araya@evapro.demo', firstName: 'Constanza', lastName: 'Araya', department: 'Marketing', position: 'Coordinadora de Eventos' },
      // Operaciones (6)
      { email: 'diego.morales@evapro.demo', firstName: 'Diego', lastName: 'Morales', department: 'Operaciones', position: 'Analista de Operaciones' },
      { email: 'carla.munoz@evapro.demo', firstName: 'Carla', lastName: 'Munoz', department: 'Operaciones', position: 'Coordinadora de Logistica' },
      { email: 'alejandro.parra@evapro.demo', firstName: 'Alejandro', lastName: 'Parra', department: 'Operaciones', position: 'Jefe de Bodega' },
      { email: 'patricia.cortes@evapro.demo', firstName: 'Patricia', lastName: 'Cortes', department: 'Operaciones', position: 'Analista de Procesos' },
      { email: 'victor.espinoza@evapro.demo', firstName: 'Victor', lastName: 'Espinoza', department: 'Operaciones', position: 'Supervisor de Produccion' },
      { email: 'andrea.maldonado@evapro.demo', firstName: 'Andrea', lastName: 'Maldonado', department: 'Operaciones', position: 'Planificadora de Demanda' },
      // Finanzas (5)
      { email: 'isabel.mendez@evapro.demo', firstName: 'Isabel', lastName: 'Mendez', department: 'Finanzas', position: 'Analista Financiero' },
      { email: 'roberto.torres@evapro.demo', firstName: 'Roberto', lastName: 'Torres', department: 'Finanzas', position: 'Contador General' },
      { email: 'claudia.navarro@evapro.demo', firstName: 'Claudia', lastName: 'Navarro', department: 'Finanzas', position: 'Tesorera' },
      { email: 'jorge.figueroa@evapro.demo', firstName: 'Jorge', lastName: 'Figueroa', department: 'Finanzas', position: 'Controller Financiero' },
      { email: 'marcela.gutierrez@evapro.demo', firstName: 'Marcela', lastName: 'Gutierrez', department: 'Finanzas', position: 'Analista de Costos' },
      // Recursos Humanos (5)
      { email: 'carolina.sepulveda@evapro.demo', firstName: 'Carolina', lastName: 'Sepulveda', department: 'Recursos Humanos', position: 'Especialista en Seleccion' },
      { email: 'jose.contreras@evapro.demo', firstName: 'Jose', lastName: 'Contreras', department: 'Recursos Humanos', position: 'Analista de Compensaciones' },
      { email: 'veronica.leon@evapro.demo', firstName: 'Veronica', lastName: 'Leon', department: 'Recursos Humanos', position: 'Coordinadora de Capacitacion' },
      { email: 'raul.aguilar@evapro.demo', firstName: 'Raul', lastName: 'Aguilar', department: 'Recursos Humanos', position: 'Analista de Bienestar' },
      { email: 'monica.valenzuela@evapro.demo', firstName: 'Monica', lastName: 'Valenzuela', department: 'Recursos Humanos', position: 'Asistente de RRHH' },
      // Legal (4)
      { email: 'ricardo.morales.o@evapro.demo', firstName: 'Ricardo', lastName: 'Morales Olate', department: 'Legal', position: 'Abogado Corporativo' },
      { email: 'paola.henriquez@evapro.demo', firstName: 'Paola', lastName: 'Henriquez', department: 'Legal', position: 'Asistente Legal' },
      { email: 'eduardo.sandoval@evapro.demo', firstName: 'Eduardo', lastName: 'Sandoval', department: 'Legal', position: 'Abogado Laboral' },
      { email: 'sofia.duran@evapro.demo', firstName: 'Sofia', lastName: 'Duran', department: 'Legal', position: 'Analista de Cumplimiento' },
      // Administracion (4)
      { email: 'miguel.flores@evapro.demo', firstName: 'Miguel', lastName: 'Flores', department: 'Administración', position: 'Jefe de Administracion' },
      { email: 'carmen.rivera@evapro.demo', firstName: 'Carmen', lastName: 'Rivera', department: 'Administración', position: 'Recepcionista' },
      { email: 'hector.bustos@evapro.demo', firstName: 'Hector', lastName: 'Bustos', department: 'Administración', position: 'Encargado de Compras' },
      { email: 'rosa.ortiz@evapro.demo', firstName: 'Rosa', lastName: 'Ortiz', department: 'Administración', position: 'Asistente Administrativa' },
    ];

    const pwHash = await bcrypt.hash('EvaPro2026!', 10);
    const allNewUsers: User[] = [];
    for (const emp of newEmployees) {
      let u = await userRepo.findOne({ where: { email: emp.email, tenantId: tid } });
      if (!u) {
        u = await userRepo.save(userRepo.create({
          ...emp, passwordHash: pwHash, role: 'employee', isActive: true,
          tenantId: tid, managerId: manager.id, hireDate: daysAgo(Math.floor(180 + Math.random() * 720)),
        }));
        console.log(`✅ Employee created: ${emp.email}`);
      }
      allNewUsers.push(u);
    }

    // Fix departments & positions for ALL users (idempotent update)
    for (const emp of newEmployees) {
      const u = await userRepo.findOne({ where: { email: emp.email, tenantId: tid } });
      if (u && (u.department !== emp.department || u.position !== emp.position)) {
        u.department = emp.department;
        u.position = emp.position;
        await userRepo.save(u);
      }
    }

    // ── Assign department-specific managers ──────────────────────────────
    // First employee of each department becomes the department manager (role=manager)
    const deptManagerMap: Record<string, string> = {};
    const deptLeadPositions: Record<string, string> = {
      'Tecnología': 'Gerente de Tecnología',
      'Ventas': 'Gerente de Ventas',
      'Marketing': 'Gerente de Marketing',
      'Operaciones': 'Gerente de Operaciones',
      'Finanzas': 'Gerente de Finanzas',
      'Recursos Humanos': 'Gerente de RRHH',
      'Legal': 'Gerente Legal',
      'Administración': 'Jefe de Administración',
      'Diseño': 'Gerente de Diseño',
    };

    // Carlos Lopez is manager of Tecnología
    deptManagerMap['Tecnología'] = manager.id;

    // For other departments, promote first employee to manager role
    for (const emp of newEmployees) {
      if (deptManagerMap[emp.department]) continue; // already has a manager
      const u = await userRepo.findOne({ where: { email: emp.email, tenantId: tid } });
      if (u) {
        deptManagerMap[emp.department] = u.id;
        u.role = 'manager';
        u.position = deptLeadPositions[emp.department] || `Jefe de ${emp.department}`;
        u.managerId = admin.id; // Department managers report to admin
        await userRepo.save(u);
        console.log(`✅ ${u.firstName} ${u.lastName} promoted to manager of ${emp.department}`);
      }
    }

    // Now assign each employee their department manager
    for (const emp of newEmployees) {
      const u = await userRepo.findOne({ where: { email: emp.email, tenantId: tid } });
      if (!u) continue;
      const deptMgr = deptManagerMap[u.department || ''];
      if (deptMgr && u.id !== deptMgr && u.managerId !== deptMgr) {
        u.managerId = deptMgr;
        await userRepo.save(u);
      }
    }
    console.log(`✅ Department managers assigned: ${Object.keys(deptManagerMap).length} departments`);

    // Apply demographic data to ALL users
    const genders = ['masculino', 'femenino'];
    const nationalities = ['Chilena', 'Chilena', 'Chilena', 'Colombiana', 'Peruana', 'Argentina', 'Mexicana', 'Venezolana'];
    const seniorities = ['junior', 'mid', 'mid', 'senior', 'senior', 'lead'];
    const contracts = ['indefinido', 'indefinido', 'indefinido', 'indefinido', 'plazo_fijo'];
    const locations = ['oficina', 'oficina', 'remoto', 'remoto', 'hibrido', 'hibrido'];

    const allUsers = await userRepo.find({ where: { tenantId: tid, isActive: true } });
    let demoUpdated = 0;
    for (const u of allUsers) {
      const idx = allUsers.indexOf(u);
      const yearBase = 1980 + Math.floor(Math.random() * 18); // 1980-1997
      const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
      const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
      await userRepo.update(u.id, {
        gender: u.gender || genders[idx % 2],
        birthDate: u.birthDate || `${yearBase}-${month}-${day}` as any,
        nationality: u.nationality || nationalities[idx % nationalities.length],
        seniorityLevel: u.seniorityLevel || (u.role === 'manager' ? 'director' : u.role === 'tenant_admin' ? 'executive' : seniorities[idx % seniorities.length]),
        contractType: u.contractType || contracts[idx % contracts.length],
        workLocation: u.workLocation || locations[idx % locations.length],
      });
      demoUpdated++;
    }
    console.log('✅ Demographic data applied to ' + demoUpdated + ' users');

    // Collect all employees
    const existingEmps = await userRepo.find({ where: { tenantId: tid, role: 'employee', isActive: true } });
    const allEmployees = existingEmps;
    const allEvaluable = [manager, ...allEmployees]; // Manager + employees
    console.log(`   Total evaluable users: ${allEvaluable.length}`);

    /* ── 3. Get template ─────────────────────────────────────────────────── */
    const template360 = await templateRepo.findOne({ where: { name: 'Evaluacion 360° Completa', tenantId: tid } })
      || await templateRepo.findOne({ where: { name: 'Competencias Generales', tenantId: tid } });
    const templateDefault = await templateRepo.findOne({ where: { name: 'Competencias Generales', tenantId: tid } });
    if (!templateDefault) { console.error('❌ No template found.'); return; }

    const scaleQIds = ['q1', 'q2', 'q3', 'q4'];
    const textAns = {
      q5: 'Excelente desempeno general, destaca por su compromiso.',
      q6: 'Podria mejorar la documentacion de sus procesos.',
    };

    /* ── 4. Create 180° CLOSED cycle (Q4 2025) ──────────────────────────── */
    let cycle180 = await cycleRepo.findOne({ where: { name: 'Q4 2025 - Evaluacion Semestral 180', tenantId: tid } });
    if (!cycle180) {
      cycle180 = await cycleRepo.save(cycleRepo.create({
        tenantId: tid, name: 'Q4 2025 - Evaluacion Semestral 180',
        type: CycleType.DEGREE_180, period: CyclePeriod.BIANNUAL,
        status: CycleStatus.CLOSED,
        startDate: new Date('2025-10-01'), endDate: new Date('2025-12-15'),
        templateId: templateDefault.id, createdBy: admin.id,
        totalEvaluated: allEvaluable.length, settings: {},
      }));

      // Create assignments: self + manager for each person
      for (const user of allEvaluable) {
        const evaluator = user.id === manager.id ? admin : manager;

        // Self-evaluation
        const selfAns = { ...randomAnswers(3, 5, scaleQIds), ...textAns };
        const selfAssign = await assignRepo.save(assignRepo.create({
          tenantId: tid, cycleId: cycle180.id, evaluateeId: user.id,
          evaluatorId: user.id, relationType: RelationType.SELF,
          status: AssignmentStatus.COMPLETED, dueDate: new Date('2025-12-15'),
          completedAt: daysAgo(100 + Math.floor(Math.random() * 10)),
        }));
        await respRepo.save(respRepo.create({
          tenantId: tid, assignmentId: selfAssign.id, answers: selfAns,
          overallScore: calcScore(selfAns), submittedAt: selfAssign.completedAt,
        }));

        // Manager evaluation
        const mgrAns = { ...randomAnswers(2, 5, scaleQIds), ...textAns };
        const mgrAssign = await assignRepo.save(assignRepo.create({
          tenantId: tid, cycleId: cycle180.id, evaluateeId: user.id,
          evaluatorId: evaluator.id, relationType: RelationType.MANAGER,
          status: AssignmentStatus.COMPLETED, dueDate: new Date('2025-12-15'),
          completedAt: daysAgo(95 + Math.floor(Math.random() * 10)),
        }));
        await respRepo.save(respRepo.create({
          tenantId: tid, assignmentId: mgrAssign.id, answers: mgrAns,
          overallScore: calcScore(mgrAns), submittedAt: mgrAssign.completedAt,
        }));
      }

      // Create stages
      const stages180 = [
        { type: StageType.SELF_EVALUATION, name: 'Autoevaluacion', order: 1, status: StageStatus.COMPLETED },
        { type: StageType.MANAGER_EVALUATION, name: 'Evaluacion del Encargado', order: 2, status: StageStatus.COMPLETED },
        { type: StageType.FEEDBACK_DELIVERY, name: 'Entrega de Resultados', order: 3, status: StageStatus.COMPLETED },
        { type: StageType.CLOSED, name: 'Cierre', order: 4, status: StageStatus.COMPLETED },
      ];
      for (const s of stages180) {
        await stageRepo.save(stageRepo.create({
          tenantId: tid, cycleId: cycle180.id, name: s.name,
          type: s.type, stageOrder: s.order, status: s.status,
          startDate: new Date('2025-10-01'), endDate: new Date('2025-12-15'),
        }));
      }

      console.log(`✅ Cycle 180° created: ${cycle180.name} (${allEvaluable.length * 2} assignments)`);
    }

    /* ── 5. Create 360° ACTIVE cycle (Q1-Q2 2026) ────────────────────────── */
    let cycle360 = await cycleRepo.findOne({ where: { name: 'S1 2026 - Evaluacion 360 Integral', tenantId: tid } });
    if (!cycle360) {
      cycle360 = await cycleRepo.save(cycleRepo.create({
        tenantId: tid, name: 'S1 2026 - Evaluacion 360 Integral',
        type: CycleType.DEGREE_360, period: CyclePeriod.BIANNUAL,
        status: CycleStatus.ACTIVE,
        startDate: new Date('2026-03-01'), endDate: new Date('2026-04-30'),
        templateId: (template360 || templateDefault).id, createdBy: admin.id,
        totalEvaluated: allEvaluable.length, settings: { anonymousThreshold: 3 },
      }));

      const fQIds = template360
        ? ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10']
        : scaleQIds;
      const fTextAns = template360
        ? { f11: 'Comunicacion clara y trabajo en equipo', f12: 'Necesita mejorar priorizacion', f13: 'Tomar cursos de liderazgo' }
        : textAns;

      // For each evaluable person: self + manager + 2 peers + 1 direct_report (mix)
      for (let i = 0; i < allEvaluable.length; i++) {
        const user = allEvaluable[i];
        const evaluatorMgr = user.id === manager.id ? admin : manager;

        // Self-evaluation: 70% completed
        const selfCompleted = Math.random() < 0.7;
        const selfAns = { ...randomAnswers(3, 5, fQIds), ...fTextAns };
        const selfAssign = await assignRepo.save(assignRepo.create({
          tenantId: tid, cycleId: cycle360.id, evaluateeId: user.id,
          evaluatorId: user.id, relationType: RelationType.SELF,
          status: selfCompleted ? AssignmentStatus.COMPLETED : AssignmentStatus.PENDING,
          dueDate: new Date('2026-04-30'),
          completedAt: selfCompleted ? daysAgo(Math.floor(Math.random() * 5) + 1) : undefined,
        }));
        if (selfCompleted) {
          await respRepo.save(respRepo.create({
            tenantId: tid, assignmentId: selfAssign.id, answers: selfAns,
            overallScore: calcScore(selfAns), submittedAt: selfAssign.completedAt,
          }));
        }

        // Manager evaluation: 50% completed
        const mgrCompleted = Math.random() < 0.5;
        const mgrAns = { ...randomAnswers(2, 5, fQIds), ...fTextAns };
        const mgrAssign = await assignRepo.save(assignRepo.create({
          tenantId: tid, cycleId: cycle360.id, evaluateeId: user.id,
          evaluatorId: evaluatorMgr.id, relationType: RelationType.MANAGER,
          status: mgrCompleted ? AssignmentStatus.COMPLETED : AssignmentStatus.IN_PROGRESS,
          dueDate: new Date('2026-04-30'),
          completedAt: mgrCompleted ? daysAgo(Math.floor(Math.random() * 3) + 1) : undefined,
        }));
        if (mgrCompleted) {
          await respRepo.save(respRepo.create({
            tenantId: tid, assignmentId: mgrAssign.id, answers: mgrAns,
            overallScore: calcScore(mgrAns), submittedAt: mgrAssign.completedAt,
          }));
        }

        // 2 peer evaluations
        const peers = allEvaluable.filter((_, j) => j !== i);
        const selectedPeers = peers.sort(() => Math.random() - 0.5).slice(0, 2);
        for (const peer of selectedPeers) {
          const peerCompleted = Math.random() < 0.4;
          const peerAns = { ...randomAnswers(2, 5, fQIds), ...fTextAns };

          // Check if assignment already exists
          const existing = await assignRepo.findOne({
            where: { cycleId: cycle360.id, evaluateeId: user.id, evaluatorId: peer.id, relationType: RelationType.PEER },
          });
          if (existing) continue;

          const peerAssign = await assignRepo.save(assignRepo.create({
            tenantId: tid, cycleId: cycle360.id, evaluateeId: user.id,
            evaluatorId: peer.id, relationType: RelationType.PEER,
            status: peerCompleted ? AssignmentStatus.COMPLETED : AssignmentStatus.PENDING,
            dueDate: new Date('2026-04-30'),
            completedAt: peerCompleted ? daysAgo(Math.floor(Math.random() * 5)) : undefined,
          }));
          if (peerCompleted) {
            await respRepo.save(respRepo.create({
              tenantId: tid, assignmentId: peerAssign.id, answers: peerAns,
              overallScore: calcScore(peerAns), submittedAt: peerAssign.completedAt,
            }));
          }
        }
      }

      // Create stages for 360° cycle
      const stages360 = [
        { type: StageType.SELF_EVALUATION, name: 'Autoevaluacion', order: 1, status: StageStatus.ACTIVE, start: '2026-03-01', end: '2026-03-21' },
        { type: StageType.MANAGER_EVALUATION, name: 'Evaluacion del Encargado', order: 2, status: StageStatus.ACTIVE, start: '2026-03-15', end: '2026-04-05' },
        { type: StageType.PEER_EVALUATION, name: 'Evaluacion de Pares', order: 3, status: StageStatus.PENDING, start: '2026-03-20', end: '2026-04-15' },
        { type: StageType.CALIBRATION, name: 'Calibracion', order: 4, status: StageStatus.PENDING, start: '2026-04-15', end: '2026-04-22' },
        { type: StageType.FEEDBACK_DELIVERY, name: 'Entrega de Resultados', order: 5, status: StageStatus.PENDING, start: '2026-04-22', end: '2026-04-30' },
        { type: StageType.CLOSED, name: 'Cierre', order: 6, status: StageStatus.PENDING, start: '2026-04-30', end: '2026-04-30' },
      ];
      for (const s of stages360) {
        await stageRepo.save(stageRepo.create({
          tenantId: tid, cycleId: cycle360.id, name: s.name,
          type: s.type, stageOrder: s.order, status: s.status,
          startDate: new Date(s.start), endDate: new Date(s.end),
        }));
      }

      console.log(`✅ Cycle 360° created: ${cycle360.name} (active, mixed completion)`);
    }

    /* ── 6. OKRs with Key Results ────────────────────────────────────────── */
    const existingObjs = await objRepo.count({ where: { tenantId: tid } });
    if (existingObjs < 10) {
      const okrDefs = [
        { user: manager, title: 'Aumentar la productividad del equipo en 30%', weight: 40, progress: 65, type: 'OKR', krs: [
          { desc: 'Reducir tiempo de ciclo de desarrollo de 5 a 3.5 dias', unit: 'dias', base: 5, target: 3.5, current: 4.1 },
          { desc: 'Alcanzar 90% de cobertura en tests automatizados', unit: '%', base: 60, target: 90, current: 78 },
          { desc: 'Implementar CI/CD con deploy automatico', unit: 'cantidad', base: 0, target: 1, current: 1 },
        ]},
        { user: manager, title: 'Mejorar satisfaccion del equipo a 8.5+', weight: 30, progress: 72, type: 'OKR', krs: [
          { desc: 'Realizar check-ins 1:1 semanales con cada miembro', unit: '%', base: 0, target: 100, current: 80 },
          { desc: 'Reducir rotacion voluntaria a menos del 5%', unit: '%', base: 12, target: 5, current: 8 },
        ]},
        { user: manager, title: 'Lanzar MVP del modulo de reportes', weight: 30, progress: 90, type: 'KPI', krs: [
          { desc: 'Entregar 5 tipos de reportes funcionales', unit: 'cantidad', base: 0, target: 5, current: 4 },
          { desc: 'NPS de usuarios internos > 7', unit: 'score', base: 0, target: 7, current: 7.5 },
        ]},
      ];

      for (let ei = 0; ei < allEmployees.length; ei++) {
        const emp = allEmployees[ei];
        const titles = [
          { title: `Completar certificacion profesional en ${emp.department}`, weight: 50, progress: Math.floor(30 + Math.random() * 60), type: 'SMART' as const, krs: [
            { desc: 'Completar 4 modulos del curso online', unit: 'modulos', base: 0, target: 4, current: Math.floor(1 + Math.random() * 3) },
            { desc: 'Aprobar examen final con nota > 80%', unit: '%', base: 0, target: 80, current: Math.floor(Math.random() * 85) },
          ]},
          { title: `Mejorar KPIs del area de ${emp.department}`, weight: 50, progress: Math.floor(20 + Math.random() * 70), type: 'KPI' as const, krs: [
            { desc: 'Reducir errores en entregables en un 40%', unit: '%', base: 100, target: 60, current: Math.floor(60 + Math.random() * 30) },
            { desc: 'Cumplir plazos de entrega al 95%', unit: '%', base: 70, target: 95, current: Math.floor(75 + Math.random() * 20) },
          ]},
        ];
        okrDefs.push(...titles.map((t) => ({ user: emp, ...t })));
      }

      for (const def of okrDefs) {
        const existing = await objRepo.findOne({ where: { tenantId: tid, userId: def.user.id, title: def.title } });
        if (existing) continue;

        const status = def.progress >= 100 ? 'completed' : def.progress > 0 ? 'active' : 'draft';
        const obj = await objRepo.save(objRepo.create({
          tenantId: tid, userId: def.user.id, title: def.title,
          type: def.type as any, weight: def.weight, progress: def.progress,
          status: status as any,
          targetDate: daysFromNow(60 + Math.floor(Math.random() * 60)),
        }));

        // Key Results
        for (const kr of def.krs) {
          await krRepo.save(krRepo.create({
            tenantId: tid, objectiveId: obj.id,
            description: kr.desc, unit: kr.unit,
            baseValue: kr.base, targetValue: kr.target, currentValue: kr.current,
            status: kr.current >= kr.target ? KRStatus.COMPLETED : KRStatus.ACTIVE,
          }));
        }

        // 1-2 updates
        await objUpdateRepo.save(objUpdateRepo.create({
          tenantId: tid, objectiveId: obj.id,
          progressValue: Math.floor(def.progress * 0.6),
          notes: 'Avance inicial del trimestre', createdBy: def.user.id,
        }));
        if (def.progress > 40) {
          await objUpdateRepo.save(objUpdateRepo.create({
            tenantId: tid, objectiveId: obj.id,
            progressValue: def.progress,
            notes: 'Actualizacion de progreso mensual', createdBy: def.user.id,
          }));
        }
      }
      console.log(`✅ OKRs created: ${okrDefs.length} objectives with key results`);
    }

    /* ── 7. Quick Feedback between peers ─────────────────────────────────── */
    const existingFeedback = await feedbackRepo.count({ where: { tenantId: tid } });
    if (existingFeedback < 10) {
      const feedbackMessages = [
        { msg: 'Excelente presentacion en la reunion de equipo, muy clara y estructurada!', sentiment: 'positive' as const, category: 'Comunicacion' },
        { msg: 'Gracias por ayudarme con el bug de produccion, lo resolvimos en minutos', sentiment: 'positive' as const, category: 'Trabajo en equipo' },
        { msg: 'Seria bueno mejorar la documentacion de los procesos para el equipo', sentiment: 'constructive' as const, category: 'Documentacion' },
        { msg: 'Buen trabajo liderando el proyecto, el equipo se siente motivado', sentiment: 'positive' as const, category: 'Liderazgo' },
        { msg: 'Podrias ser mas puntual en las reuniones de standup', sentiment: 'constructive' as const, category: 'Compromiso' },
        { msg: 'Me parecio muy profesional como manejaste la situacion con el cliente', sentiment: 'positive' as const, category: 'Servicio' },
        { msg: 'Considero que deberiamos alinear mejor las prioridades antes de comprometernos con fechas', sentiment: 'neutral' as const, category: 'Planificacion' },
        { msg: 'Tu codigo es muy limpio, gracias por los code reviews detallados', sentiment: 'positive' as const, category: 'Calidad' },
        { msg: 'Seria ideal compartir mas el conocimiento con los juniors del equipo', sentiment: 'constructive' as const, category: 'Mentoring' },
        { msg: 'Felicitaciones por cerrar el deal mas grande del trimestre!', sentiment: 'positive' as const, category: 'Resultados' },
      ];

      // Get competencies for linking
      const competencies = await compRepo.find({ where: { tenantId: tid } });

      for (let i = 0; i < feedbackMessages.length; i++) {
        const fb = feedbackMessages[i];
        const from = allEvaluable[i % allEvaluable.length];
        const to = allEvaluable[(i + 3) % allEvaluable.length];
        if (from.id === to.id) continue;

        await feedbackRepo.save(feedbackRepo.create({
          tenantId: tid, fromUserId: from.id, toUserId: to.id,
          message: fb.msg, sentiment: fb.sentiment, category: fb.category,
          isAnonymous: Math.random() < 0.2,
          visibility: Math.random() < 0.7 ? 'public' : Math.random() < 0.5 ? 'private' : 'manager_only',
          competencyId: competencies.length > 0 ? competencies[i % competencies.length].id : undefined,
        } as any));
      }

      // Add feedback TO the manager and admin
      await feedbackRepo.save(feedbackRepo.create({
        tenantId: tid, fromUserId: allEmployees[0].id, toUserId: manager.id,
        message: 'Carlos siempre esta disponible para resolver dudas y dar direccion. Gran lider!',
        sentiment: 'positive', category: 'Liderazgo', isAnonymous: false, visibility: 'public',
      } as any));
      await feedbackRepo.save(feedbackRepo.create({
        tenantId: tid, fromUserId: manager.id, toUserId: admin.id,
        message: 'El sistema de evaluaciones que implemento HR ha sido muy util para el equipo',
        sentiment: 'positive', category: 'Gestion', isAnonymous: false, visibility: 'public',
      } as any));

      console.log(`✅ Quick feedback created: ${feedbackMessages.length + 2} entries`);
    }

    /* ── 8. Check-ins 1:1 ────────────────────────────────────────────────── */
    const existingCheckins = await checkInRepo.count({ where: { tenantId: tid } });
    if (existingCheckins < 5) {
      const checkinTopics = [
        'Revision de objetivos del trimestre',
        'Plan de desarrollo profesional',
        'Feedback sobre el proyecto actual',
        'Alineamiento de prioridades',
        'Seguimiento de capacitacion',
      ];

      for (let i = 0; i < Math.min(allEmployees.length, 6); i++) {
        const emp = allEmployees[i];
        // 1 completed check-in
        await checkInRepo.save(checkInRepo.create({
          tenantId: tid, managerId: manager.id, employeeId: emp.id,
          scheduledDate: daysAgo(7 + i * 3), scheduledTime: '10:00',
          topic: checkinTopics[i % checkinTopics.length],
          notes: 'Reunion productiva, se acordaron proximos pasos.',
          actionItems: [
            { text: 'Completar el reporte semanal', completed: true, assigneeName: emp.firstName },
            { text: 'Revisar OKRs con el equipo', completed: false, assigneeName: emp.firstName, dueDate: daysFromNow(5).toISOString() },
          ],
          agendaTopics: [
            { text: 'Avance de objetivos', addedBy: manager.id, addedByName: 'Carlos Lopez', addedAt: daysAgo(8).toISOString() },
            { text: 'Feedback del sprint', addedBy: emp.id, addedByName: `${emp.firstName} ${emp.lastName}`, addedAt: daysAgo(7).toISOString() },
          ],
          status: 'completed', completedAt: daysAgo(7 + i * 3),
        } as any));

        // 1 scheduled check-in
        await checkInRepo.save(checkInRepo.create({
          tenantId: tid, managerId: manager.id, employeeId: emp.id,
          scheduledDate: daysFromNow(3 + i * 2), scheduledTime: '14:00',
          topic: 'Seguimiento semanal',
          notes: null,
          actionItems: [],
          agendaTopics: [
            { text: 'Revisar avance OKRs', addedBy: manager.id, addedByName: 'Carlos Lopez', addedAt: new Date().toISOString() },
          ],
          status: 'scheduled',
        } as any));
      }
      console.log(`✅ Check-ins created: ${Math.min(allEmployees.length, 6) * 2} entries`);
    }

    /* ── 9. Development Plans ────────────────────────────────────────────── */
    const existingPlans = await devPlanRepo.count({ where: { tenantId: tid } });
    if (existingPlans < 3) {
      const competencies = await compRepo.find({ where: { tenantId: tid } });

      for (let i = 0; i < Math.min(allEmployees.length, 5); i++) {
        const emp = allEmployees[i];
        const plan = await devPlanRepo.save(devPlanRepo.create({
          tenantId: tid, userId: emp.id, createdBy: manager.id,
          cycleId: cycle180?.id || null,
          title: `Plan de Desarrollo ${emp.firstName} ${emp.lastName} - 2026`,
          description: `Plan de desarrollo individual enfocado en fortalecer competencias clave para el rol de ${emp.position}.`,
          status: i < 2 ? 'activo' : i < 4 ? 'en_revision' : 'borrador',
          priority: i === 0 ? 'alta' : 'media',
          startDate: daysAgo(30), targetDate: daysFromNow(150),
          progress: Math.floor(15 + Math.random() * 60),
        }));

        // 2-3 actions per plan
        const actionTypes = ['curso', 'mentoring', 'proyecto', 'taller', 'lectura'];
        const actionTitles = [
          'Completar curso de liderazgo online',
          'Sesiones de mentoring con senior',
          'Liderar proyecto interno de mejora',
          'Asistir a taller de comunicacion',
          'Leer libro "Radical Candor"',
        ];
        for (let a = 0; a < 3; a++) {
          await devActionRepo.save(devActionRepo.create({
            tenantId: tid, planId: plan.id,
            title: actionTitles[(i + a) % actionTitles.length],
            description: 'Actividad clave para el desarrollo de la competencia identificada.',
            actionType: actionTypes[(i + a) % actionTypes.length],
            competencyId: competencies.length > 0 ? competencies[(i + a) % competencies.length].id : undefined,
            status: a === 0 ? 'completada' : a === 1 ? 'en_progreso' : 'pendiente',
            priority: a === 0 ? 'alta' : 'media',
            dueDate: daysFromNow(30 + a * 30),
            completedAt: a === 0 ? daysAgo(5) : undefined,
          }));
        }

        // 1 comment
        await devCommentRepo.save(devCommentRepo.create({
          tenantId: tid, planId: plan.id, authorId: manager.id,
          content: `Buen avance ${emp.firstName}, sigamos con el foco en las acciones pendientes.`,
          type: 'seguimiento',
        }));
      }
      console.log(`✅ Development plans created: ${Math.min(allEmployees.length, 5)} plans with actions`);
    }

    /* ── 10. Talent Assessments (Nine Box) ───────────────────────────────── */
    const closedCycle = cycle180 || await cycleRepo.findOne({ where: { tenantId: tid, status: CycleStatus.CLOSED } });
    if (closedCycle) {
      const existingTalent = await talentRepo.count({ where: { tenantId: tid } });
      if (existingTalent < 5) {
        const nineBoxMap: Array<{ perf: number; pot: number; box: number; pool: string; readiness: string; risk: string }> = [
          { perf: 9, pot: 9, box: 1, pool: 'star', readiness: 'ready_now', risk: 'medium' },
          { perf: 8, pot: 7, box: 2, pool: 'high_performer', readiness: 'ready_now', risk: 'low' },
          { perf: 6, pot: 6, box: 5, pool: 'core_player', readiness: 'ready_1_year', risk: 'low' },
          { perf: 5, pot: 8, box: 3, pool: 'developing', readiness: 'ready_1_year', risk: 'medium' },
          { perf: 7, pot: 5, box: 4, pool: 'core_player', readiness: 'ready_2_years', risk: 'low' },
          { perf: 4, pot: 4, box: 8, pool: 'inconsistent', readiness: 'not_ready', risk: 'high' },
          { perf: 9, pot: 5, box: 4, pool: 'high_performer', readiness: 'ready_now', risk: 'medium' },
          { perf: 7, pot: 8, box: 2, pool: 'star', readiness: 'ready_1_year', risk: 'low' },
          { perf: 6, pot: 3, box: 7, pool: 'core_player', readiness: 'ready_2_years', risk: 'low' },
          { perf: 3, pot: 6, box: 6, pool: 'enigma', readiness: 'not_ready', risk: 'high' },
          { perf: 8, pot: 8, box: 1, pool: 'star', readiness: 'ready_now', risk: 'low' },
        ];

        for (let i = 0; i < Math.min(allEvaluable.length, nineBoxMap.length); i++) {
          const user = allEvaluable[i];
          const nb = nineBoxMap[i];
          const existing = await talentRepo.findOne({ where: { tenantId: tid, cycleId: closedCycle.id, userId: user.id } });
          if (existing) continue;

          await talentRepo.save(talentRepo.create({
            tenantId: tid, cycleId: closedCycle.id, userId: user.id,
            performanceScore: nb.perf, potentialScore: nb.pot,
            nineBoxPosition: nb.box, talentPool: nb.pool,
            readiness: nb.readiness, flightRisk: nb.risk,
            notes: `Evaluacion de talento basada en ciclo ${closedCycle.name}`,
            assessedBy: admin.id,
          }));
        }
        console.log(`✅ Talent assessments created: ${Math.min(allEvaluable.length, nineBoxMap.length)} entries (Nine Box)`);
      }
    }

    /* ── 11. Calibration Session ─────────────────────────────────────────── */
    if (closedCycle) {
      const existingCal = await calSessionRepo.count({ where: { tenantId: tid } });
      if (existingCal === 0) {
        const session = await calSessionRepo.save(calSessionRepo.create({
          tenantId: tid, cycleId: closedCycle.id,
          name: 'Calibracion Semestral 2025 - Equipo Producto',
          status: 'completed', department: 'Tecnología',
          moderatorId: admin.id, minQuorum: 2,
          expectedDistribution: { low: 10, midLow: 20, mid: 40, midHigh: 20, high: 10 },
          notes: 'Sesion de calibracion completada con consenso del equipo de liderazgo.',
        }));

        // Entries for each team member
        for (let i = 0; i < Math.min(allEvaluable.length, 8); i++) {
          const user = allEvaluable[i];
          const origScore = randomScore(4, 9);
          const adjusted = origScore + (Math.random() < 0.3 ? (Math.random() < 0.5 ? 0.5 : -0.5) : 0);

          await calEntryRepo.save(calEntryRepo.create({
            sessionId: session.id, userId: user.id,
            originalScore: origScore, adjustedScore: Math.round(adjusted * 100) / 100,
            rationale: adjusted !== origScore ? 'Ajustado por consenso del comite de calibracion' : null,
            status: 'agreed', discussedBy: admin.id,
            approvalRequired: Math.abs(adjusted - origScore) > 2,
            approvalStatus: Math.abs(adjusted - origScore) > 2 ? 'approved' : 'not_required',
            approvedBy: Math.abs(adjusted - origScore) > 2 ? admin.id : undefined,
          }));
        }
        console.log(`✅ Calibration session created with ${Math.min(allEvaluable.length, 8)} entries`);
      }
    }

    /* ── 11b. MEETING LOCATIONS ─────────────────────────────────────── */
    const locRepo = ds.getRepository(MeetingLocation);
    const existingLocs = await locRepo.count({ where: { tenantId: tid } });
    if (existingLocs === 0) {
      const locationsData = [
        { name: 'Sala de Reuniones A', type: 'physical', address: 'Piso 3, Oficina 301', capacity: 8 },
        { name: 'Sala de Reuniones B', type: 'physical', address: 'Piso 2, Oficina 205', capacity: 4 },
        { name: 'Google Meet', type: 'virtual', address: 'https://meet.google.com/abc-defg-hij', capacity: null },
        { name: 'Zoom Corporativo', type: 'virtual', address: 'https://zoom.us/j/1234567890', capacity: null },
        { name: 'Cafetería', type: 'physical', address: 'Piso 1, zona común', capacity: 2 },
      ];
      for (const l of locationsData) {
        await locRepo.save(locRepo.create({ tenantId: tid, ...l, isActive: true } as any));
      }
      console.log(`✅ Meeting locations created: ${locationsData.length} locations`);
    } else {
      console.log(`   Meeting locations already exist (${existingLocs}), skipping.`);
    }

    /* ── 12. ROLE COMPETENCIES for Gap Analysis ────────────────────────── */
    const roleCompRepo = ds.getRepository(RoleCompetency);
    const existingRC = await roleCompRepo.count({ where: { tenantId: tid } });
    if (existingRC === 0) {
      const competencies = await compRepo.find({ where: { tenantId: tid } });
      if (competencies.length > 0) {
        const positions = [
          'Frontend Developer', 'Backend Developer', 'UI Designer',
          'QA Lead', 'SRE Engineer', 'Ejecutiva de Ventas',
          'Account Manager', 'Content Manager',
        ];
        for (const position of positions) {
          for (const comp of competencies) {
            // Assign expected levels based on competency and role
            let expectedLevel = 3; // default
            const name = comp.name.toLowerCase();
            if (position.includes('Developer') && (name.includes('tecn') || name.includes('problem') || name.includes('innov'))) expectedLevel = 4;
            if (position.includes('Developer') && name.includes('comunic')) expectedLevel = 3;
            if (position.includes('Ventas') && (name.includes('comunic') || name.includes('client') || name.includes('negoc'))) expectedLevel = 5;
            if (position.includes('Designer') && (name.includes('creativ') || name.includes('innov') || name.includes('diseno'))) expectedLevel = 5;
            if (position.includes('QA') && (name.includes('calidad') || name.includes('detail') || name.includes('anali'))) expectedLevel = 5;
            if (position.includes('SRE') && (name.includes('tecn') || name.includes('problem'))) expectedLevel = 5;
            if (position.includes('Content') && (name.includes('comunic') || name.includes('creativ'))) expectedLevel = 4;
            if (position.includes('Account') && (name.includes('client') || name.includes('relacion'))) expectedLevel = 5;

            await roleCompRepo.save(roleCompRepo.create({
              tenantId: tid,
              position,
              competencyId: comp.id,
              expectedLevel,
            }));
          }
        }
        console.log(`✅ Role competencies created: ${positions.length} positions × ${competencies.length} competencies = ${positions.length * competencies.length} entries`);
      }
    } else {
      console.log(`   Role competencies already exist (${existingRC}), skipping.`);
    }

    /* ── 13. NOTIFICATIONS for demo ──────────────────────────────────── */
    const notifRepo = ds.getRepository(Notification);
    const existingNotifs = await notifRepo.count({ where: { tenantId: tid } });
    if (existingNotifs < 5) {
      const notifData = [
        { userId: admin.id, type: NotificationType.GENERAL, title: 'Ciclo 360° lanzado', message: 'El ciclo de Evaluación 360° S1 2026 ha sido lanzado exitosamente. Se han creado las asignaciones para todos los participantes.', metadata: {} },
        { userId: manager.id, type: NotificationType.EVALUATION_PENDING, title: 'Evaluaciones pendientes', message: 'Tienes 3 evaluaciones pendientes del ciclo 360°. La fecha límite es en 15 días.', metadata: {} },
        { userId: allNewUsers[0]?.id || manager.id, type: NotificationType.EVALUATION_PENDING, title: 'Completa tu autoevaluación', message: 'Tu autoevaluación del ciclo 360° está pendiente. Recuerda completarla antes de la fecha límite.', metadata: {} },
        { userId: admin.id, type: NotificationType.CYCLE_CLOSING, title: 'Ciclo próximo a cerrar', message: 'El ciclo 180° Q4 2025 se cerrará en 5 días. Revisa el progreso de completitud antes del cierre.', metadata: {} },
        { userId: manager.id, type: NotificationType.OBJECTIVE_AT_RISK, title: 'Objetivo en riesgo', message: 'El objetivo "Reducir tiempo de respuesta al cliente" de tu equipo tiene un avance menor al esperado. Revisa las acciones pendientes.', metadata: {} },
        { userId: allNewUsers[1]?.id || manager.id, type: NotificationType.FEEDBACK_RECEIVED, title: 'Has recibido feedback', message: 'Un compañero te ha enviado feedback sobre tu colaboración en el proyecto de migración. Revísalo en la sección de Feedback.', metadata: {} },
        { userId: admin.id, type: NotificationType.PDI_ACTION_DUE, title: 'Acciones PDI vencidas', message: 'Hay 2 acciones de planes de desarrollo vencidas en tu organización. Revisa los planes para hacer seguimiento.', metadata: {} },
        { userId: manager.id, type: NotificationType.CHECKIN_OVERDUE, title: 'Recordatorio: Check-in 1:1', message: 'No has realizado check-ins con Isabel Méndez en las últimas 2 semanas. Agenda una reunión 1:1.', metadata: {} },
      ];
      for (const n of notifData) {
        await notifRepo.save(notifRepo.create({ tenantId: tid, ...n, isRead: false }));
      }
      console.log(`✅ Notifications created: ${notifData.length} demo notifications`);
    } else {
      console.log(`   Notifications already exist (${existingNotifs}), skipping.`);
    }

    /* ── 14. UPDATE SUBSCRIPTION to Pro plan ─────────────────────────── */
    const subPlanRepo = ds.getRepository(SubscriptionPlan);
    const subRepo = ds.getRepository(Subscription);
    const proPlan = await subPlanRepo.findOne({ where: { code: 'pro' } });
    if (proPlan) {
      const existingSub = await subRepo.findOne({ where: { tenantId: tid } });
      if (existingSub) {
        existingSub.planId = proPlan.id;
        existingSub.status = 'active' as any;
        await subRepo.save(existingSub);
        // Also update tenant
        await tenantRepo.update(tid, { plan: 'pro', maxEmployees: proPlan.maxEmployees });
        console.log(`✅ Demo tenant upgraded to Pro plan (maxEmployees: ${proPlan.maxEmployees})`);
      }
    } else {
      console.log('   Pro plan not found, skipping subscription upgrade.');
    }

    /* ── 14b. PAYMENT HISTORY (demo) ──────────────────────────────── */
    const payHistRepo = ds.getRepository(PaymentHistory);
    const existingSub = await subRepo.findOne({ where: { tenantId: tid } });
    if (existingSub) {
      const existingPayments = await payHistRepo.count({ where: { tenantId: tid } });
      if (existingPayments === 0) {
        const now = new Date();
        const payments = [
          { monthsAgo: 3, amount: 3.5, status: PaymentStatus.PAID },
          { monthsAgo: 2, amount: 3.5, status: PaymentStatus.PAID },
          { monthsAgo: 1, amount: 3.5, status: PaymentStatus.PAID },
        ];
        for (const p of payments) {
          const periodStart = new Date(now);
          periodStart.setMonth(periodStart.getMonth() - p.monthsAgo);
          periodStart.setDate(1);
          const periodEnd = new Date(periodStart);
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          periodEnd.setDate(0);
          const paidAt = new Date(periodStart);
          paidAt.setDate(2); // Paid on the 2nd

          await payHistRepo.save(payHistRepo.create({
            tenantId: tid,
            subscriptionId: existingSub.id,
            amount: p.amount,
            currency: 'UF',
            billingPeriod: BillingPeriod.MONTHLY,
            periodStart,
            periodEnd,
            status: p.status,
            paymentMethod: 'Transferencia bancaria',
            transactionRef: `PAY-${now.getFullYear()}${String(periodStart.getMonth() + 1).padStart(2, '0')}-DEMO`,
            paidAt,
          }));
        }

        // Update subscription billing info — lastPaymentDate = 2nd of last month (matches most recent payment)
        existingSub.billingPeriod = BillingPeriod.MONTHLY;
        const lastPayDate = new Date();
        lastPayDate.setMonth(lastPayDate.getMonth() - 1);
        lastPayDate.setDate(2);
        existingSub.lastPaymentDate = lastPayDate;
        existingSub.lastPaymentAmount = 3.5;
        const nextBilling = new Date();
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        nextBilling.setDate(1);
        existingSub.nextBillingDate = nextBilling;
        existingSub.autoRenew = true;
        await subRepo.save(existingSub);

        console.log(`✅ Payment history created: ${payments.length} monthly payments + billing info updated`);
      } else {
        console.log(`   Payments already exist (${existingPayments}), skipping.`);
      }
    }

    /* ── 15. RECOGNITION + GAMIFICATION ─────────────────────────────── */
    const recogRepo = ds.getRepository(Recognition);
    const badgeRepo2 = ds.getRepository(Badge);
    const userBadgeRepo = ds.getRepository(UserBadge);
    const pointsRepo = ds.getRepository(UserPoints);

    const existingRecog = await recogRepo.count({ where: { tenantId: tid } });
    if (existingRecog === 0) {
      // Create badges
      const badgeData = [
        { name: 'Colaborador Estrella', description: 'Recibe 5 reconocimientos', icon: 'star', color: '#f59e0b', criteria: { type: 'recognitions_received', threshold: 5 }, pointsReward: 50 },
        { name: 'Mentor', description: 'Envia 10 reconocimientos a otros', icon: 'brain', color: '#8b5cf6', criteria: { type: 'recognitions_sent', threshold: 10 }, pointsReward: 75 },
        { name: 'Innovador', description: 'Acumula 200 puntos', icon: 'rocket', color: '#3b82f6', criteria: { type: 'total_points', threshold: 200 }, pointsReward: 100 },
        { name: 'Lider Inspirador', description: 'Otorgado por HR por liderazgo excepcional', icon: 'crown', color: '#ec4899', criteria: null, pointsReward: 150 },
        { name: 'Trabajo en Equipo', description: 'Reconocido por colaboracion sobresaliente', icon: 'handshake', color: '#10b981', criteria: null, pointsReward: 60 },
      ];
      const badges: Badge[] = [];
      for (const bd of badgeData) {
        badges.push(await badgeRepo2.save(badgeRepo2.create({ tenantId: tid, ...bd })));
      }
      console.log(`✅ ${badges.length} badges created`);

      // Create recognitions (social wall)
      const competencies = await compRepo.find({ where: { tenantId: tid }, take: 5 });
      const recognitions = [
        { from: allNewUsers[0], to: allNewUsers[1], message: 'Excelente trabajo en el rediseno del dashboard. Tu atencion al detalle hizo toda la diferencia para el cliente.', valueIdx: 0 },
        { from: manager, to: allNewUsers[2], message: 'Gracias por tu dedicacion en la campana de fin de ano. Los resultados superaron todas las expectativas.', valueIdx: 1 },
        { from: allNewUsers[3], to: allNewUsers[0], message: 'Increible presentacion al equipo directivo. Tu capacidad de comunicar ideas complejas es admirable.', valueIdx: 2 },
        { from: allNewUsers[1], to: allNewUsers[4], message: 'Los mockups que preparaste para el cliente nuevo fueron espectaculares. Creatividad pura!', valueIdx: 0 },
        { from: allNewUsers[5], to: manager, message: 'Gracias por el mentorazgo durante este trimestre. Tu guia fue clave para cerrar las metas de ventas.', valueIdx: 3 },
        { from: allNewUsers[4], to: allNewUsers[3], message: 'La API que construiste para el modulo de reportes es impecable. Codigo limpio y bien documentado.', valueIdx: 0 },
        { from: manager, to: allNewUsers[6], message: 'Tu revision de calidad en el ultimo release evito 3 bugs criticos. QA de clase mundial!', valueIdx: 1 },
        { from: allNewUsers[2], to: allNewUsers[5], message: 'Excelente negociacion con el cliente. Lograste renovar el contrato en condiciones favorables para ambos.', valueIdx: 2 },
        { from: allNewUsers[7], to: allNewUsers[3], message: 'Gracias por ayudarme con la configuracion del pipeline de CI/CD. Tu paciencia y conocimiento son invaluables.', valueIdx: 0 },
        { from: allNewUsers[6], to: allNewUsers[7], message: 'La infraestructura que montaste es solida como roca. Cero incidentes en produccion este mes!', valueIdx: 1 },
      ];

      for (let i = 0; i < recognitions.length; i++) {
        const r = recognitions[i];
        if (!r.from || !r.to) continue;
        const saved = await recogRepo.save(recogRepo.create({
          tenantId: tid,
          fromUserId: r.from.id,
          toUserId: r.to.id,
          message: r.message,
          valueId: competencies[r.valueIdx]?.id || null,
          points: 10 + Math.floor(Math.random() * 15),
          isPublic: true,
          reactions: i < 5 ? { '\uD83D\uDC4F': allNewUsers.slice(0, 3).map(u => u.id), '\u2764\uFE0F': allNewUsers.slice(2, 4).map(u => u.id) } : {},
        }));

        // Points for receiver and sender
        await pointsRepo.save(pointsRepo.create({ tenantId: tid, userId: r.to.id, points: saved.points, source: PointsSource.RECOGNITION_RECEIVED, description: 'Reconocimiento recibido', referenceId: saved.id }));
        await pointsRepo.save(pointsRepo.create({ tenantId: tid, userId: r.from.id, points: 2, source: PointsSource.RECOGNITION_SENT, description: 'Reconocimiento enviado', referenceId: saved.id }));
      }
      console.log(`✅ ${recognitions.length} recognitions created with points`);

      // Award some badges
      if (allNewUsers.length >= 3) {
        await userBadgeRepo.save(userBadgeRepo.create({ tenantId: tid, userId: allNewUsers[0].id, badgeId: badges[0].id, awardedBy: null }));
        await pointsRepo.save(pointsRepo.create({ tenantId: tid, userId: allNewUsers[0].id, points: badges[0].pointsReward, source: PointsSource.BADGE_EARNED, description: `Badge: ${badges[0].name}` }));

        await userBadgeRepo.save(userBadgeRepo.create({ tenantId: tid, userId: manager.id, badgeId: badges[3].id, awardedBy: admin.id }));
        await pointsRepo.save(pointsRepo.create({ tenantId: tid, userId: manager.id, points: badges[3].pointsReward, source: PointsSource.BADGE_EARNED, description: `Badge: ${badges[3].name}` }));

        await userBadgeRepo.save(userBadgeRepo.create({ tenantId: tid, userId: allNewUsers[3].id, badgeId: badges[4].id, awardedBy: manager.id }));
        await pointsRepo.save(pointsRepo.create({ tenantId: tid, userId: allNewUsers[3].id, points: badges[4].pointsReward, source: PointsSource.BADGE_EARNED, description: `Badge: ${badges[4].name}` }));
        console.log('✅ 3 badges awarded to demo users');
      }

      // Extra points for completed evaluations/objectives
      for (const u of allNewUsers.slice(0, 5)) {
        await pointsRepo.save(pointsRepo.create({ tenantId: tid, userId: u.id, points: 25, source: PointsSource.EVALUATION_COMPLETED, description: 'Evaluacion completada' }));
        await pointsRepo.save(pointsRepo.create({ tenantId: tid, userId: u.id, points: 15, source: PointsSource.FEEDBACK_GIVEN, description: 'Feedback enviado' }));
      }
      console.log('✅ Extra gamification points seeded');
    } else {
      console.log(`   Recognition data already exists (${existingRecog}), skipping.`);
    }

    /* ── 16. SYSTEM CHANGELOG ────────────────────────────────────────── */
    const changelogRepo = ds.getRepository(SystemChangelog);
    const existingCL = await changelogRepo.count();
    if (existingCL === 0) {
      const entries = [
        { version: '2.5', title: 'Reconocimientos y Gamificacion', description: 'Envia kudos a tus companeros, gana puntos y obten badges por tus logros. Incluye muro social, leaderboard y sistema de recompensas.', type: ChangelogType.FEATURE, publishedAt: daysAgo(2) },
        { version: '2.4', title: 'Dashboard DEI / Diversidad', description: 'Metricas de composicion organizacional, analisis de equidad en evaluaciones y alertas automaticas de sesgo por genero, seniority y edad.', type: ChangelogType.FEATURE, publishedAt: daysAgo(7) },
        { version: '2.3', title: 'Informes Avanzados', description: 'Nuevos reportes: Radar de competencias, Curva de Bell, Mapa de calor por departamento, Gap Analysis individual y de equipo.', type: ChangelogType.FEATURE, publishedAt: daysAgo(14) },
        { version: '2.2', title: 'Versionado de Plantillas', description: 'Las plantillas de evaluacion ahora guardan historial de versiones. Puedes restaurar versiones anteriores en cualquier momento.', type: ChangelogType.IMPROVEMENT, publishedAt: daysAgo(21) },
        { version: '2.1', title: 'OKRs con Key Results', description: 'Los objetivos ahora soportan Key Results formales con valor base, meta, actual y unidad. Incluye alertas de objetivos en riesgo.', type: ChangelogType.FEATURE, publishedAt: daysAgo(30) },
      ];
      for (const e of entries) {
        await changelogRepo.save(changelogRepo.create({ ...e, isActive: true }));
      }
      console.log(`✅ ${entries.length} changelog entries created`);
    } else {
      console.log(`   Changelog entries already exist (${existingCL}), skipping.`);
    }

    /* ── Done ─────────────────────────────────────────────────────────────── */
    console.log('\n🎉 Full demo data seeding complete!');
    console.log('─────────────────────────────────────────');
    console.log('📋 Summary:');
    console.log(`   Users: ${allEvaluable.length} evaluable (1 manager + ${allEmployees.length} employees)`);
    console.log(`   Cycles: 3 (90° closed, 180° closed, 360° active)`);
    console.log('   OKRs: with key results, updates, and comments');
    console.log('   Feedback: 12+ peer feedback entries');
    console.log('   Check-ins: 12+ 1:1 meetings');
    /* ── 12. Engagement Survey (Clima Laboral) ────────────────────────────── */
    const surveyRepo = ds.getRepository(EngagementSurvey);
    const surveyQRepo = ds.getRepository(SurveyQuestion);
    const surveyRRepo = ds.getRepository(SurveyResponse);
    const surveyARepo = ds.getRepository(SurveyAssignment);

    const existingSurvey = await surveyRepo.findOne({ where: { tenantId: tid, title: 'Encuesta de Clima Q1 2026' } });
    if (!existingSurvey) {
      // Create closed survey with full data
      const survey = await surveyRepo.save(surveyRepo.create({
        tenantId: tid,
        title: 'Encuesta de Clima Q1 2026',
        description: 'Encuesta trimestral de clima laboral y satisfaccion organizacional',
        status: 'closed',
        isAnonymous: true,
        targetAudience: 'all',
        targetDepartments: [],
        startDate: daysAgo(45),
        endDate: daysAgo(15),
        createdBy: admin.id,
        settings: {},
        responseCount: 0,
      }));

      // Create questions
      const questionDefs = [
        { category: 'Liderazgo', questionText: 'Mi lider directo me da retroalimentacion constructiva regularmente', questionType: 'likert_5', isRequired: true, sortOrder: 0 },
        { category: 'Comunicacion', questionText: 'La comunicacion interna de la empresa es clara y oportuna', questionType: 'likert_5', isRequired: true, sortOrder: 1 },
        { category: 'Bienestar', questionText: 'Siento que la empresa se preocupa por mi bienestar', questionType: 'likert_5', isRequired: true, sortOrder: 2 },
        { category: 'Cultura', questionText: 'Me siento orgulloso de trabajar en esta empresa', questionType: 'likert_5', isRequired: true, sortOrder: 3 },
        { category: 'Desarrollo', questionText: 'Tengo oportunidades reales de crecimiento profesional aqui', questionType: 'likert_5', isRequired: true, sortOrder: 4 },
        { category: 'Gestion', questionText: 'Tengo los recursos necesarios para hacer bien mi trabajo', questionType: 'likert_5', isRequired: true, sortOrder: 5 },
        { category: 'NPS', questionText: 'Del 0 al 10, que tan probable es que recomiendes esta empresa como lugar de trabajo?', questionType: 'nps', isRequired: true, sortOrder: 6 },
        { category: 'General', questionText: 'Que mejorarias de tu experiencia en la empresa?', questionType: 'open_text', isRequired: false, sortOrder: 7 },
      ];

      const questions = [];
      for (const qd of questionDefs) {
        const q = await surveyQRepo.save(surveyQRepo.create({ surveyId: survey.id, ...qd }));
        questions.push(q);
      }

      // Create assignments and responses for all employees
      const surveyUsers = await userRepo.find({ where: { tenantId: tid, isActive: true } });
      const openTextResponses = [
        'Mejorar la comunicacion entre departamentos',
        'Mas oportunidades de capacitacion tecnica',
        'Flexibilidad en los horarios de trabajo',
        'Mejor equipamiento y herramientas de trabajo',
        'Mas actividades de integracion del equipo',
        'Reconocimiento mas frecuente del trabajo bien hecho',
        'Mejorar la infraestructura de la oficina',
        'Mas claridad en los objetivos del area',
        'Espacios de descanso y bienestar',
        'Programas de desarrollo de carrera claros',
        'Mejor balance vida-trabajo',
        'Transparencia en decisiones organizacionales',
      ];

      let responseCount = 0;
      for (const u of surveyUsers) {
        if (u.role === 'super_admin') continue;
        // 85% response rate
        if (Math.random() > 0.85) continue;

        // Create assignment
        await surveyARepo.save(surveyARepo.create({
          surveyId: survey.id, tenantId: tid, userId: u.id,
          status: 'completed', completedAt: daysAgo(Math.floor(15 + Math.random() * 25)),
        }));

        // Generate answers
        const answers: Array<{ questionId: string; value: number | string }> = [];
        for (const q of questions) {
          if (q.questionType === 'likert_5') {
            // Scores between 2-5, weighted toward 3-4
            answers.push({ questionId: q.id, value: Math.floor(2 + Math.random() * 3.5) });
          } else if (q.questionType === 'nps') {
            // NPS 3-10, weighted toward 6-9
            answers.push({ questionId: q.id, value: Math.floor(3 + Math.random() * 7.5) });
          } else if (q.questionType === 'open_text') {
            if (Math.random() > 0.3) { // 70% respond to open text
              answers.push({ questionId: q.id, value: openTextResponses[Math.floor(Math.random() * openTextResponses.length)] });
            }
          }
        }

        await surveyRRepo.save(surveyRRepo.create({
          surveyId: survey.id, tenantId: tid,
          respondentId: null, // anonymous
          department: u.department || null,
          answers,
          isComplete: true,
          submittedAt: daysAgo(Math.floor(15 + Math.random() * 25)),
        }));
        responseCount++;
      }

      // Update response count
      await surveyRepo.update(survey.id, { responseCount });
      console.log('✅ Climate survey created: ' + responseCount + ' responses from ' + surveyUsers.length + ' users');

      // Also create an active survey (draft for testing)
      const survey2 = await surveyRepo.save(surveyRepo.create({
        tenantId: tid,
        title: 'Encuesta de Clima Q2 2026',
        description: 'Segunda encuesta trimestral del ano',
        status: 'active',
        isAnonymous: true,
        targetAudience: 'all',
        targetDepartments: [],
        startDate: daysAgo(5),
        endDate: daysFromNow(25),
        createdBy: admin.id,
        settings: {},
        responseCount: 0,
      }));

      // Create same questions for survey 2
      for (const qd of questionDefs) {
        await surveyQRepo.save(surveyQRepo.create({ surveyId: survey2.id, ...qd }));
      }

      // Create pending assignments for all users
      for (const u of surveyUsers) {
        if (u.role === 'super_admin') continue;
        await surveyARepo.save(surveyARepo.create({
          surveyId: survey2.id, tenantId: tid, userId: u.id,
          status: 'pending',
        }));
      }
      console.log('✅ Active survey Q2 2026 created with pending assignments');
    } else {
      console.log('   Climate survey already exists, skipping');
    }

    console.log('   Development Plans: 5+ with actions');
    console.log('   Talent: Nine Box assessments for all');
    console.log('   Calibration: 1 completed session');
    console.log('   Role Competencies: positions × competencies (for gap analysis)');
    console.log('   Notifications: 8 demo notifications');
    console.log('   Climate Survey: 1 closed (with responses) + 1 active (pending)');
    console.log('   Subscription: Pro plan (advanced reports enabled)');
    console.log('─────────────────────────────────────────');
    console.log('🔑 Password for ALL users: EvaPro2026!');

  } catch (err) {
    console.error('❌ Full seed failed:', err);
    process.exit(1);
  } finally {
    if (ds.isInitialized) await ds.destroy();
  }
}

void seedDemoFull();
