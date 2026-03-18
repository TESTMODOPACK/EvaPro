/**
 * seed.ts — inserts demo tenant + admin user on first deploy.
 * Run via: pnpm --filter @repo/api run db:seed
 * Uses ts-node (available during build because devDependencies are installed).
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { User } from '../modules/users/entities/user.entity';

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
  entities: [Tenant, User],
  synchronize: false,
  logging: false,
});

/* ── Demo credentials ─────────────────────────────────── */
const DEMO_TENANT = {
  name:         'Demo Company',
  slug:         'demo',
  plan:         'starter',
  ownerType:    'company',
  maxEmployees: 50,
  isActive:     true,
  settings:     {},
};

const DEMO_USER = {
  email:       'admin@evapro.demo',
  password:    'EvaPro2026!',    // plain-text — will be hashed below
  firstName:   'Admin',
  lastName:    'EvaPro',
  role:        'tenant_admin',
  department:  'Tecnología',
  position:    'Administrador del Sistema',
  isActive:    true,
};

async function seed() {
  try {
    console.log('🌱  Connecting to database for seeding…');
    await dataSource.initialize();

    const tenantRepo = dataSource.getRepository(Tenant);
    const userRepo   = dataSource.getRepository(User);

    /* ── Tenant ─────────────────────────────────────────── */
    let tenant = await tenantRepo.findOne({ where: { slug: DEMO_TENANT.slug } });
    if (tenant) {
      console.log(`   Tenant "${DEMO_TENANT.slug}" already exists — skipping.`);
    } else {
      tenant = tenantRepo.create(DEMO_TENANT);
      tenant = await tenantRepo.save(tenant);
      console.log(`✅  Tenant created: ${tenant.name} (${tenant.id})`);
    }

    /* ── Admin User ─────────────────────────────────────── */
    const exists = await userRepo.findOne({
      where: { email: DEMO_USER.email, tenantId: tenant.id },
    });
    if (exists) {
      console.log(`   User "${DEMO_USER.email}" already exists — skipping.`);
    } else {
      const passwordHash = await bcrypt.hash(DEMO_USER.password, 10);
      const user = userRepo.create({
        email:      DEMO_USER.email,
        passwordHash,
        firstName:  DEMO_USER.firstName,
        lastName:   DEMO_USER.lastName,
        role:       DEMO_USER.role,
        department: DEMO_USER.department,
        position:   DEMO_USER.position,
        isActive:   DEMO_USER.isActive,
        tenantId:   tenant.id,
      });
      await userRepo.save(user);
      console.log(`✅  User created: ${DEMO_USER.email}`);
    }

    console.log('\n📋  Demo credentials:');
    console.log(`   Empresa (slug): ${DEMO_TENANT.slug}`);
    console.log(`   Email:          ${DEMO_USER.email}`);
    console.log(`   Contraseña:     ${DEMO_USER.password}`);
    console.log(`   Rol:            ${DEMO_USER.role}`);

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
