/**
 * seed-demo-templates-4-types.ts
 *
 * Crea 4 plantillas oficiales para DEMO Company (convención estándar
 * mayo 2026), una por cycleType, con sus sub_templates y pesos default
 * canónicos:
 *
 *   1. "Demo · 90° Liderazgo"          → solo manager (peso 1.00)
 *   2. "Demo · 180° Técnica"           → manager (0.70) + self (0.30)
 *   3. "Demo · 270° Servicio al Cliente" → manager (0.50) + self (0.20) + peer (0.30)
 *   4. "Demo · 360° Completa"          → manager (0.35) + self (0.15) + peer (0.25) + direct_report (0.25)
 *
 * Cada sub_template tiene 2 secciones con 3 preguntas escala (1-5) +
 * 1 pregunta texto, adaptadas a la perspectiva del evaluador.
 *
 * Nombres elegidos para que el seed-demo-evaluations.ts los matchee
 * automáticamente por keyword (Liderazgo / Técnica / Cliente / 360).
 *
 * Uso:
 *   docker compose exec api node dist/database/seed-demo-templates-4-types.js
 *
 * Idempotente: si una plantilla con el mismo nombre ya existe, SKIP.
 * Para regenerar, primero borrar con clear-demo-company-templates-and-cycles.sql.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL no está seteada');
  process.exit(1);
}

// ─── Fábrica de secciones por rol ────────────────────────────────────

function buildSection(secId: string, title: string, qPrefix: string, questions: Array<{ text: string; type: 'scale' | 'text' }>): any {
  return {
    id: secId,
    title,
    questions: questions.map((q, i) => ({
      id: `${qPrefix}-${i + 1}`,
      text: q.text,
      type: q.type,
      ...(q.type === 'scale' ? { scale: { min: 1, max: 5 } } : {}),
      required: true,
    })),
  };
}

// ─── Definición de las 4 plantillas ──────────────────────────────────

interface SubTemplateSpec {
  relationType: 'manager' | 'self' | 'peer' | 'direct_report';
  weight: number;
  displayOrder: number;
  sections: any[];
}

interface TemplateSpec {
  name: string;
  description: string;
  defaultCycleType: '90' | '180' | '270' | '360';
  subs: SubTemplateSpec[];
}

const TEMPLATES: TemplateSpec[] = [
  // ─── 1. 90° Liderazgo (solo manager) ────────────────────────────────
  {
    name: 'Demo · 90° Liderazgo',
    description: 'Evaluación 90° top-down — el encargado evalúa el desempeño de liderazgo del colaborador. Pesos: manager 100%.',
    defaultCycleType: '90',
    subs: [
      {
        relationType: 'manager',
        weight: 1.000,
        displayOrder: 1,
        sections: [
          buildSection('s90-mgr-lead', 'Capacidad de liderazgo', 'q90mgr-lead', [
            { text: 'Demuestra capacidad para inspirar y motivar al equipo.', type: 'scale' },
            { text: 'Toma decisiones oportunas y bien fundamentadas.', type: 'scale' },
            { text: 'Comunica con claridad los objetivos y prioridades.', type: 'scale' },
          ]),
          buildSection('s90-mgr-results', 'Resultados y objetivos', 'q90mgr-res', [
            { text: 'Cumple consistentemente con los objetivos del período.', type: 'scale' },
            { text: 'Calidad técnica de los entregables.', type: 'scale' },
            { text: 'Capacidad para resolver problemas complejos.', type: 'scale' },
            { text: 'Comentario abierto: fortalezas y áreas de desarrollo observadas.', type: 'text' },
          ]),
        ],
      },
    ],
  },

  // ─── 2. 180° Técnica (manager + self) ───────────────────────────────
  {
    name: 'Demo · 180° Técnica',
    description: 'Evaluación 180° técnica — encargado + autoevaluación. Pesos: manager 70%, self 30%.',
    defaultCycleType: '180',
    subs: [
      {
        relationType: 'self',
        weight: 0.300,
        displayOrder: 1,
        sections: [
          buildSection('s180-self-tech', 'Autoevaluación técnica', 'q180self-tech', [
            { text: 'Considero que cumplí con los objetivos técnicos del período.', type: 'scale' },
            { text: 'Mantengo actualizado mi conocimiento técnico.', type: 'scale' },
            { text: 'Resuelvo problemas técnicos de manera autónoma.', type: 'scale' },
            { text: 'Identifica un logro técnico relevante del período.', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'manager',
        weight: 0.700,
        displayOrder: 2,
        sections: [
          buildSection('s180-mgr-tech', 'Desempeño técnico', 'q180mgr-tech', [
            { text: 'Calidad técnica de los entregables del colaborador.', type: 'scale' },
            { text: 'Productividad y eficiencia en tareas técnicas.', type: 'scale' },
            { text: 'Capacidad para aprender nuevas tecnologías o herramientas.', type: 'scale' },
          ]),
          buildSection('s180-mgr-collab', 'Colaboración', 'q180mgr-coll', [
            { text: 'Trabaja efectivamente con el equipo técnico.', type: 'scale' },
            { text: 'Documenta y comparte conocimiento.', type: 'scale' },
            { text: 'Comentario abierto sobre áreas de mejora técnica.', type: 'text' },
          ]),
        ],
      },
    ],
  },

  // ─── 3. 270° Servicio al Cliente (manager + self + peer) ────────────
  {
    name: 'Demo · 270° Servicio al Cliente',
    description: 'Evaluación 270° de servicio — encargado + autoevaluación + pares. Pesos: manager 50%, self 20%, pares 30%.',
    defaultCycleType: '270',
    subs: [
      {
        relationType: 'self',
        weight: 0.200,
        displayOrder: 1,
        sections: [
          buildSection('s270-self-svc', 'Autoevaluación de servicio', 'q270self-svc', [
            { text: 'Considero que brindé un servicio de calidad a los clientes.', type: 'scale' },
            { text: 'Resolví consultas y problemas de manera oportuna.', type: 'scale' },
            { text: 'Mantuve una actitud positiva en interacciones con clientes.', type: 'scale' },
            { text: 'Caso destacado de buen servicio al cliente este período.', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'manager',
        weight: 0.500,
        displayOrder: 2,
        sections: [
          buildSection('s270-mgr-svc', 'Calidad de servicio', 'q270mgr-svc', [
            { text: 'Brinda un servicio de calidad a los clientes asignados.', type: 'scale' },
            { text: 'Manejo de quejas y situaciones difíciles.', type: 'scale' },
            { text: 'Conocimiento de los productos/servicios que ofrece.', type: 'scale' },
            { text: 'Comentario sobre desempeño en servicio al cliente.', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'peer',
        weight: 0.300,
        displayOrder: 3,
        sections: [
          buildSection('s270-peer-coll', 'Colaboración entre pares', 'q270peer-coll', [
            { text: 'Disponibilidad para apoyar cuando se requiere su colaboración.', type: 'scale' },
            { text: 'Comparte conocimiento de servicio al cliente con el equipo.', type: 'scale' },
            { text: 'Maneja de buena manera la presión en horarios pico.', type: 'scale' },
            { text: 'Una sugerencia para mejorar el trabajo en equipo.', type: 'text' },
          ]),
        ],
      },
    ],
  },

  // ─── 4. 360° Completa (manager + self + peer + direct_report) ───────
  {
    name: 'Demo · 360° Completa',
    description: 'Evaluación 360° integral — incluye reportes directos + etapa de calibración. Pesos: manager 35%, self 15%, pares 25%, reportes 25%.',
    defaultCycleType: '360',
    subs: [
      {
        relationType: 'self',
        weight: 0.150,
        displayOrder: 1,
        sections: [
          buildSection('s360-self', 'Autoevaluación integral', 'q360self', [
            { text: 'Considero que cumplí con los objetivos estratégicos del período.', type: 'scale' },
            { text: 'Demuestro liderazgo y visión a largo plazo.', type: 'scale' },
            { text: 'Manejo efectivamente las relaciones con stakeholders.', type: 'scale' },
            { text: 'Logros más relevantes del período.', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'manager',
        weight: 0.350,
        displayOrder: 2,
        sections: [
          buildSection('s360-mgr', 'Visión del encargado', 'q360mgr', [
            { text: 'Cumplimiento de objetivos estratégicos asignados.', type: 'scale' },
            { text: 'Calidad de las decisiones estratégicas tomadas.', type: 'scale' },
            { text: 'Capacidad de gestionar prioridades complejas.', type: 'scale' },
            { text: 'Comentario sobre desempeño general del colaborador.', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'peer',
        weight: 0.250,
        displayOrder: 3,
        sections: [
          buildSection('s360-peer', 'Colaboración con pares', 'q360peer', [
            { text: 'Colabora efectivamente en proyectos transversales.', type: 'scale' },
            { text: 'Comparte recursos y conocimiento con sus pares.', type: 'scale' },
            { text: 'Es un referente positivo en el grupo de pares.', type: 'scale' },
            { text: 'Cómo podría mejorar la colaboración con el equipo.', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'direct_report',
        weight: 0.250,
        displayOrder: 4,
        sections: [
          buildSection('s360-dr', 'Calidad del liderazgo recibido', 'q360dr', [
            { text: 'Me da feedback oportuno y constructivo sobre mi desempeño.', type: 'scale' },
            { text: 'Apoya mi desarrollo profesional con oportunidades de crecimiento.', type: 'scale' },
            { text: 'Comunica de manera clara las expectativas y prioridades.', type: 'scale' },
            { text: 'Algo que valoro de su liderazgo y algo que podría mejorar.', type: 'text' },
          ]),
        ],
      },
    ],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────

async function findOrCreateTemplate(
  ds: DataSource,
  tenantId: string,
  spec: TemplateSpec,
): Promise<{ id: string; created: boolean }> {
  const existing = await ds.query(
    `SELECT id FROM form_templates WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
    [tenantId, spec.name],
  );
  if (existing.length > 0) {
    return { id: existing[0].id, created: false };
  }
  const id = crypto.randomUUID();
  await ds.query(
    `INSERT INTO form_templates (
       id, tenant_id, name, description, sections,
       default_cycle_type, status, language, version
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'published', 'es', 1)`,
    [id, tenantId, spec.name, spec.description, JSON.stringify([]), spec.defaultCycleType],
  );
  return { id, created: true };
}

async function insertSubTemplate(
  ds: DataSource,
  tenantId: string,
  parentTemplateId: string,
  sub: SubTemplateSpec,
): Promise<void> {
  const id = crypto.randomUUID();
  await ds.query(
    `INSERT INTO form_sub_templates (
       id, tenant_id, parent_template_id, relation_type, sections,
       weight, display_order, is_active
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, true)`,
    [
      id,
      tenantId,
      parentTemplateId,
      sub.relationType,
      JSON.stringify(sub.sections),
      sub.weight,
      sub.displayOrder,
    ],
  );
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false'
        ? { rejectUnauthorized: false }
        : false,
    synchronize: false,
    logging: false,
    // Single-connection pool para mantener RLS context (set_config) durante
    // toda la sesión. Sin esto, otros queries pueden tomar conexión distinta
    // y perder el contexto.
    extra: { max: 1 },
  });

  await ds.initialize();
  console.log('✓ Conectado a la base de datos\n');

  // ── 1. Buscar tenant DEMO Company ───────────────────────────────────
  const tenantRow = await ds.query(
    `SELECT id, name FROM tenants WHERE slug = 'demo' OR name ILIKE '%demo%company%' OR name ILIKE 'demo company' LIMIT 1`,
  );
  if (!tenantRow.length) {
    console.error('✗ Tenant DEMO Company no encontrado');
    process.exit(1);
  }
  const tenantId = tenantRow[0].id;
  console.log(`✓ Tenant: ${tenantRow[0].name} (${tenantId})`);

  // RLS context — necesario para INSERTs en form_templates / form_sub_templates
  // si el rol Postgres es eva360_app (no superuser).
  await ds.query(`SET app.current_tenant_id = '${tenantId}'`);
  console.log(`✓ RLS context: app.current_tenant_id = ${tenantId}\n`);

  console.log('━━━ Creando 4 plantillas (una por cycleType) ━━━\n');

  let createdCount = 0;
  let skippedCount = 0;

  for (const spec of TEMPLATES) {
    const result = await findOrCreateTemplate(ds, tenantId, spec);
    if (!result.created) {
      console.log(`  [skip] Ya existe: ${spec.name} (${result.id.slice(0, 8)})`);
      skippedCount++;
      continue;
    }
    for (const sub of spec.subs) {
      await insertSubTemplate(ds, tenantId, result.id, sub);
    }
    console.log(
      `  [ok]   ${spec.name} (${result.id.slice(0, 8)}) + ${spec.subs.length} sub_template${spec.subs.length === 1 ? '' : 's'}`,
    );
    createdCount++;
  }

  console.log(`\n━━━ Resumen ━━━`);
  console.log(`  ✅ Creadas: ${createdCount}`);
  console.log(`  ⏭️  Saltadas (ya existían): ${skippedCount}`);
  console.log(`  📦 Total plantillas demo: ${TEMPLATES.length}\n`);

  await ds.destroy();
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
