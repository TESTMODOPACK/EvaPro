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
        text: 'Calidad del trabajo: ¿El colaborador entrega trabajo de alta calidad?',
        type: 'scale',
        scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } },
        required: true,
      },
      {
        id: 'q2',
        text: 'Comunicación: ¿Se comunica de forma clara y efectiva?',
        type: 'scale',
        scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } },
        required: true,
      },
      {
        id: 'q3',
        text: 'Trabajo en equipo: ¿Colabora efectivamente con otros?',
        type: 'scale',
        scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } },
        required: true,
      },
      {
        id: 'q4',
        text: 'Iniciativa: ¿Propone mejoras y toma acción proactiva?',
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
        text: '¿Cuáles son las principales fortalezas del colaborador?',
        type: 'text',
        required: true,
      },
      {
        id: 'q6',
        text: '¿En qué áreas podría mejorar?',
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
      console.log('   Tenant "demo" already exists — skipping.');
    } else {
      tenant = tenantRepo.create({
        name: 'Demo Company',
        slug: 'demo',
        plan: 'starter',
        ownerType: 'company',
        maxEmployees: 50,
        isActive: true,
        settings: {},
      });
      tenant = await tenantRepo.save(tenant);
      console.log(`✅  Tenant created: ${tenant.name} (${tenant.id})`);
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
        department: 'Tecnología',
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
        lastName: 'López',
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
      { email: 'ana.martinez@evapro.demo', firstName: 'Ana', lastName: 'Martínez', department: 'Diseño', position: 'UX Designer' },
      { email: 'luis.rodriguez@evapro.demo', firstName: 'Luis', lastName: 'Rodríguez', department: 'DevOps', position: 'DevOps Engineer' },
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

    /* ── Default Template ───────────────────────────────── */
    const existingTemplate = await templateRepo.findOne({
      where: { name: 'Competencias Generales', tenantId: tenant.id },
    });
    if (!existingTemplate) {
      await templateRepo.save(
        templateRepo.create({
          tenantId: tenant.id,
          name: 'Competencias Generales',
          description: 'Plantilla estándar de evaluación con competencias laborales básicas y espacio para comentarios.',
          sections: DEMO_TEMPLATE_SECTIONS,
          isDefault: true,
          createdBy: admin.id,
        }),
      );
      console.log('✅  Default template created: Competencias Generales');
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
