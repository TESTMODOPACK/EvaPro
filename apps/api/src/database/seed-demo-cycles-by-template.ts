/**
 * seed-demo-cycles-by-template.ts
 *
 * Para cada plantilla `published` del tenant DEMO Company, crea EXACTAMENTE
 * UN ciclo de evaluación. Los estados (draft / active / closed) se reparten
 * en rotación entre las plantillas, de modo que el dashboard quede con
 * ciclos en todos los estados.
 *
 * Distribución de estados:
 *   - Si hay N plantillas, los ciclos rotan en el orden: closed, active, draft.
 *   - Con N=6: closed, active, draft, closed, active, draft (2-2-2).
 *   - Los ciclos `active` quedan con assignments creados pero ~50% completados.
 *   - Los ciclos `closed` quedan con assignments y respuestas al ~85%.
 *   - Los ciclos `draft` quedan sin assignments (igual que un borrador real).
 *
 * Idempotente: borra ciclos previos con prefijo `[POOL]` antes de crear.
 *
 * Ejecutar:
 *   docker compose exec api node dist/database/seed-demo-cycles-by-template.js
 *   (después de hacer build)
 *
 * O en desarrollo local:
 *   DATABASE_URL=postgres://... npx ts-node \
 *     apps/api/src/database/seed-demo-cycles-by-template.ts
 *
 * Variables de entorno opcionales:
 *   POOL_PREFIX        — prefijo del nombre del ciclo. Default: "[POOL]".
 *   CYCLE_PERIOD       — quarterly | biannual | annual | custom. Default: quarterly.
 *   CYCLE_START_DATE   — fecha de inicio base (YYYY-MM-DD). Default: hoy - 30 días.
 *   CYCLE_DURATION_DAYS — duración en días. Default: 60.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL no está definida');
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────
const POOL_PREFIX = process.env.POOL_PREFIX || '[POOL]';
const CYCLE_PERIOD = (process.env.CYCLE_PERIOD || 'quarterly') as
  | 'quarterly'
  | 'biannual'
  | 'annual'
  | 'custom';
const CYCLE_DURATION_DAYS = Number(process.env.CYCLE_DURATION_DAYS || 60);

const baseStart = process.env.CYCLE_START_DATE
  ? new Date(process.env.CYCLE_START_DATE)
  : (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d;
    })();

const STATE_ROTATION: Array<'closed' | 'active' | 'draft'> = ['closed', 'active', 'draft'];

// Defaults de pesos alineados con DEFAULT_WEIGHTS_BY_CYCLE_TYPE en
// src/modules/templates/constants/sub-template-defaults.ts (convención
// estándar mayo 2026). Si cambian los pesos canónicos, sincronizar acá
// + en seed-demo-cycles-mix-a.ts.
const DEFAULT_WEIGHTS: Record<string, Record<string, number>> = {
  '90': { manager: 1.0 },
  '180': { manager: 0.7, self: 0.3 },
  '270': { manager: 0.5, self: 0.2, peer: 0.3 },
  '360': { manager: 0.35, self: 0.15, peer: 0.25, direct_report: 0.25 },
};

// Alineado con ALLOWED_RELATIONS en evaluations.service.ts.
const RELATIONS_BY_CYCLE_TYPE: Record<string, string[]> = {
  '90': ['manager'],
  '180': ['manager', 'self'],
  '270': ['manager', 'self', 'peer'],
  '360': ['manager', 'self', 'peer', 'direct_report'],
};

const FORTALEZAS = [
  'Demuestra gran compromiso con los objetivos del equipo',
  'Excelente capacidad de comunicación y trabajo colaborativo',
  'Proactivo en la resolución de problemas y propuestas de mejora',
  'Destaca por su dominio técnico y calidad de entregables',
  'Muestra liderazgo natural y capacidad de influir positivamente',
  'Gran capacidad de adaptación ante cambios organizacionales',
];

const MEJORAS = [
  'Podría mejorar la documentación de sus procesos',
  'Fortalecer habilidades de presentación ante públicos amplios',
  'Desarrollar mayor autonomía en la toma de decisiones',
  'Mejorar la gestión del tiempo en tareas de baja prioridad',
];

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Detecta el cycle type a partir del campo default_cycle_type o del nombre
// de la plantilla. Fallback: 360 (más completo, supera cualquier validación).
function detectCycleType(tpl: any): string {
  if (tpl.default_cycle_type) return String(tpl.default_cycle_type);
  const name = (tpl.name || '').toLowerCase();
  if (name.includes('360')) return '360';
  if (name.includes('270')) return '270';
  if (name.includes('180')) return '180';
  if (name.includes('90')) return '90';
  return '360';
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────
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
    // Single-connection: garantiza que `SET app.current_tenant_id`
    // persista en todas las queries (necesario para RLS).
    extra: { max: 1 },
  });

  await ds.initialize();
  console.log('✓ Connected to database\n');

  // ── 1. Tenant DEMO Company ──────────────────────────────────────────
  const tenantRow = await ds.query(
    `SELECT id, name FROM tenants
     WHERE slug = 'demo' OR name ILIKE '%demo%company%' OR name ILIKE 'demo company'
     ORDER BY created_at ASC LIMIT 1`,
  );
  if (!tenantRow.length) {
    console.error('✗ DEMO Company no encontrada');
    process.exit(1);
  }
  const tenantId = tenantRow[0].id as string;
  console.log(`✓ Tenant: ${tenantRow[0].name} (${tenantId.slice(0, 8)})`);

  // RLS context para que el script funcione con eva360_app (no superuser).
  await ds.query(`SET app.current_tenant_id = '${tenantId}'`);
  console.log('✓ RLS tenant context set');

  // ── 2. Plantillas published del tenant ──────────────────────────────
  const templates = await ds.query(
    `SELECT id, name, sections, default_cycle_type, version
     FROM form_templates
     WHERE tenant_id = $1 AND status = 'published'
     ORDER BY created_at ASC`,
    [tenantId],
  );

  if (templates.length === 0) {
    console.error('\n✗ No hay plantillas published en DEMO Company. Crea las plantillas primero desde la UI.');
    process.exit(1);
  }

  templates.forEach((t: any) => {
    t.detected_cycle_type = detectCycleType(t);
  });

  console.log(`\n✓ Encontradas ${templates.length} plantillas published:`);
  templates.forEach((t: any, i: number) => {
    const detected = t.default_cycle_type ? '' : ' [detectado por nombre]';
    console.log(`  ${i + 1}. "${t.name}" → ${t.detected_cycle_type}°${detected}`);
  });

  // ── 3. Usuarios ─────────────────────────────────────────────────────
  const users = await ds.query(
    `SELECT id, email, first_name, last_name, role, department, department_id,
            manager_id, hierarchy_level
     FROM users
     WHERE tenant_id = $1 AND is_active = true
       AND role NOT IN ('super_admin', 'external')
     ORDER BY hierarchy_level ASC NULLS LAST, first_name`,
    [tenantId],
  );

  if (users.length < 3) {
    console.error(`\n✗ Se requieren al menos 3 usuarios activos. Hay ${users.length}.`);
    process.exit(1);
  }

  const admin = users.find((u: any) => u.role === 'tenant_admin') || users[0];
  const topLevel = users.find((u: any) => !u.manager_id);
  console.log(`\n✓ Usuarios elegibles: ${users.length} (admin=${admin.email})`);
  if (topLevel) {
    console.log(`  Top-level (sin manager): ${topLevel.first_name} ${topLevel.last_name}`);
  }

  // ── 4. Cleanup ciclos previos con prefijo [POOL] ────────────────────
  console.log(`\n→ Limpiando ciclos previos con prefijo "${POOL_PREFIX}"...`);
  const oldCycles = await ds.query(
    `SELECT id, name FROM evaluation_cycles
     WHERE tenant_id = $1 AND name LIKE $2`,
    [tenantId, `${POOL_PREFIX}%`],
  );

  for (const c of oldCycles) {
    await ds.query(
      `DELETE FROM evaluation_responses
       WHERE assignment_id IN (SELECT id FROM evaluation_assignments WHERE cycle_id = $1)`,
      [c.id],
    );
    await ds.query(`DELETE FROM evaluation_assignments WHERE cycle_id = $1`, [c.id]);
    await ds.query(`DELETE FROM peer_assignments WHERE cycle_id = $1`, [c.id]);
    await ds.query(`DELETE FROM cycle_stages WHERE cycle_id = $1`, [c.id]);
    await ds.query(`DELETE FROM cycle_org_snapshots WHERE cycle_id = $1`, [c.id]);
    await ds.query(`DELETE FROM cycle_evaluatee_weights WHERE cycle_id = $1`, [c.id]);
    await ds.query(`DELETE FROM evaluation_cycles WHERE id = $1`, [c.id]);
  }
  if (oldCycles.length > 0) {
    console.log(`  Eliminados ${oldCycles.length} ciclo(s) previo(s)`);
  } else {
    console.log('  Sin ciclos previos con ese prefijo');
  }

  // ── 5. Crear un ciclo por plantilla ─────────────────────────────────
  let totalAssignments = 0;
  let totalResponses = 0;
  const summary: Array<{ name: string; status: string; type: string; assignments: number; responses: number }> = [];

  for (let i = 0; i < templates.length; i++) {
    const tpl = templates[i];
    const cycleType = tpl.detected_cycle_type as string;
    const status = STATE_ROTATION[i % STATE_ROTATION.length];

    // Tasa de completitud: closed alto, active medio, draft cero.
    const completion = status === 'closed' ? 0.85 : status === 'active' ? 0.5 : 0;

    // Fechas: cada ciclo se corre dos semanas más adelante para que la UI
    // los muestre ordenados visiblemente.
    const offsetDays = i * 14;
    const start = addDays(baseStart, offsetDays);
    const end = addDays(start, CYCLE_DURATION_DAYS);

    const cycleName = `${POOL_PREFIX} ${tpl.name}`;
    const allowedRelations = RELATIONS_BY_CYCLE_TYPE[cycleType] || ['self', 'manager'];
    const weights = DEFAULT_WEIGHTS[cycleType] || { manager: 1.0 };

    console.log(`\n━━━ ${cycleName} ━━━`);
    console.log(`  Type: ${cycleType}° | Status: ${status} | Completion: ${(completion * 100).toFixed(0)}%`);
    console.log(`  Periodo: ${fmtDate(start)} → ${fmtDate(end)}`);

    const cycleEvaluatees = users;
    const cycleId = crypto.randomUUID();
    const isLaunched = status !== 'draft';
    const launchedAt = isLaunched ? start : null;

    // 5.1 Crear el ciclo
    await ds.query(
      `INSERT INTO evaluation_cycles (
        id, tenant_id, name, type, status, period, start_date, end_date,
        template_id, created_by, settings, total_evaluated,
        template_version_at_launch, template_snapshot, weights_at_launch, launched_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        cycleId,
        tenantId,
        cycleName,
        cycleType,
        status,
        CYCLE_PERIOD,
        fmtDate(start),
        fmtDate(end),
        tpl.id,
        admin.id,
        JSON.stringify({
          weights,
          minResponseRatio: 0.6,
          responseRatioStrategy: 'LINEAR',
          outlierStrategy: 'NONE',
          minPeerCount: 3,
          peerScopingStrategy: 'SAME_DEPARTMENT',
        }),
        cycleEvaluatees.length,
        isLaunched ? tpl.version || 1 : null,
        null, // template_snapshot lo poblamos abajo si isLaunched
        isLaunched ? JSON.stringify(weights) : null,
        launchedAt,
      ],
    );

    // 5.2 Cargar sub_templates y poblar template_snapshot
    const subs = await ds.query(
      `SELECT id, relation_type, sections, weight, display_order, is_active
       FROM form_sub_templates
       WHERE parent_template_id = $1`,
      [tpl.id],
    );

    if (isLaunched) {
      const fullSnapshot = {
        template: { id: tpl.id, name: tpl.name, sections: tpl.sections },
        subTemplates: subs.map((s: any) => ({
          id: s.id,
          relationType: s.relation_type,
          sections: s.sections,
          weight: Number(s.weight),
          displayOrder: s.display_order,
          isActive: s.is_active,
        })),
      };
      await ds.query(
        `UPDATE evaluation_cycles SET template_snapshot = $1 WHERE id = $2`,
        [JSON.stringify(fullSnapshot), cycleId],
      );
    }

    // 5.3 Crear stages
    const stages: { name: string; type: string }[] = [];
    if (allowedRelations.includes('self')) {
      stages.push({ name: 'Autoevaluación', type: 'self_evaluation' });
    }
    if (allowedRelations.includes('manager')) {
      stages.push({ name: 'Evaluación Jefatura', type: 'manager_evaluation' });
    }
    if (allowedRelations.includes('peer') || allowedRelations.includes('direct_report')) {
      stages.push({ name: 'Evaluación de Pares y Reportes Directos', type: 'peer_evaluation' });
    }
    if (cycleType === '360') {
      stages.push({ name: 'Calibración', type: 'calibration' });
    }
    stages.push({ name: 'Entrega de Feedback', type: 'feedback_delivery' });
    stages.push({ name: 'Cerrado', type: 'closed' });

    const stageStatus = status === 'closed' ? 'completed' : status === 'active' ? 'active' : 'pending';
    for (let s = 0; s < stages.length; s++) {
      await ds.query(
        `INSERT INTO cycle_stages (id, tenant_id, cycle_id, name, type, stage_order, status, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          crypto.randomUUID(),
          tenantId,
          cycleId,
          stages[s].name,
          stages[s].type,
          s + 1,
          stageStatus,
          fmtDate(start),
          fmtDate(end),
        ],
      );
    }

    if (!isLaunched) {
      console.log('  ✓ Ciclo creado (DRAFT, sin assignments)');
      summary.push({ name: cycleName, status, type: cycleType, assignments: 0, responses: 0 });
      continue;
    }

    // 5.4 Snapshot del organigrama (Sprint 1 BR-C.1)
    for (const u of users) {
      await ds.query(
        `INSERT INTO cycle_org_snapshots (
          cycle_id, user_id, tenant_id, primary_manager_id, secondary_managers,
          department_id, department_name, hierarchy_level, role, is_active, snapshot_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          cycleId,
          u.id,
          tenantId,
          u.manager_id || null,
          [],
          u.department_id || null,
          u.department || null,
          u.hierarchy_level || null,
          u.role,
          true,
          launchedAt,
        ],
      );
    }

    // 5.5 Crear assignments
    let cycleAssignments = 0;
    let cycleResponses = 0;
    const assignmentsByEvaluatee = new Map<string, string[]>();
    const completedDate = status === 'closed' ? end : null;

    for (const evaluatee of cycleEvaluatees) {
      const rolesPresent: string[] = [];

      for (const relType of allowedRelations) {
        if (relType === 'peer') {
          const peerCandidates = users.filter(
            (u: any) =>
              u.id !== evaluatee.id &&
              u.id !== evaluatee.manager_id &&
              u.manager_id !== evaluatee.id &&
              u.role === evaluatee.role &&
              u.department === evaluatee.department &&
              (evaluatee.hierarchy_level == null ||
                u.hierarchy_level == null ||
                Math.abs(
                  (u.hierarchy_level as number) - (evaluatee.hierarchy_level as number),
                ) <= 1),
          );
          if (peerCandidates.length === 0) continue;

          const numPeers = Math.min(3, peerCandidates.length);
          const selectedPeers = pickRandom<any>(peerCandidates, numPeers);

          for (const peer of selectedPeers) {
            const aid = crypto.randomUUID();
            const isCompleted =
              status === 'closed' ? Math.random() < completion : Math.random() < completion;
            await ds.query(
              `INSERT INTO evaluation_assignments (
                id, tenant_id, cycle_id, evaluatee_id, evaluator_id,
                relation_type, status, due_date, completed_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                aid,
                tenantId,
                cycleId,
                evaluatee.id,
                peer.id,
                'peer',
                isCompleted ? 'completed' : 'pending',
                fmtDate(end),
                isCompleted ? completedDate : null,
              ],
            );
            cycleAssignments++;

            if (isCompleted) {
              await generateResponse(ds, aid, tenantId, tpl, subs, 'peer');
              cycleResponses++;
            }
          }
          rolesPresent.push('peer');
          continue;
        }

        let evaluatorId: string | null = null;
        if (relType === 'self') {
          evaluatorId = evaluatee.id;
        } else if (relType === 'manager') {
          if (!evaluatee.manager_id) continue;
          evaluatorId = evaluatee.manager_id;
        } else if (relType === 'direct_report') {
          const reports = users.filter((u: any) => u.manager_id === evaluatee.id);
          if (reports.length === 0) continue;
          evaluatorId = reports[randInt(0, reports.length - 1)].id;
        }
        if (!evaluatorId) continue;

        const aid = crypto.randomUUID();
        const isCompleted = Math.random() < completion;
        await ds.query(
          `INSERT INTO evaluation_assignments (
            id, tenant_id, cycle_id, evaluatee_id, evaluator_id,
            relation_type, status, due_date, completed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            aid,
            tenantId,
            cycleId,
            evaluatee.id,
            evaluatorId,
            relType,
            isCompleted ? 'completed' : 'pending',
            fmtDate(end),
            isCompleted ? completedDate : null,
          ],
        );
        cycleAssignments++;

        if (isCompleted) {
          await generateResponse(ds, aid, tenantId, tpl, subs, relType);
          cycleResponses++;
        }
        rolesPresent.push(relType);
      }

      assignmentsByEvaluatee.set(evaluatee.id, rolesPresent);
    }

    // 5.6 cycle_evaluatee_weights — redistribución para roles faltantes
    const configuredRoles = Object.keys(weights);
    const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
    let redistributedCount = 0;
    for (const [evaluateeId, presentRoles] of assignmentsByEvaluatee) {
      const missing = configuredRoles.filter((r) => !presentRoles.includes(r));
      if (missing.length === 0) continue;

      const activeWeightSum = presentRoles.reduce((s, r) => s + (weights[r] || 0), 0);
      if (activeWeightSum <= 0) continue;

      const effectiveWeights: Record<string, number> = {};
      for (const role of presentRoles) {
        effectiveWeights[role] =
          Math.round(((weights[role] * totalWeight) / activeWeightSum) * 10000) / 10000;
      }

      const reason =
        missing.length === 1 && missing[0] === 'manager'
          ? 'Sin jefe directo (top of organigrama)'
          : `Roles faltantes: ${missing.join(', ')}`;

      await ds.query(
        `INSERT INTO cycle_evaluatee_weights (
          cycle_id, evaluatee_id, tenant_id, effective_weights,
          strategy_used, missing_roles, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (cycle_id, evaluatee_id) DO NOTHING`,
        [
          cycleId,
          evaluateeId,
          tenantId,
          JSON.stringify(effectiveWeights),
          'REDISTRIBUTE_PROPORTIONAL',
          missing,
          reason,
        ],
      );
      redistributedCount++;
    }

    console.log(
      `  ✓ Assignments: ${cycleAssignments} | Responses: ${cycleResponses} | Weights redistribuidos: ${redistributedCount}`,
    );
    totalAssignments += cycleAssignments;
    totalResponses += cycleResponses;
    summary.push({
      name: cycleName,
      status,
      type: cycleType,
      assignments: cycleAssignments,
      responses: cycleResponses,
    });
  }

  // ── 6. Resumen final ────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ✅ Pool de ciclos generado por plantilla');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Plantillas procesadas:  ${templates.length}`);
  console.log(`  Ciclos creados:         ${templates.length}`);
  console.log(`  Total assignments:      ${totalAssignments}`);
  console.log(`  Total respuestas:       ${totalResponses}`);
  console.log('\n  Estados finales:');
  summary.forEach((c) => {
    console.log(`    • [${c.status.padEnd(7)}] ${c.type}° — ${c.name}`);
    if (c.status !== 'draft') {
      console.log(`        assignments=${c.assignments}, responses=${c.responses}`);
    }
  });

  await ds.destroy();
  console.log('\n✓ Done');
}

// ────────────────────────────────────────────────────────────────────────
// generateResponse — simula una respuesta realista
// ────────────────────────────────────────────────────────────────────────
async function generateResponse(
  ds: DataSource,
  assignmentId: string,
  tenantId: string,
  template: any,
  subs: any[],
  relationType: string,
): Promise<void> {
  let sections: any[] = [];

  if (subs.length > 0) {
    const sub = subs.find((s) => s.relation_type === relationType && s.is_active);
    if (sub) sections = sub.sections;
  }

  if (sections.length === 0 && Array.isArray(template.sections)) {
    sections = template.sections.filter((sec: any) => {
      if (!sec.applicableTo || sec.applicableTo.length === 0) return true;
      return sec.applicableTo.includes(relationType);
    });
  }

  const answers: Record<string, any> = {};
  const scaleQs: string[] = [];
  const textQs: string[] = [];

  for (const sec of sections) {
    for (const q of sec.questions || []) {
      if (q.applicableTo && q.applicableTo.length > 0 && !q.applicableTo.includes(relationType)) {
        continue;
      }
      if (q.type === 'scale') scaleQs.push(q.id);
      else if (q.type === 'text') textQs.push(q.id);
    }
  }

  for (const qId of scaleQs) {
    const r = Math.random();
    answers[qId] = r < 0.05 ? 2 : r < 0.15 ? 3 : r < 0.5 ? 4 : 5;
  }

  for (let i = 0; i < textQs.length; i++) {
    answers[textQs[i]] =
      i % 2 === 0
        ? FORTALEZAS[randInt(0, FORTALEZAS.length - 1)]
        : MEJORAS[randInt(0, MEJORAS.length - 1)];
  }

  const nums = Object.values(answers).filter((v) => typeof v === 'number') as number[];
  const avg = nums.length > 0 ? nums.reduce((s, v) => s + v, 0) / nums.length : 0;
  const overallScore = Math.round((avg / 5) * 10 * 100) / 100;

  await ds.query(
    `INSERT INTO evaluation_responses (id, tenant_id, assignment_id, answers, overall_score, submitted_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [crypto.randomUUID(), tenantId, assignmentId, JSON.stringify(answers), overallScore],
  );
}

main().catch((err) => {
  console.error('\n✗ Error:', err);
  process.exit(1);
});
