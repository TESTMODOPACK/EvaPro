/**
 * seed-demo-templates-with-subs.ts
 *
 * Crea 2 plantillas DEMO con `form_sub_templates` configuradas — para
 * que un tenant_admin pueda abrir el editor de subplantillas (UI Fase 3,
 * Opción A) y validar que la división por rol funciona sin tener que
 * migrar a mano una plantilla legacy.
 *
 * Plantillas creadas:
 *   1. "Demo · Evaluación 90° con Subplantillas" (cycle 90)
 *      - subtemplate manager (peso 0.700)
 *      - subtemplate self    (peso 0.300)
 *
 *   2. "Demo · Evaluación 180° con Subplantillas" (cycle 180)
 *      - subtemplate manager (peso 0.450)
 *      - subtemplate self    (peso 0.250)
 *      - subtemplate peer    (peso 0.300)
 *
 * Cada subtemplate trae 1-2 secciones con preguntas reales (mismo schema
 * JSONB que `form_templates.sections`) — permite probar el flujo de
 * editar / cambiar pesos / agregar preguntas por rol.
 *
 * Idempotente: re-corridas detectan plantillas existentes por nombre
 * (`name` UNIQUE-ish dentro del tenant) y skip-ean.
 *
 * Tenant scope: si TENANT_ID está seteado en el env usa ese tenant,
 * sino toma el primer tenant non-system (NOT NULL tenant_id) que
 * encuentre. Útil para correr en demo sin tener que averiguar el id.
 *
 * Run:
 *   docker compose exec api node dist/database/seed-demo-templates-with-subs.js
 *   # tenant específico:
 *   TENANT_ID=xxx docker compose exec api node dist/database/seed-demo-templates-with-subs.js
 */

import 'reflect-metadata';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const TENANT_ID = process.env.TENANT_ID;
const isProduction = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.');
  process.exit(1);
}

// ─── Plantilla 1: 90° (manager + self) ─────────────────────────────────

const T1_NAME = 'Demo · Evaluación 90° con Subplantillas';
const T1_DESC =
  'Plantilla demo Fase 3 — evaluación 90° con subplantilla manager (peso 0.7) y self (peso 0.3).';

const T1_PARENT_SECTIONS: any[] = [
  // Sections del padre quedan vacías a propósito en plantillas Fase 3:
  // todo el contenido vive en sub_templates. Padre solo carga metadata.
];

const T1_SUB_MANAGER_SECTIONS = [
  {
    id: 'sec-mgr-comp',
    title: 'Competencias core',
    questions: [
      {
        id: 'q-mgr-1',
        text: '¿Cómo evalúa la calidad de los entregables del colaborador?',
        type: 'scale',
        scale: { min: 1, max: 5 },
        required: true,
      },
      {
        id: 'q-mgr-2',
        text: '¿Cómo evalúa la consistencia en el cumplimiento de plazos?',
        type: 'scale',
        scale: { min: 1, max: 5 },
        required: true,
      },
      {
        id: 'q-mgr-3',
        text: 'Comentario abierto: fortalezas observadas en el período.',
        type: 'text',
        required: false,
      },
    ],
  },
];

const T1_SUB_SELF_SECTIONS = [
  {
    id: 'sec-self-reflex',
    title: 'Autorreflexión',
    questions: [
      {
        id: 'q-self-1',
        text: '¿Cómo evalúa el cumplimiento de sus propios objetivos en el período?',
        type: 'scale',
        scale: { min: 1, max: 5 },
        required: true,
      },
      {
        id: 'q-self-2',
        text: '¿Qué áreas identifica para su desarrollo profesional?',
        type: 'text',
        required: true,
      },
    ],
  },
];

// ─── Plantilla 2: 180° (manager + self + peer) ─────────────────────────

const T2_NAME = 'Demo · Evaluación 180° con Subplantillas';
const T2_DESC =
  'Plantilla demo Fase 3 — evaluación 180° con subplantilla manager (0.45), self (0.25) y peer (0.30).';

const T2_PARENT_SECTIONS: any[] = [];

const T2_SUB_MANAGER_SECTIONS = [
  {
    id: 'sec-mgr180-perf',
    title: 'Desempeño y resultados',
    questions: [
      {
        id: 'q-mgr180-1',
        text: 'Calidad técnica de los entregables.',
        type: 'scale',
        scale: { min: 1, max: 5 },
        required: true,
      },
      {
        id: 'q-mgr180-2',
        text: 'Liderazgo e influencia positiva en el equipo.',
        type: 'scale',
        scale: { min: 1, max: 5 },
        required: true,
      },
    ],
  },
];

const T2_SUB_SELF_SECTIONS = [
  {
    id: 'sec-self180-1',
    title: 'Autorreflexión',
    questions: [
      {
        id: 'q-self180-1',
        text: 'Logros más relevantes del período.',
        type: 'text',
        required: true,
      },
    ],
  },
];

const T2_SUB_PEER_SECTIONS = [
  {
    id: 'sec-peer180-collab',
    title: 'Colaboración entre pares',
    questions: [
      {
        id: 'q-peer180-1',
        text: 'Disponibilidad y apoyo cuando se requiere su colaboración.',
        type: 'scale',
        scale: { min: 1, max: 5 },
        required: true,
      },
      {
        id: 'q-peer180-2',
        text: 'Calidad de la comunicación en proyectos compartidos.',
        type: 'scale',
        scale: { min: 1, max: 5 },
        required: true,
      },
    ],
  },
];

// ─── Runner ────────────────────────────────────────────────────────────

interface TenantRow {
  id: string;
  name: string;
}

async function run(): Promise<void> {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl:
      isProduction && process.env.DB_SSL !== 'false'
        ? { rejectUnauthorized: false }
        : false,
  });

  try {
    await client.connect();
    console.log('Seeding demo templates with sub_templates (Fase 3)...');

    // Resolver tenant
    let tenantId = TENANT_ID;
    let tenantName = '<env override>';

    if (!tenantId) {
      const res = await client.query<TenantRow>(
        `SELECT id, name FROM tenants
         WHERE name NOT IN ('System', 'Default')
         ORDER BY created_at ASC
         LIMIT 1`,
      );
      if (res.rows.length === 0) {
        console.error(
          '  [error] No se encontró ningún tenant non-system. Setea TENANT_ID o crea un tenant primero.',
        );
        process.exit(1);
      }
      tenantId = res.rows[0].id;
      tenantName = res.rows[0].name;
    }

    console.log(`  [info] tenant: ${tenantName} (${tenantId})`);

    await client.query('BEGIN');

    try {
      const t1Id = await ensureTemplate(client, tenantId, {
        name: T1_NAME,
        description: T1_DESC,
        sections: T1_PARENT_SECTIONS,
        defaultCycleType: '90',
      });
      if (t1Id.created) {
        await insertSubTemplate(client, tenantId, t1Id.id, {
          relationType: 'manager',
          weight: 0.700,
          displayOrder: 2,
          sections: T1_SUB_MANAGER_SECTIONS,
        });
        await insertSubTemplate(client, tenantId, t1Id.id, {
          relationType: 'self',
          weight: 0.300,
          displayOrder: 1,
          sections: T1_SUB_SELF_SECTIONS,
        });
        console.log(`  [ok] ${T1_NAME} (id=${t1Id.id.slice(0, 8)}) + 2 sub_templates`);
      } else {
        console.log(`  [skip] ya existe: ${T1_NAME}`);
      }

      const t2Id = await ensureTemplate(client, tenantId, {
        name: T2_NAME,
        description: T2_DESC,
        sections: T2_PARENT_SECTIONS,
        defaultCycleType: '180',
      });
      if (t2Id.created) {
        await insertSubTemplate(client, tenantId, t2Id.id, {
          relationType: 'manager',
          weight: 0.450,
          displayOrder: 2,
          sections: T2_SUB_MANAGER_SECTIONS,
        });
        await insertSubTemplate(client, tenantId, t2Id.id, {
          relationType: 'self',
          weight: 0.250,
          displayOrder: 1,
          sections: T2_SUB_SELF_SECTIONS,
        });
        await insertSubTemplate(client, tenantId, t2Id.id, {
          relationType: 'peer',
          weight: 0.300,
          displayOrder: 3,
          sections: T2_SUB_PEER_SECTIONS,
        });
        console.log(`  [ok] ${T2_NAME} (id=${t2Id.id.slice(0, 8)}) + 3 sub_templates`);
      } else {
        console.log(`  [skip] ya existe: ${T2_NAME}`);
      }

      await client.query('COMMIT');
      console.log('\nSeed complete. Refrescá /dashboard/plantillas y editá una para ver el editor de subplantillas.');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Seed failed:', msg);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

interface EnsureTemplateOpts {
  name: string;
  description: string;
  sections: any[];
  defaultCycleType: string;
}

async function ensureTemplate(
  client: Client,
  tenantId: string,
  opts: EnsureTemplateOpts,
): Promise<{ id: string; created: boolean }> {
  // Detectar plantilla existente por (tenant_id, name) — el seed asume
  // estos nombres son únicos para el demo.
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM form_templates WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
    [tenantId, opts.name],
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, created: false };
  }

  const insert = await client.query<{ id: string }>(
    `
      INSERT INTO form_templates (
        id, tenant_id, name, description, sections,
        default_cycle_type, language, status, version,
        version_history, translations, is_default,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4::jsonb,
        $5, 'es', 'published', 1,
        '[]'::jsonb, '{}'::jsonb, FALSE,
        NOW(), NOW()
      )
      RETURNING id
    `,
    [
      tenantId,
      opts.name,
      opts.description,
      JSON.stringify(opts.sections),
      opts.defaultCycleType,
    ],
  );
  return { id: insert.rows[0].id, created: true };
}

interface InsertSubOpts {
  relationType: string;
  weight: number;
  displayOrder: number;
  sections: any[];
}

async function insertSubTemplate(
  client: Client,
  tenantId: string,
  parentTemplateId: string,
  opts: InsertSubOpts,
): Promise<void> {
  await client.query(
    `
      INSERT INTO form_sub_templates (
        id, tenant_id, parent_template_id, relation_type,
        sections, weight, display_order, is_active,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3,
        $4::jsonb, $5, $6, TRUE,
        NOW(), NOW()
      )
      ON CONFLICT ON CONSTRAINT uq_sub_template_parent_relation DO NOTHING
    `,
    [
      tenantId,
      parentTemplateId,
      opts.relationType,
      JSON.stringify(opts.sections),
      opts.weight,
      opts.displayOrder,
    ],
  );
}

void run();
