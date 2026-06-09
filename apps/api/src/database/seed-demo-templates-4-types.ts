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
            { text: 'Genera compromiso y energía en su equipo hacia las metas comunes.', type: 'scale' },
            { text: 'Toma decisiones oportunas y bien fundamentadas, incluso ante información incompleta.', type: 'scale' },
            { text: 'Comunica las prioridades del equipo de forma clara, asegurándose de que todos entiendan qué se espera.', type: 'scale' },
          ]),
          buildSection('s90-mgr-results', 'Resultados y objetivos', 'q90mgr-res', [
            { text: 'Cumple sus compromisos en los plazos acordados, manteniendo el foco ante los obstáculos.', type: 'scale' },
            { text: 'Entrega trabajo de calidad que cumple consistentemente con los estándares esperados.', type: 'scale' },
            { text: 'Identifica la raíz de los problemas complejos y propone soluciones efectivas.', type: 'scale' },
            { text: '¿Cuáles son las principales fortalezas de esta persona y qué área de desarrollo recomendarías? Describe una situación concreta donde lo hayas observado.', type: 'text' },
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
            { text: 'Cumplí con los objetivos técnicos comprometidos para el período.', type: 'scale' },
            { text: 'Mantengo actualizado mi conocimiento técnico de forma proactiva.', type: 'scale' },
            { text: 'Resuelvo problemas técnicos de manera autónoma, recurriendo a apoyo solo cuando es necesario.', type: 'scale' },
            { text: '¿Cuál fue tu logro técnico más relevante del período y qué aprendiste de él?', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'manager',
        weight: 0.700,
        displayOrder: 2,
        sections: [
          buildSection('s180-mgr-tech', 'Desempeño técnico', 'q180mgr-tech', [
            { text: 'Entrega trabajo técnico de calidad que cumple con los estándares esperados.', type: 'scale' },
            { text: 'Resuelve sus tareas técnicas con un buen equilibrio entre rapidez y calidad.', type: 'scale' },
            { text: 'Aprende e incorpora nuevas tecnologías o herramientas cuando el trabajo lo requiere.', type: 'scale' },
          ]),
          buildSection('s180-mgr-collab', 'Colaboración', 'q180mgr-coll', [
            { text: 'Colabora de forma efectiva con el equipo técnico para lograr objetivos comunes.', type: 'scale' },
            { text: 'Documenta y comparte su conocimiento en lugar de retenerlo.', type: 'scale' },
            { text: '¿Qué comportamiento técnico específico, si lo desarrollara, tendría el mayor impacto en su desempeño?', type: 'text' },
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
            { text: 'Indago las necesidades reales del cliente antes de ofrecer una solución.', type: 'scale' },
            { text: 'Resolví las consultas y problemas de los clientes con oportunidad.', type: 'scale' },
            { text: 'Mantuve una actitud positiva incluso en interacciones difíciles con clientes.', type: 'scale' },
            { text: 'Describe una situación concreta donde brindaste un servicio destacado este período.', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'manager',
        weight: 0.500,
        displayOrder: 2,
        sections: [
          buildSection('s270-mgr-svc', 'Calidad de servicio', 'q270mgr-svc', [
            { text: 'Construye soluciones que responden a lo que el cliente realmente necesita.', type: 'scale' },
            { text: 'Maneja las quejas y situaciones difíciles de forma profesional, dejando al cliente satisfecho.', type: 'scale' },
            { text: 'Domina los productos y servicios que ofrece, y los explica con claridad al cliente.', type: 'scale' },
            { text: '¿Cuál es la mayor fortaleza de esta persona en servicio al cliente y qué debería mejorar? Da un ejemplo concreto.', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'peer',
        weight: 0.300,
        displayOrder: 3,
        sections: [
          buildSection('s270-peer-coll', 'Colaboración entre pares', 'q270peer-coll', [
            { text: 'Puedo contar con esta persona cuando necesito apoyo para avanzar.', type: 'scale' },
            { text: 'Comparte su conocimiento de servicio al cliente con el equipo.', type: 'scale' },
            { text: 'Mantiene la calma y la efectividad bajo presión en los horarios de mayor demanda.', type: 'scale' },
            { text: '¿Qué podría hacer esta persona para mejorar aún más la colaboración con el equipo?', type: 'text' },
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
            { text: 'Cumplí con los objetivos estratégicos comprometidos para el período.', type: 'scale' },
            { text: 'Conecto mis decisiones diarias con los objetivos de largo plazo de la organización.', type: 'scale' },
            { text: 'Construyo y mantengo relaciones de confianza con los distintos stakeholders.', type: 'scale' },
            { text: '¿Cuáles fueron tus logros más relevantes del período y qué los hizo posibles?', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'manager',
        weight: 0.350,
        displayOrder: 2,
        sections: [
          buildSection('s360-mgr', 'Visión del encargado', 'q360mgr', [
            { text: 'Cumple los objetivos estratégicos asignados, manteniendo el foco ante los obstáculos.', type: 'scale' },
            { text: 'Toma decisiones bien fundamentadas, considerando su impacto más allá de su área.', type: 'scale' },
            { text: 'Gestiona prioridades complejas sin perder de vista lo que realmente importa.', type: 'scale' },
            { text: '¿Cuál es la principal fortaleza de esta persona y qué comportamiento debería desarrollar? Describe una situación concreta.', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'peer',
        weight: 0.250,
        displayOrder: 3,
        sections: [
          buildSection('s360-peer', 'Colaboración con pares', 'q360peer', [
            { text: 'Colabora efectivamente en proyectos transversales, anteponiendo el objetivo común.', type: 'scale' },
            { text: 'Comparte recursos y conocimiento con sus pares en lugar de retenerlos.', type: 'scale' },
            { text: 'Es un referente positivo que aporta una mirada amplia al grupo de pares.', type: 'scale' },
            { text: '¿Qué debería esta persona seguir haciendo y qué empezar a hacer para mejorar la colaboración?', type: 'text' },
          ]),
        ],
      },
      {
        relationType: 'direct_report',
        weight: 0.250,
        displayOrder: 4,
        sections: [
          buildSection('s360-dr', 'Calidad del liderazgo recibido', 'q360dr', [
            { text: 'Me da retroalimentación oportuna y concreta sobre cómo mejorar mi desempeño.', type: 'scale' },
            { text: 'Apoya mi desarrollo profesional ofreciéndome desafíos y oportunidades de crecimiento.', type: 'scale' },
            { text: 'Me comunica con claridad qué resultados y prioridades espera de mí.', type: 'scale' },
            { text: '¿Qué valoras de su liderazgo y qué necesitas de esta persona como líder que hoy no estás recibiendo?', type: 'text' },
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
