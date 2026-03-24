/**
 * seed.ts — inserts demo tenant + admin user + sample data on first deploy.
 * Idempotent: checks existence before creating.
 * Run via: pnpm --filter @repo/api run db:seed
 * OR automatically via start:prod: node dist/database/seed.js
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

// ── Phase 1 ────────────────────────────────────────────────────────────────
import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { User } from '../modules/users/entities/user.entity';
import { FormTemplate } from '../modules/templates/entities/form-template.entity';
import { EvaluationCycle, CycleStatus, CycleType } from '../modules/evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment, AssignmentStatus, RelationType } from '../modules/evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../modules/evaluations/entities/evaluation-response.entity';
import { BulkImport } from '../modules/users/entities/bulk-import.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { PeerAssignment } from '../modules/evaluations/entities/peer-assignment.entity';
import { CycleStage } from '../modules/evaluations/entities/cycle-stage.entity';

// ── Phase 2 ────────────────────────────────────────────────────────────────
import { CheckIn } from '../modules/feedback/entities/checkin.entity';
import { QuickFeedback } from '../modules/feedback/entities/quick-feedback.entity';
import { Objective } from '../modules/objectives/entities/objective.entity';
import { ObjectiveUpdate } from '../modules/objectives/entities/objective-update.entity';
import { ObjectiveComment } from '../modules/objectives/entities/objective-comment.entity';
import { KeyResult } from '../modules/objectives/entities/key-result.entity';

// ── Phase 3 ────────────────────────────────────────────────────────────────
import { UserNote } from '../modules/users/entities/user-note.entity';
import { SubscriptionPlan } from '../modules/subscriptions/entities/subscription-plan.entity';
import { Subscription } from '../modules/subscriptions/entities/subscription.entity';

// ── Phase 4 ────────────────────────────────────────────────────────────────
import { TalentAssessment } from '../modules/talent/entities/talent-assessment.entity';
import { CalibrationSession } from '../modules/talent/entities/calibration-session.entity';
import { CalibrationEntry } from '../modules/talent/entities/calibration-entry.entity';

// ── Phase 5 ────────────────────────────────────────────────────────────────
import { Competency } from '../modules/development/entities/competency.entity';
import { DevelopmentPlan } from '../modules/development/entities/development-plan.entity';
import { DevelopmentAction } from '../modules/development/entities/development-action.entity';
import { DevelopmentComment } from '../modules/development/entities/development-comment.entity';

// ── B3: Notifications ─────────────────────────────────────────────────────
import { Notification } from '../modules/notifications/entities/notification.entity';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL not set — cannot seed.');
  process.exit(1);
}

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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
    // B3: Notifications
    Notification,
  ],
  // synchronize:true ensures tables exist before inserting seed data
  // (safe because cleanup-orphans already dropped conflicting tables)
  synchronize: true,
  logging: false,
});

/* ── Demo template definition ─────────────────────────────────────────────── */

const DEMO_TEMPLATE_SECTIONS = [
  {
    id: 'sec1',
    title: 'Competencias Generales',
    questions: [
      {
        id: 'q1',
        text: 'Calidad del trabajo: El colaborador entrega trabajo de alta calidad?',
        type: 'scale',
        scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } },
        required: true,
      },
      {
        id: 'q2',
        text: 'Comunicacion: Se comunica de forma clara y efectiva?',
        type: 'scale',
        scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } },
        required: true,
      },
      {
        id: 'q3',
        text: 'Trabajo en equipo: Colabora efectivamente con otros?',
        type: 'scale',
        scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } },
        required: true,
      },
      {
        id: 'q4',
        text: 'Iniciativa: Propone mejoras y toma accion proactiva?',
        type: 'scale',
        scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } },
        required: true,
      },
    ],
  },
  {
    id: 'sec2',
    title: 'Comentarios',
    questions: [
      {
        id: 'q5',
        text: 'Cuales son las principales fortalezas del colaborador?',
        type: 'text',
        required: true,
      },
      {
        id: 'q6',
        text: 'En que areas podria mejorar?',
        type: 'text',
        required: true,
      },
    ],
  },
];

/* ── System Templates (global, tenantId = null) ────────────────────────── */
const SCALE_LABELS = { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' };
const scale = () => ({ min: 1, max: 5, labels: SCALE_LABELS });

const SYSTEM_TEMPLATES = [
  {
    name: 'Evaluaci\u00f3n de Liderazgo',
    description: 'Plantilla para evaluar competencias de liderazgo y gesti\u00f3n de equipos. Ideal para encargados y gerentes.',
    sections: [
      { id: 'lid1', title: 'Visi\u00f3n Estrat\u00e9gica', questions: [
        { id: 'l1', text: 'Define objetivos claros y alineados con la estrategia de la organizaci\u00f3n', type: 'scale', scale: scale(), required: true },
        { id: 'l2', text: 'Anticipa riesgos y oportunidades del entorno', type: 'scale', scale: scale(), required: true },
        { id: 'l3', text: 'Comunica la visi\u00f3n de forma inspiradora al equipo', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'lid2', title: 'Gesti\u00f3n de Personas', questions: [
        { id: 'l4', text: 'Delega responsabilidades de forma efectiva', type: 'scale', scale: scale(), required: true },
        { id: 'l5', text: 'Desarrolla el talento de sus colaboradores', type: 'scale', scale: scale(), required: true },
        { id: 'l6', text: 'Gestiona conflictos de manera constructiva', type: 'scale', scale: scale(), required: true },
        { id: 'l7', text: 'Reconoce y valora los logros del equipo', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'lid3', title: 'Toma de Decisiones', questions: [
        { id: 'l8', text: 'Toma decisiones oportunas basadas en datos', type: 'scale', scale: scale(), required: true },
        { id: 'l9', text: 'Asume responsabilidad por los resultados', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'lid4', title: 'Comentarios de Liderazgo', questions: [
        { id: 'l10', text: '\u00bfCu\u00e1l es la mayor fortaleza de liderazgo de esta persona?', type: 'text', required: true },
        { id: 'l11', text: '\u00bfQu\u00e9 acci\u00f3n concreta mejorar\u00eda su liderazgo?', type: 'text', required: true },
      ]},
    ],
  },
  {
    name: 'Evaluaci\u00f3n T\u00e9cnica',
    description: 'Plantilla para evaluar competencias t\u00e9cnicas y espec\u00edficas del cargo. Para roles operativos y especialistas.',
    sections: [
      { id: 'tec1', title: 'Conocimiento T\u00e9cnico', questions: [
        { id: 't1', text: 'Domina las herramientas y tecnolog\u00edas requeridas por el cargo', type: 'scale', scale: scale(), required: true },
        { id: 't2', text: 'Se mantiene actualizado en su \u00e1rea de especialidad', type: 'scale', scale: scale(), required: true },
        { id: 't3', text: 'Aplica mejores pr\u00e1cticas y est\u00e1ndares de la industria', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'tec2', title: 'Resoluci\u00f3n de Problemas', questions: [
        { id: 't4', text: 'Identifica la causa ra\u00edz de los problemas t\u00e9cnicos', type: 'scale', scale: scale(), required: true },
        { id: 't5', text: 'Propone soluciones innovadoras y eficientes', type: 'scale', scale: scale(), required: true },
        { id: 't6', text: 'Documenta su trabajo y comparte conocimiento', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'tec3', title: 'Productividad', questions: [
        { id: 't7', text: 'Cumple con los plazos comprometidos', type: 'scale', scale: scale(), required: true },
        { id: 't8', text: 'La calidad de sus entregables es consistente', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'tec4', title: 'Comentarios T\u00e9cnicos', questions: [
        { id: 't9', text: '\u00bfEn qu\u00e9 \u00e1rea t\u00e9cnica destaca m\u00e1s?', type: 'text', required: true },
        { id: 't10', text: '\u00bfQu\u00e9 capacitaci\u00f3n o certificaci\u00f3n le beneficiar\u00eda?', type: 'text', required: false },
      ]},
    ],
  },
  {
    name: 'Evaluaci\u00f3n 360\u00b0 Completa',
    description: 'Plantilla integral para evaluaci\u00f3n 360\u00b0 que cubre competencias transversales, liderazgo, trabajo en equipo y desarrollo profesional.',
    sections: [
      { id: '360a', title: 'Competencias Transversales', questions: [
        { id: 'f1', text: 'Se comunica de forma clara y respetuosa', type: 'scale', scale: scale(), required: true },
        { id: 'f2', text: 'Colabora efectivamente con personas de distintas \u00e1reas', type: 'scale', scale: scale(), required: true },
        { id: 'f3', text: 'Demuestra integridad y \u00e9tica profesional', type: 'scale', scale: scale(), required: true },
        { id: 'f4', text: 'Se adapta positivamente a los cambios', type: 'scale', scale: scale(), required: true },
      ]},
      { id: '360b', title: 'Orientaci\u00f3n a Resultados', questions: [
        { id: 'f5', text: 'Cumple sus compromisos y metas asignadas', type: 'scale', scale: scale(), required: true },
        { id: 'f6', text: 'Prioriza actividades seg\u00fan impacto organizacional', type: 'scale', scale: scale(), required: true },
        { id: 'f7', text: 'Busca continuamente mejorar sus procesos de trabajo', type: 'scale', scale: scale(), required: true },
      ]},
      { id: '360c', title: 'Desarrollo y Aprendizaje', questions: [
        { id: 'f8', text: 'Busca activamente oportunidades de aprendizaje', type: 'scale', scale: scale(), required: true },
        { id: 'f9', text: 'Acepta y aplica retroalimentaci\u00f3n constructiva', type: 'scale', scale: scale(), required: true },
        { id: 'f10', text: 'Comparte conocimiento con sus compa\u00f1eros', type: 'scale', scale: scale(), required: true },
      ]},
      { id: '360d', title: 'Retroalimentaci\u00f3n Abierta', questions: [
        { id: 'f11', text: '\u00bfCu\u00e1les son las 3 principales fortalezas de esta persona?', type: 'text', required: true },
        { id: 'f12', text: '\u00bfQu\u00e9 deber\u00eda dejar de hacer o cambiar?', type: 'text', required: true },
        { id: 'f13', text: '\u00bfQu\u00e9 consejo le dar\u00edas para su desarrollo profesional?', type: 'text', required: false },
      ]},
    ],
  },
  {
    name: 'Evaluaci\u00f3n de Servicio al Cliente',
    description: 'Plantilla para evaluar competencias de atenci\u00f3n y servicio. Para roles de soporte, ventas y atenci\u00f3n al p\u00fablico.',
    sections: [
      { id: 'srv1', title: 'Atenci\u00f3n al Cliente', questions: [
        { id: 's1', text: 'Atiende a los clientes con amabilidad y empat\u00eda', type: 'scale', scale: scale(), required: true },
        { id: 's2', text: 'Resuelve consultas de forma r\u00e1pida y efectiva', type: 'scale', scale: scale(), required: true },
        { id: 's3', text: 'Maneja quejas y reclamos con profesionalismo', type: 'scale', scale: scale(), required: true },
        { id: 's4', text: 'Supera las expectativas del cliente', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'srv2', title: 'Conocimiento del Producto/Servicio', questions: [
        { id: 's5', text: 'Domina las caracter\u00edsticas de los productos/servicios', type: 'scale', scale: scale(), required: true },
        { id: 's6', text: 'Identifica oportunidades de venta o mejora', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'srv3', title: 'Comentarios de Servicio', questions: [
        { id: 's7', text: '\u00bfQu\u00e9 hace bien esta persona al atender clientes?', type: 'text', required: true },
        { id: 's8', text: '\u00bfC\u00f3mo podr\u00eda mejorar la experiencia del cliente?', type: 'text', required: true },
      ]},
    ],
  },
];

/* ── Helper: calculate score on 0-10 scale (1-5 scale answers) ──────────── */
function calcScore(answers: Record<string, any>): number {
  const vals: number[] = [];
  for (const v of Object.values(answers)) {
    if (typeof v === 'number' && !isNaN(v)) vals.push(v);
  }
  if (vals.length === 0) return 0;
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return Math.round(((avg / 5) * 10) * 100) / 100;
}

async function seed() {
  try {
    console.log('🌱  Connecting to database for seeding...');
    await dataSource.initialize();

    const tenantRepo = dataSource.getRepository(Tenant);
    const userRepo = dataSource.getRepository(User);
    const templateRepo = dataSource.getRepository(FormTemplate);
    const cycleRepo = dataSource.getRepository(EvaluationCycle);
    const assignmentRepo = dataSource.getRepository(EvaluationAssignment);
    const responseRepo = dataSource.getRepository(EvaluationResponse);
    const planRepo = dataSource.getRepository(SubscriptionPlan);
    const subRepo = dataSource.getRepository(Subscription);
    const compRepo = dataSource.getRepository(Competency);

    /* ── Tenant ──────────────────────────────────────────────────────────── */
    let tenant = await tenantRepo.findOne({ where: { slug: 'demo' } });
    if (tenant) {
      if (!tenant.rut) {
        tenant.rut = '76123456-0';
        await tenantRepo.save(tenant);
        console.log('   Tenant "demo" updated with RUT 76123456-0');
      } else {
        console.log('   Tenant "demo" already exists.');
      }
    } else {
      tenant = tenantRepo.create({
        name: 'Demo Company',
        slug: 'demo',
        rut: '76123456-0',
        plan: 'starter',
        ownerType: 'company',
        maxEmployees: 50,
        isActive: true,
        settings: {},
      });
      tenant = await tenantRepo.save(tenant);
      console.log(`\u2705  Tenant created: ${tenant.name} (${tenant.id})`);
    }

    /* ── Subscription Plans + Demo Subscription ──────────────────────────── */
    let starterPlan = await planRepo.findOne({ where: { code: 'starter' } });
    if (!starterPlan) {
      starterPlan = planRepo.create({
        name: 'Starter', code: 'starter',
        description: 'Plan gratuito para comenzar',
        maxEmployees: 50, monthlyPrice: 0,
        features: ['Evaluaciones 90/180', 'Hasta 50 usuarios', 'Reportes basicos'],
        isActive: true, displayOrder: 1,
      });
      starterPlan = await planRepo.save(starterPlan);
      console.log('\u2705  Plan "Starter" created');

      await planRepo.save(planRepo.create({
        name: 'Pro', code: 'pro',
        description: 'Plan profesional con todas las evaluaciones',
        maxEmployees: 200, monthlyPrice: 49,
        features: ['Evaluaciones 360', 'Hasta 200 usuarios', 'Analytics', 'Calibracion', 'Nine Box'],
        isActive: true, displayOrder: 2,
      }));
      await planRepo.save(planRepo.create({
        name: 'Enterprise', code: 'enterprise',
        description: 'Plan empresarial sin limites',
        maxEmployees: 9999, monthlyPrice: 199,
        features: ['Todo incluido', 'Usuarios ilimitados', 'IA', 'Soporte dedicado', 'API'],
        isActive: true, displayOrder: 3,
      }));
      console.log('\u2705  Plans "Pro" and "Enterprise" created');
    }

    let subscription = await subRepo.findOne({ where: { tenantId: tenant.id } });
    if (!subscription) {
      subscription = subRepo.create({
        tenantId: tenant.id,
        planId: starterPlan.id,
        status: 'active',
        startDate: new Date(),
      });
      await subRepo.save(subscription);
      console.log('\u2705  Subscription created for demo tenant (Starter plan)');
    } else {
      console.log('   Subscription already exists for demo tenant.');
    }

    /* ── Super Admin ─────────────────────────────────────────────────────── */
    let superAdmin = await userRepo.findOne({
      where: { email: 'superadmin@evapro.demo', tenantId: tenant.id },
    });
    if (!superAdmin) {
      const pwHash = await bcrypt.hash('EvaPro2026!', 10);
      superAdmin = userRepo.create({
        email: 'superadmin@evapro.demo', passwordHash: pwHash,
        firstName: 'Super', lastName: 'Admin',
        role: 'super_admin', department: 'Tecnologia', position: 'Super Administrador',
        isActive: true, tenantId: tenant.id,
      });
      superAdmin = await userRepo.save(superAdmin);
      console.log('\u2705  Super Admin created: superadmin@evapro.demo');
    }

    /* ── Tenant Admin ────────────────────────────────────────────────────── */
    let admin = await userRepo.findOne({
      where: { email: 'admin@evapro.demo', tenantId: tenant.id },
    });
    if (!admin) {
      const passwordHash = await bcrypt.hash('EvaPro2026!', 10);
      admin = userRepo.create({
        email: 'admin@evapro.demo', passwordHash,
        firstName: 'Admin', lastName: 'EvaPro',
        role: 'tenant_admin', department: 'Recursos Humanos', position: 'Encargado del Sistema',
        isActive: true, tenantId: tenant.id,
      });
      admin = await userRepo.save(admin);
      console.log('\u2705  Admin created: admin@evapro.demo');
    }

    /* ── Manager ─────────────────────────────────────────────────────────── */
    let manager = await userRepo.findOne({
      where: { email: 'carlos.lopez@evapro.demo', tenantId: tenant.id },
    });
    if (!manager) {
      const pwHash = await bcrypt.hash('EvaPro2026!', 10);
      manager = userRepo.create({
        email: 'carlos.lopez@evapro.demo', passwordHash: pwHash,
        firstName: 'Carlos', lastName: 'Lopez',
        role: 'manager', department: 'Producto', position: 'Product Manager',
        isActive: true, tenantId: tenant.id,
      });
      manager = await userRepo.save(manager);
      console.log('\u2705  Manager created: carlos.lopez@evapro.demo');
    }

    /* ── Employees ───────────────────────────────────────────────────────── */
    const employeeDefs = [
      { email: 'ana.martinez@evapro.demo', firstName: 'Ana', lastName: 'Martinez', department: 'Diseno', position: 'UX Designer' },
      { email: 'luis.rodriguez@evapro.demo', firstName: 'Luis', lastName: 'Rodriguez', department: 'DevOps', position: 'DevOps Engineer' },
      { email: 'sandra.torres@evapro.demo', firstName: 'Sandra', lastName: 'Torres', department: 'QA', position: 'QA Analyst' },
    ];

    const empUsers: User[] = [];
    for (const emp of employeeDefs) {
      let user = await userRepo.findOne({ where: { email: emp.email, tenantId: tenant.id } });
      if (!user) {
        const pwHash = await bcrypt.hash('EvaPro2026!', 10);
        user = await userRepo.save(
          userRepo.create({ ...emp, passwordHash: pwHash, role: 'employee', isActive: true, tenantId: tenant.id, managerId: manager.id }),
        );
        console.log(`\u2705  Employee created: ${emp.email}`);
      }
      empUsers.push(user);
    }

    // Ensure ASCII-safe names (fix any old encoding issues)
    const nameFixMap: Record<string, { firstName: string; lastName: string; department: string; position: string }> = {
      'carlos.lopez@evapro.demo': { firstName: 'Carlos', lastName: 'Lopez', department: 'Producto', position: 'Product Manager' },
      'ana.martinez@evapro.demo': { firstName: 'Ana', lastName: 'Martinez', department: 'Diseno', position: 'UX Designer' },
      'luis.rodriguez@evapro.demo': { firstName: 'Luis', lastName: 'Rodriguez', department: 'DevOps', position: 'DevOps Engineer' },
      'sandra.torres@evapro.demo': { firstName: 'Sandra', lastName: 'Torres', department: 'QA', position: 'QA Analyst' },
      'admin@evapro.demo': { firstName: 'Admin', lastName: 'EvaPro', department: 'Recursos Humanos', position: 'Encargado del Sistema' },
      'superadmin@evapro.demo': { firstName: 'Super', lastName: 'Admin', department: 'Sistemas', position: 'Super Administrador' },
    };
    for (const [email, fix] of Object.entries(nameFixMap)) {
      const user = await userRepo.findOne({ where: { email, tenantId: tenant.id } });
      if (user) {
        let changed = false;
        if (user.firstName !== fix.firstName) { user.firstName = fix.firstName; changed = true; }
        if (user.lastName !== fix.lastName) { user.lastName = fix.lastName; changed = true; }
        if (user.department !== fix.department) { user.department = fix.department; changed = true; }
        if (user.position !== fix.position) { user.position = fix.position; changed = true; }
        if (changed) { await userRepo.save(user); console.log(`   Fixed data for: ${email}`); }
      }
    }

    /* ── Default Template ────────────────────────────────────────────────── */
    let template = await templateRepo.findOne({
      where: { name: 'Competencias Generales', tenantId: tenant.id },
    });
    if (!template) {
      template = await templateRepo.save(
        templateRepo.create({
          tenantId: tenant.id,
          name: 'Competencias Generales',
          description: 'Plantilla estandar de evaluacion con competencias laborales basicas y espacio para comentarios.',
          sections: DEMO_TEMPLATE_SECTIONS,
          isDefault: true,
          createdBy: admin.id,
        }),
      );
      console.log('\u2705  Default template created: Competencias Generales');
    }

    /* ── System Templates (global, available to all tenants) ───────────── */
    for (const tpl of SYSTEM_TEMPLATES) {
      const exists = await templateRepo.findOne({ where: { name: tpl.name, tenantId: tenant.id } });
      if (!exists) {
        await templateRepo.save(templateRepo.create({
          tenantId: tenant.id,
          name: tpl.name,
          description: tpl.description,
          sections: tpl.sections,
          isDefault: false,
          createdBy: admin.id,
        }));
        console.log(`\u2705  System template created: ${tpl.name}`);
      }
    }

    /* ── Competencias por defecto ─────────────────────────────────────────── */
    const existingComps = await compRepo.count({ where: { tenantId: tenant.id } });
    if (existingComps === 0) {
      const defaultCompetencies = [
        { name: 'Liderazgo', category: 'Gestion', description: 'Capacidad de guiar, motivar e inspirar a equipos hacia el logro de objetivos' },
        { name: 'Comunicacion', category: 'Blanda', description: 'Habilidad para transmitir ideas de forma clara, efectiva y asertiva' },
        { name: 'Trabajo en equipo', category: 'Blanda', description: 'Capacidad de colaborar y contribuir activamente al logro colectivo' },
        { name: 'Resolucion de problemas', category: 'Tecnica', description: 'Habilidad para analizar situaciones complejas y encontrar soluciones efectivas' },
        { name: 'Adaptabilidad', category: 'Blanda', description: 'Flexibilidad para ajustarse a cambios y nuevas situaciones' },
        { name: 'Orientacion a resultados', category: 'Gestion', description: 'Enfoque en cumplir objetivos y metas con calidad y eficiencia' },
        { name: 'Conocimiento tecnico', category: 'Tecnica', description: 'Dominio de las herramientas, tecnologias y procesos del area' },
        { name: 'Creatividad e innovacion', category: 'Blanda', description: 'Capacidad de generar ideas nuevas y proponer mejoras' },
      ];
      for (const c of defaultCompetencies) {
        await compRepo.save(compRepo.create({ ...c, tenantId: tenant.id, isActive: true }));
      }
      console.log(`\u2705  Default competencies created (${defaultCompetencies.length})`);
    }

    /* ── Demo Evaluation Cycle (Q1 2026, closed) ─────────────────────────── */
    // Only create if no closed cycle exists yet
    const existingClosedCycle = await cycleRepo.findOne({
      where: { tenantId: tenant.id, status: CycleStatus.CLOSED },
    });

    if (!existingClosedCycle) {
      const [ana, luis, sandra] = empUsers;

      // Create closed cycle
      const cycle = await cycleRepo.save(
        cycleRepo.create({
          tenantId: tenant.id,
          name: 'Q1 2026 - Evaluacion de Desempeno',
          type: CycleType.DEGREE_90,
          status: CycleStatus.CLOSED,
          startDate: new Date('2026-01-06'),
          endDate: new Date('2026-03-14'),
          templateId: template.id,
          totalEvaluated: 4,
          createdBy: admin.id,
          settings: {},
        }),
      );
      console.log(`\u2705  Demo cycle created: ${cycle.name}`);

      // Helper: create assignment + response
      const createCompleted = async (
        evaluateeId: string,
        evaluatorId: string,
        relationType: string,
        answers: Record<string, any>,
        completedDaysAgo: number,
      ) => {
        const completedAt = new Date();
        completedAt.setDate(completedAt.getDate() - completedDaysAgo);
        const overallScore = calcScore(answers);

        const assignment = await assignmentRepo.save(
          assignmentRepo.create({
            tenantId: tenant.id,
            cycleId: cycle.id,
            evaluateeId,
            evaluatorId,
            relationType: relationType as RelationType,
            status: AssignmentStatus.COMPLETED,
            dueDate: new Date('2026-03-14'),
            completedAt,
          }),
        );

        await responseRepo.save(
          responseRepo.create({
            tenantId: tenant.id,
            assignmentId: assignment.id,
            answers,
            overallScore,
            submittedAt: completedAt,
          }),
        );

        return overallScore;
      };

      // ── Ana Martinez (UX Designer) — Destacada ─────────────────────────
      // Self-evaluation: avg(4+5+4+4)/4 = 4.25 → 8.5
      await createCompleted(ana.id, ana.id, 'self',
        { q1: 4, q2: 5, q3: 4, q4: 4, q5: 'Calidad de diseno y atencion al detalle', q6: 'Mejorar velocidad de entrega' }, 20);
      // Manager evaluation: avg(4+4+5+4)/4 = 4.25 → 8.5
      await createCompleted(ana.id, manager.id, 'manager',
        { q1: 4, q2: 4, q3: 5, q4: 4, q5: 'Gran colaboradora y proactiva', q6: 'Liderar mas iniciativas' }, 18);

      // ── Luis Rodriguez (DevOps) — Competente ──────────────────────────
      // Self: avg(3+4+3+3)/4 = 3.25 → 6.5
      await createCompleted(luis.id, luis.id, 'self',
        { q1: 3, q2: 4, q3: 3, q4: 3, q5: 'Buen trabajo tecnico y analitico', q6: 'Mejorar documentacion' }, 19);
      // Manager: avg(3+3+4+3)/4 = 3.25 → 6.5
      await createCompleted(luis.id, manager.id, 'manager',
        { q1: 3, q2: 3, q3: 4, q4: 3, q5: 'Tecnico solido y confiable', q6: 'Comunicacion con el equipo' }, 17);

      // ── Sandra Torres (QA) — Excepcional ──────────────────────────────
      // Self: avg(5+4+5+4)/4 = 4.5 → 9.0
      await createCompleted(sandra.id, sandra.id, 'self',
        { q1: 5, q2: 4, q3: 5, q4: 4, q5: 'Cobertura de pruebas exhaustiva', q6: 'Aprender nuevas herramientas de automatizacion' }, 21);
      // Manager: avg(5+5+5+4)/4 = 4.75 → 9.5
      await createCompleted(sandra.id, manager.id, 'manager',
        { q1: 5, q2: 5, q3: 5, q4: 4, q5: 'Calidad extraordinaria, referente del equipo', q6: 'Podria hacer mentoring a otros' }, 19);

      // ── Carlos Lopez (Manager) — Destacado ────────────────────────────
      // Self: avg(4+4+4+4)/4 = 4.0 → 8.0
      await createCompleted(manager.id, manager.id, 'self',
        { q1: 4, q2: 4, q3: 4, q4: 4, q5: 'Buen liderazgo y manejo del equipo', q6: 'Delegar mas y confiar en el equipo' }, 22);
      // Admin evaluates manager: avg(4+4+4+4)/4 = 4.0 → 8.0
      await createCompleted(manager.id, admin.id, 'manager',
        { q1: 4, q2: 4, q3: 4, q4: 4, q5: 'Conduce bien al equipo hacia los objetivos', q6: 'Mejorar comunicacion hacia arriba' }, 20);

      console.log('\u2705  Demo evaluation data created (cycle Q1 2026, 8 assignments, all completed)');
      console.log('   Scores: Ana=8.5, Luis=6.5, Sandra=9.25 avg, Carlos=8.0');
    } else {
      console.log('   Closed cycle already exists — skipping demo evaluation creation.');

      // Still recalculate any null scores in existing responses
      const allResponses = await responseRepo.find();
      let recalcCount = 0;
      for (const resp of allResponses) {
        if (!resp.answers || typeof resp.answers !== 'object') continue;
        const numericValues: number[] = [];
        for (const v of Object.values(resp.answers)) {
          if (typeof v === 'number' && !isNaN(v)) numericValues.push(v);
          else if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) {
            const n = Number(v);
            if (n >= 1 && n <= 10) numericValues.push(n);
          }
        }
        if (numericValues.length === 0) continue;
        const avg = numericValues.reduce((s, v) => s + v, 0) / numericValues.length;
        const newScore = Math.round(((avg / 5) * 10) * 100) / 100;
        if (resp.overallScore !== newScore) {
          resp.overallScore = newScore;
          await responseRepo.save(resp);
          recalcCount++;
        }
      }
      if (recalcCount > 0) {
        console.log(`   Recalculated ${recalcCount} scores to 0-10 scale`);
      }
    }

    console.log('\n\ud83d\udccb  Demo credentials (password: EvaPro2026!):');
    console.log('   Super Admin:       superadmin@evapro.demo');
    console.log('   Enc. del Sistema:  admin@evapro.demo');
    console.log('   Enc. de Equipo:    carlos.lopez@evapro.demo');
    console.log('   Colaboradores:     ana.martinez, luis.rodriguez, sandra.torres @evapro.demo');

  } catch (err) {
    console.error('\u274c  Seed failed:', err);
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

void seed();
