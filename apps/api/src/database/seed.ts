/**
 * seed.ts — inserts demo tenant + admin user + sample data on first deploy.
 * Run via: pnpm --filter @repo/api run db:seed
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { User } from '../modules/users/entities/user.entity';
import { FormTemplate } from '../modules/templates/entities/form-template.entity';
import { EvaluationCycle } from '../modules/evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment } from '../modules/evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../modules/evaluations/entities/evaluation-response.entity';
import { BulkImport } from '../modules/users/entities/bulk-import.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { SubscriptionPlan } from '../modules/subscriptions/entities/subscription-plan.entity';
import { Subscription } from '../modules/subscriptions/entities/subscription.entity';
import { Competency } from '../modules/development/entities/competency.entity';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL not set — cannot seed.');
  process.exit(1);
}

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  entities: [
    Tenant, User, FormTemplate, EvaluationCycle,
    EvaluationAssignment, EvaluationResponse, BulkImport, AuditLog,
    SubscriptionPlan, Subscription, Competency,
  ],
  synchronize: false,
  logging: false,
});

/* ── Demo data ─────────────────────────────────────── */

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

async function seed() {
  try {
    console.log('🌱  Connecting to database for seeding…');
    await dataSource.initialize();

    const tenantRepo = dataSource.getRepository(Tenant);
    const userRepo = dataSource.getRepository(User);
    const templateRepo = dataSource.getRepository(FormTemplate);

    /* ── Tenant ─────────────────────────────────────────── */
    let tenant = await tenantRepo.findOne({ where: { slug: 'demo' } });
    if (tenant) {
      // Update RUT if missing
      if (!tenant.rut) {
        tenant.rut = '76123456-0';
        await tenantRepo.save(tenant);
        console.log('   Tenant "demo" updated with RUT 76123456-0');
      } else {
        console.log('   Tenant "demo" already exists — skipping.');
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
      console.log(`✅  Tenant created: ${tenant.name} (${tenant.id})`);
    }

    /* ── Default Plan + Subscription ──────────────────────── */
    const planRepo = dataSource.getRepository(SubscriptionPlan);
    const subRepo = dataSource.getRepository(Subscription);

    let starterPlan = await planRepo.findOne({ where: { code: 'starter' } });
    if (!starterPlan) {
      starterPlan = planRepo.create({
        name: 'Starter',
        code: 'starter',
        description: 'Plan gratuito para comenzar',
        maxEmployees: 50,
        monthlyPrice: 0,
        features: ['Evaluaciones 90/180', 'Hasta 50 usuarios', 'Reportes basicos'],
        isActive: true,
        displayOrder: 1,
      });
      starterPlan = await planRepo.save(starterPlan);
      console.log('✅  Plan "Starter" created');

      // Create Pro and Enterprise plans too
      await planRepo.save(planRepo.create({
        name: 'Pro', code: 'pro', description: 'Plan profesional con todas las evaluaciones',
        maxEmployees: 200, monthlyPrice: 49, features: ['Evaluaciones 360', 'Hasta 200 usuarios', 'Analytics', 'Calibracion', 'Nine Box'],
        isActive: true, displayOrder: 2,
      }));
      await planRepo.save(planRepo.create({
        name: 'Enterprise', code: 'enterprise', description: 'Plan empresarial sin limites',
        maxEmployees: 9999, monthlyPrice: 199, features: ['Todo incluido', 'Usuarios ilimitados', 'IA', 'Soporte dedicado', 'API'],
        isActive: true, displayOrder: 3,
      }));
      console.log('✅  Plans "Pro" and "Enterprise" created');
    }

    // Ensure tenant has an active subscription
    let subscription = await subRepo.findOne({ where: { tenantId: tenant.id } });
    if (!subscription) {
      subscription = subRepo.create({
        tenantId: tenant.id,
        planId: starterPlan.id,
        status: 'active',
        startDate: new Date(),
      });
      await subRepo.save(subscription);
      console.log('✅  Subscription created for demo tenant (Starter plan)');
    } else {
      console.log('   Subscription already exists for demo tenant — skipping.');
    }

    /* ── Super Admin ────────────────────────────────────── */
    let superAdmin = await userRepo.findOne({
      where: { email: 'superadmin@evapro.demo', tenantId: tenant.id },
    });
    if (superAdmin) {
      console.log('   User "superadmin@evapro.demo" already exists — skipping.');
    } else {
      const pwHash = await bcrypt.hash('EvaPro2026!', 10);
      superAdmin = userRepo.create({
        email: 'superadmin@evapro.demo',
        passwordHash: pwHash,
        firstName: 'Super',
        lastName: 'Admin',
        role: 'super_admin',
        department: 'Tecnologia',
        position: 'Super Administrador',
        isActive: true,
        tenantId: tenant.id,
      });
      superAdmin = await userRepo.save(superAdmin);
      console.log('✅  Super Admin created: superadmin@evapro.demo');
    }

    /* ── Admin User (Encargado del Sistema) ───────────── */
    let admin = await userRepo.findOne({
      where: { email: 'admin@evapro.demo', tenantId: tenant.id },
    });
    if (admin) {
      console.log('   User "admin@evapro.demo" already exists — skipping.');
    } else {
      const passwordHash = await bcrypt.hash('EvaPro2026!', 10);
      admin = userRepo.create({
        email: 'admin@evapro.demo',
        passwordHash,
        firstName: 'Admin',
        lastName: 'EvaPro',
        role: 'tenant_admin',
        department: 'Recursos Humanos',
        position: 'Encargado del Sistema',
        isActive: true,
        tenantId: tenant.id,
      });
      admin = await userRepo.save(admin);
      console.log(`✅  Admin created: admin@evapro.demo`);
    }

    /* ── Manager ────────────────────────────────────────── */
    let manager = await userRepo.findOne({
      where: { email: 'carlos.lopez@evapro.demo', tenantId: tenant.id },
    });
    if (!manager) {
      const pwHash = await bcrypt.hash('EvaPro2026!', 10);
      manager = userRepo.create({
        email: 'carlos.lopez@evapro.demo',
        passwordHash: pwHash,
        firstName: 'Carlos',
        lastName: 'Lopez',
        role: 'manager',
        department: 'Producto',
        position: 'Product Manager',
        isActive: true,
        tenantId: tenant.id,
      });
      manager = await userRepo.save(manager);
      console.log('✅  Manager created: carlos.lopez@evapro.demo');
    }

    /* ── Employees ──────────────────────────────────────── */
    const employees = [
      { email: 'ana.martinez@evapro.demo', firstName: 'Ana', lastName: 'Martinez', department: 'Diseno', position: 'UX Designer' },
      { email: 'luis.rodriguez@evapro.demo', firstName: 'Luis', lastName: 'Rodriguez', department: 'DevOps', position: 'DevOps Engineer' },
      { email: 'sandra.torres@evapro.demo', firstName: 'Sandra', lastName: 'Torres', department: 'QA', position: 'QA Analyst' },
    ];

    for (const emp of employees) {
      const exists = await userRepo.findOne({
        where: { email: emp.email, tenantId: tenant.id },
      });
      if (!exists) {
        const pwHash = await bcrypt.hash('EvaPro2026!', 10);
        await userRepo.save(
          userRepo.create({
            ...emp,
            passwordHash: pwHash,
            role: 'employee',
            isActive: true,
            tenantId: tenant.id,
            managerId: manager.id,
          }),
        );
        console.log(`✅  Employee created: ${emp.email}`);
      }
    }

    /* ── Fix encoding for existing users ─────────────────── */
    // Use ASCII-safe names to avoid double-encoding issues
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
        if (changed) {
          await userRepo.save(user);
          console.log(`   Fixed data for: ${email}`);
        }
      }
    }

    /* ── Default Template ───────────────────────────────── */
    const existingTemplate = await templateRepo.findOne({
      where: { name: 'Competencias Generales', tenantId: tenant.id },
    });
    if (!existingTemplate) {
      await templateRepo.save(
        templateRepo.create({
          tenantId: tenant.id,
          name: 'Competencias Generales',
          description: 'Plantilla estandar de evaluacion con competencias laborales basicas y espacio para comentarios.',
          sections: DEMO_TEMPLATE_SECTIONS,
          isDefault: true,
          createdBy: admin.id,
        }),
      );
      console.log('✅  Default template created: Competencias Generales');
    }

    /* ── Default Competencies ────────────────────────────── */
    const compRepo = dataSource.getRepository(Competency);
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
      console.log('   Default competencies created (8)');
    }

    /* ── Recalculate all scores to 0-10 scale ──────────── */
    const responseRepo = dataSource.getRepository(EvaluationResponse);
    const allResponses = await responseRepo.find();
    let recalcCount = 0;
    for (const resp of allResponses) {
      if (!resp.answers || typeof resp.answers !== 'object') continue;

      // Extract numeric values (handle both number and string-number types)
      const numericValues: number[] = [];
      for (const v of Object.values(resp.answers)) {
        if (typeof v === 'number' && !isNaN(v)) {
          numericValues.push(v);
        } else if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) {
          const n = Number(v);
          // Only include if it looks like a scale answer (1-5 or 1-10)
          if (n >= 1 && n <= 10) numericValues.push(n);
        }
      }

      console.log(`   Response ${resp.id}: answers=${JSON.stringify(resp.answers)}, numericValues=[${numericValues}], currentScore=${resp.overallScore}`);

      if (numericValues.length === 0) {
        // If there are no numeric values but the response was submitted, set a default
        if (resp.submittedAt && resp.overallScore === null) {
          console.log(`   WARNING: Response ${resp.id} was submitted but has no numeric answers`);
        }
        continue;
      }

      const avg = numericValues.reduce((sum: number, v: number) => sum + v, 0) / numericValues.length;
      // Normalize to 0-10 scale (scale questions are 1-5)
      const newScore = Math.round(((avg / 5) * 10) * 100) / 100;
      const oldScore = resp.overallScore != null ? Number(resp.overallScore) : null;

      // Always update: force recalculation
      resp.overallScore = newScore;
      await responseRepo.save(resp);
      recalcCount++;
      console.log(`   Recalculated: ${resp.id}: ${oldScore} -> ${newScore} (avg=${avg.toFixed(2)} from ${numericValues.length} values)`);
    }
    if (recalcCount > 0) {
      console.log(`   Recalculated ${recalcCount} evaluation scores to 0-10 scale`);
    } else if (allResponses.length === 0) {
      console.log('   No evaluation responses found to recalculate.');
    } else {
      console.log('   No numeric answers found in responses — scores may need manual review.');
    }

    console.log('\n📋  Demo credentials (empresa: demo, password: EvaPro2026!):');
    console.log('   Super Admin:          superadmin@evapro.demo');
    console.log('   Enc. del Sistema:     admin@evapro.demo');
    console.log('   Enc. de Equipo:       carlos.lopez@evapro.demo');
    console.log('   Colaboradores:        ana.martinez, luis.rodriguez, sandra.torres @evapro.demo');
  } catch (err) {
    console.error('❌  Seed failed:', err);
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

void seed();
