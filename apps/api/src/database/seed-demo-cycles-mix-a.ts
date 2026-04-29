/**
 * seed-demo-cycles-mix-a.ts — Pool de ciclos de prueba para DEMO Company.
 *
 * Genera 4 ciclos con mix A (50% closed + 25% active + 25% draft) sobre
 * las 4 plantillas que el admin creó manualmente en DEMO Company.
 *
 * Bonus simulaciones (todas activas):
 *   - Outliers en respuestas: 1 evaluador "discrepante" en ciclos closed
 *   - CEO sin manager incluido en ciclos 360°/270°
 *   - Secondary managers seteados en algunos users
 *   - Low response ratio: 1 evaluador NO completa en ciclos active
 *
 * Persiste correctamente:
 *   - evaluation_cycles con template_snapshot + weights_at_launch + launched_at
 *   - cycle_org_snapshots (Sprint 1)
 *   - cycle_evaluatee_weights (Sprint 2 redistribución)
 *   - evaluation_assignments + responses (con outliers simulados)
 *   - cycle_stages
 *
 * Ejecutar:
 *   docker compose exec api node dist/database/seed-demo-cycles-mix-a.js
 *   (después de hacer build)
 *
 * O en desarrollo local:
 *   npx ts-node apps/api/src/database/seed-demo-cycles-mix-a.ts
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

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
// Cycle types — defaults de pesos por cycle type
// ────────────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: Record<string, Record<string, number>> = {
  '90': { manager: 0.7, self: 0.3 },
  '180': { manager: 0.45, self: 0.25, peer: 0.30 },
  '270': { manager: 0.35, self: 0.20, peer: 0.20, direct_report: 0.25 },
  '360': { manager: 0.30, self: 0.20, peer: 0.25, direct_report: 0.25 },
};

const RELATIONS_BY_CYCLE_TYPE: Record<string, string[]> = {
  '90': ['self', 'manager'],
  '180': ['self', 'manager', 'peer'],
  '270': ['self', 'manager', 'peer', 'direct_report'],
  '360': ['self', 'manager', 'peer', 'direct_report'],
};

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
  });

  await ds.initialize();
  console.log('✓ Connected to database\n');

  // ── 1. Find DEMO Company tenant ─────────────────────────────────────
  const tenantRow = await ds.query(
    `SELECT id, name FROM tenants WHERE slug = 'demo' OR name ILIKE '%demo%' LIMIT 1`,
  );
  if (!tenantRow.length) {
    console.error('✗ Demo Company not found');
    process.exit(1);
  }
  const tenantId = tenantRow[0].id;
  console.log(`✓ Tenant: ${tenantRow[0].name} (${tenantId.slice(0, 8)})`);

  // ── 2. Find templates ───────────────────────────────────────────────
  const templates = await ds.query(
    `SELECT id, name, sections, default_cycle_type, version
     FROM form_templates
     WHERE tenant_id = $1 AND status = 'published'
     ORDER BY created_at ASC`,
    [tenantId],
  );
  console.log(`✓ Found ${templates.length} templates`);
  templates.forEach((t: any, i: number) =>
    console.log(`  ${i + 1}. "${t.name}" (cycle_type=${t.default_cycle_type || 'sin definir'})`),
  );

  if (templates.length < 4) {
    console.error(`\n✗ Se requieren al menos 4 plantillas. Encontradas: ${templates.length}`);
    process.exit(1);
  }

  // Tomar las primeras 4 (admin creó esas)
  const templates4 = templates.slice(0, 4);

  // ── 3. Get users ────────────────────────────────────────────────────
  const users = await ds.query(
    `SELECT id, email, first_name, last_name, role, department, department_id, manager_id, hierarchy_level
     FROM users
     WHERE tenant_id = $1 AND is_active = true AND role NOT IN ('super_admin', 'external')
     ORDER BY hierarchy_level ASC NULLS LAST, first_name`,
    [tenantId],
  );
  console.log(`\n✓ Active users (eligible): ${users.length}`);

  if (users.length < 5) {
    console.error('\n✗ Se requieren al menos 5 usuarios activos para crear ciclos demo.');
    process.exit(1);
  }

  const admin = users.find((u: any) => u.role === 'tenant_admin') || users[0];
  const evaluatees = users; // todos elegibles como evaluados

  // ── 4. Bonus: simular CEO sin manager (top-level) ──────────────────
  // Si hay un user con manager_id NULL (top of hierarchy), lo dejamos así
  // y aseguramos que aparezca en los ciclos 360° (BR-A.1 del Sprint 2).
  const topLevel = users.find((u: any) => !u.manager_id);
  if (topLevel) {
    console.log(`✓ CEO/Top-level: ${topLevel.first_name} ${topLevel.last_name} (sin manager) — usado para test BR-A.1`);
  }

  // ── 5. Bonus: setear secondary managers en algunos users ──────────
  // (Sprint 4 BR-A.4: matrix reporting)
  const tenantManagers = users.filter((u: any) => u.role === 'manager').slice(0, 2);
  if (tenantManagers.length >= 2) {
    // Agregar el segundo manager como secondary del primer empleado
    const firstEmp = users.find((u: any) => u.role === 'employee' && u.manager_id);
    if (firstEmp) {
      const secondaryId = tenantManagers.find((m: any) => m.id !== firstEmp.manager_id)?.id;
      if (secondaryId) {
        await ds.query(
          `UPDATE users SET secondary_managers = ARRAY[$1::uuid] WHERE id = $2`,
          [secondaryId, firstEmp.id],
        );
        console.log(`✓ Secondary manager seteado: ${firstEmp.first_name} → ${secondaryId.slice(0, 8)} (BR-A.4)`);
      }
    }
  }

  // ── 6. Cleanup previo (idempotente) ────────────────────────────────
  console.log('\n→ Limpiando ciclos demo previos...');
  const oldCycles = await ds.query(
    `SELECT id FROM evaluation_cycles WHERE tenant_id = $1 AND name LIKE '[POOL]%'`,
    [tenantId],
  );
  for (const c of oldCycles) {
    await ds.query(`DELETE FROM evaluation_responses WHERE assignment_id IN (SELECT id FROM evaluation_assignments WHERE cycle_id = $1)`, [c.id]);
    await ds.query(`DELETE FROM evaluation_assignments WHERE cycle_id = $1`, [c.id]);
    await ds.query(`DELETE FROM peer_assignments WHERE cycle_id = $1`, [c.id]);
    await ds.query(`DELETE FROM cycle_stages WHERE cycle_id = $1`, [c.id]);
    await ds.query(`DELETE FROM cycle_org_snapshots WHERE cycle_id = $1`, [c.id]);
    await ds.query(`DELETE FROM cycle_evaluatee_weights WHERE cycle_id = $1`, [c.id]);
    await ds.query(`DELETE FROM evaluation_cycles WHERE id = $1`, [c.id]);
  }
  if (oldCycles.length > 0) console.log(`  Eliminados ${oldCycles.length} ciclos anteriores`);

  // ── 7. Definir los 4 cycles config (Mix A) ─────────────────────────
  // 50% cerrados (80% completion) + 25% activos (50% completion) + 25% draft
  const cycleConfigs = [
    {
      template: templates4[0],
      name: '[POOL] Q1 2026 — ' + templates4[0].name,
      status: 'closed',
      completion: 0.8,
      withOutliers: true,           // bonus: outliers en respuestas
      includeTopLevel: false,
      lowResponseRatio: false,
      start: '2026-01-15',
      end: '2026-03-15',
    },
    {
      template: templates4[1],
      name: '[POOL] Q1 2026 — ' + templates4[1].name,
      status: 'closed',
      completion: 0.85,
      withOutliers: false,
      includeTopLevel: true,        // bonus: CEO sin manager (BR-A.1)
      lowResponseRatio: false,
      start: '2026-01-20',
      end: '2026-03-20',
    },
    {
      template: templates4[2],
      name: '[POOL] Q2 2026 — ' + templates4[2].name,
      status: 'active',
      completion: 0.5,
      withOutliers: false,
      includeTopLevel: false,
      lowResponseRatio: true,        // bonus: low response ratio (BR-B.3)
      start: '2026-04-01',
      end: '2026-06-15',
    },
    {
      template: templates4[3],
      name: '[POOL] Q2 2026 — ' + templates4[3].name,
      status: 'draft',
      completion: 0,
      withOutliers: false,
      includeTopLevel: false,
      lowResponseRatio: false,
      start: '2026-04-10',
      end: '2026-06-30',
    },
  ];

  // ── 8. Crear cada ciclo ─────────────────────────────────────────────
  let totalAssignments = 0;
  let totalResponses = 0;

  for (const config of cycleConfigs) {
    const tpl = config.template;
    const cycleType = tpl.default_cycle_type || '360';
    const allowedRelations = RELATIONS_BY_CYCLE_TYPE[cycleType] || ['self', 'manager'];
    const weights = DEFAULT_WEIGHTS[cycleType] || { manager: 1.0 };

    console.log(`\n━━━ ${config.name} ━━━`);
    console.log(`  Type: ${cycleType}° | Status: ${config.status} | Completion: ${(config.completion * 100).toFixed(0)}%`);

    // Eligible evaluatees (incluye top-level solo si config lo dice)
    const cycleEvaluatees = config.includeTopLevel
      ? evaluatees
      : evaluatees.filter((u: any) => u.id !== topLevel?.id);

    const cycleId = crypto.randomUUID();

    // 8.1 Crear ciclo (con campos del Sprint 1)
    const isLaunched = config.status !== 'draft';
    const launchedAt = isLaunched ? new Date(config.start) : null;
    await ds.query(
      `INSERT INTO evaluation_cycles (
        id, tenant_id, name, type, status, period, start_date, end_date,
        template_id, created_by, settings, total_evaluated,
        template_version_at_launch, template_snapshot, weights_at_launch, launched_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        cycleId,
        tenantId,
        config.name,
        cycleType,
        config.status,
        'quarterly',
        config.start,
        config.end,
        tpl.id,
        admin.id,
        JSON.stringify({
          weights,
          // Sprint 2 settings — dejarlos default para que demo cubra los casos
          minResponseRatio: 0.6,
          responseRatioStrategy: 'LINEAR',
          outlierStrategy: config.withOutliers ? 'NONE' : 'NONE',  // siempre NONE para demo (admin puede cambiar)
          // Sprint 3 settings
          minPeerCount: 3,
          peerScopingStrategy: 'SAME_DEPARTMENT',
        }),
        cycleEvaluatees.length,
        isLaunched ? (tpl.version || 1) : null,
        isLaunched
          ? JSON.stringify({
              template: { id: tpl.id, name: tpl.name, sections: tpl.sections },
              subTemplates: [], // se llenan abajo si hay sub_templates
            })
          : null,
        isLaunched ? JSON.stringify(weights) : null,
        launchedAt,
      ],
    );

    // 8.2 Cargar sub_templates del padre y poblar template_snapshot.subTemplates
    const subs = await ds.query(
      `SELECT id, relation_type, sections, weight, display_order, is_active
       FROM form_sub_templates
       WHERE parent_template_id = $1`,
      [tpl.id],
    );

    if (isLaunched && subs.length > 0) {
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

    // 8.3 Crear stages
    const stages: { name: string; type: string }[] = [];
    if (allowedRelations.includes('self')) stages.push({ name: 'Autoevaluación', type: 'self_evaluation' });
    if (allowedRelations.includes('manager')) stages.push({ name: 'Evaluación Jefatura', type: 'manager_evaluation' });
    if (allowedRelations.includes('peer')) stages.push({ name: 'Evaluación de Pares', type: 'peer_evaluation' });
    if (allowedRelations.includes('direct_report')) stages.push({ name: 'Evaluación Reportes Directos', type: 'direct_report_evaluation' });
    if (cycleType === '360') stages.push({ name: 'Calibración', type: 'calibration' });
    stages.push({ name: 'Entrega de Feedback', type: 'feedback_delivery' });
    stages.push({ name: 'Cerrado', type: 'closed' });

    const stageStatus = config.status === 'closed' ? 'completed' : config.status === 'active' ? 'in_progress' : 'pending';
    for (let i = 0; i < stages.length; i++) {
      await ds.query(
        `INSERT INTO cycle_stages (id, tenant_id, cycle_id, name, type, stage_order, status, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [crypto.randomUUID(), tenantId, cycleId, stages[i].name, stages[i].type, i + 1, stageStatus, config.start, config.end],
      );
    }

    if (!isLaunched) {
      console.log(`  ✓ Ciclo creado (DRAFT, sin assignments)`);
      continue;
    }

    // 8.4 Snapshot del organigrama (Sprint 1 BR-C.1)
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
          [], // secondary_managers se popula abajo si aplica
          u.department_id || null,
          u.department || null,
          u.hierarchy_level || null,
          u.role,
          true,
          launchedAt,
        ],
      );
    }

    // 8.5 Crear assignments (DIRECTAMENTE en evaluation_assignments porque el ciclo ya está launched)
    let cycleAssignments = 0;
    let cycleResponses = 0;
    const assignmentsByEvaluatee = new Map<string, string[]>(); // evaluateeId → roles asignados

    const completedDate = config.status === 'closed' ? new Date(config.end) : null;

    for (const evaluatee of cycleEvaluatees) {
      const rolesPresent: string[] = [];

      for (const relType of allowedRelations) {
        let evaluatorId: string | null = null;

        if (relType === 'self') {
          evaluatorId = evaluatee.id;
        } else if (relType === 'manager') {
          if (!evaluatee.manager_id) continue; // CEO sin manager (BR-A.1 captura esto)
          evaluatorId = evaluatee.manager_id;
        } else if (relType === 'peer') {
          // Mismo depto, no self, no manager
          const peerCandidates = users.filter(
            (u: any) =>
              u.id !== evaluatee.id &&
              u.id !== evaluatee.manager_id &&
              u.department === evaluatee.department,
          );
          if (peerCandidates.length === 0) continue;
          // Si lowResponseRatio: solo asignamos 1 par y luego vamos a "no responde"
          const numPeers = config.lowResponseRatio ? 1 : Math.min(3, peerCandidates.length);
          const selectedPeers = pickRandom<any>(peerCandidates, numPeers);
          for (const peer of selectedPeers) {
            const aid = crypto.randomUUID();
            await ds.query(
              `INSERT INTO evaluation_assignments (id, tenant_id, cycle_id, evaluatee_id, evaluator_id, relation_type, status, due_date, completed_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [aid, tenantId, cycleId, evaluatee.id, peer.id, 'peer',
                config.status === 'closed' ? 'completed' : (Math.random() < config.completion ? 'completed' : 'pending'),
                config.end,
                config.status === 'closed' ? completedDate : null],
            );
            cycleAssignments++;
            // Generate response if completed
            if (config.status === 'closed' || (config.status === 'active' && Math.random() < config.completion)) {
              await generateResponse(ds, aid, tenantId, tpl, subs, 'peer', config.withOutliers && Math.random() < 0.15);
              cycleResponses++;
            }
          }
          rolesPresent.push('peer');
          continue; // ya hicimos los peers
        } else if (relType === 'direct_report') {
          const reports = users.filter((u: any) => u.manager_id === evaluatee.id);
          if (reports.length === 0) continue;
          const dr = reports[randInt(0, reports.length - 1)];
          evaluatorId = dr.id;
        }

        if (!evaluatorId) continue;

        const aid = crypto.randomUUID();
        const isCompleted = config.status === 'closed' ? Math.random() < config.completion
          : config.status === 'active' ? Math.random() < config.completion
          : false;
        await ds.query(
          `INSERT INTO evaluation_assignments (id, tenant_id, cycle_id, evaluatee_id, evaluator_id, relation_type, status, due_date, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [aid, tenantId, cycleId, evaluatee.id, evaluatorId, relType,
            isCompleted ? 'completed' : 'pending',
            config.end,
            isCompleted ? completedDate : null],
        );
        cycleAssignments++;
        if (isCompleted) {
          await generateResponse(ds, aid, tenantId, tpl, subs, relType, false);
          cycleResponses++;
        }
        rolesPresent.push(relType);
      }

      assignmentsByEvaluatee.set(evaluatee.id, rolesPresent);
    }

    // 8.6 cycle_evaluatee_weights — pesos efectivos para evaluados con roles faltantes (BR-A.1 Sprint 2)
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
        effectiveWeights[role] = Math.round((weights[role] * totalWeight / activeWeightSum) * 10000) / 10000;
      }

      const reason = missing.length === 1 && missing[0] === 'manager'
        ? 'Sin jefe directo (top of organigrama)'
        : `Roles faltantes: ${missing.join(', ')}`;

      await ds.query(
        `INSERT INTO cycle_evaluatee_weights (cycle_id, evaluatee_id, tenant_id, effective_weights, strategy_used, missing_roles, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (cycle_id, evaluatee_id) DO NOTHING`,
        [cycleId, evaluateeId, tenantId, JSON.stringify(effectiveWeights), 'REDISTRIBUTE_PROPORTIONAL', missing, reason],
      );
      redistributedCount++;
    }

    console.log(`  ✓ Assignments: ${cycleAssignments}, Responses: ${cycleResponses}, Weights redistribuidos: ${redistributedCount}`);
    totalAssignments += cycleAssignments;
    totalResponses += cycleResponses;
  }

  // ── 9. Resumen final ───────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ✅ Pool de ciclos demo creado exitosamente');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Ciclos creados:      ${cycleConfigs.length}`);
  console.log(`  Total assignments:   ${totalAssignments}`);
  console.log(`  Total respuestas:    ${totalResponses}`);
  console.log('\n  Estados finales:');
  cycleConfigs.forEach((c) => {
    console.log(`    • ${c.name}`);
    console.log(`      → status=${c.status} completion=${(c.completion * 100).toFixed(0)}%`);
  });
  console.log('\n  Bonus simulaciones activadas:');
  console.log('    • Outliers en Q1 ciclo 1 (15% probabilidad por respuesta)');
  console.log(`    • CEO sin manager incluido en Q1 ciclo 2 (BR-A.1)`);
  console.log('    • Secondary manager seteado en 1 user (BR-A.4)');
  console.log('    • Low response ratio (1 peer) en Q2 ciclo 1 (BR-B.3)');

  await ds.destroy();
  console.log('\n✓ Done');
}

// ────────────────────────────────────────────────────────────────────────
// generateResponse: simula una respuesta realista
// ────────────────────────────────────────────────────────────────────────

async function generateResponse(
  ds: DataSource,
  assignmentId: string,
  tenantId: string,
  template: any,
  subs: any[],
  relationType: string,
  isOutlier: boolean,
) {
  // Buscar las preguntas que aplican a este relationType
  let sections: any[] = [];

  if (subs.length > 0) {
    const sub = subs.find((s) => s.relation_type === relationType && s.is_active);
    if (sub) sections = sub.sections;
  }

  if (sections.length === 0 && Array.isArray(template.sections)) {
    // Fallback: filtrar por applicableTo (legacy Fase 2)
    sections = template.sections.filter((sec: any) => {
      if (!sec.applicableTo || sec.applicableTo.length === 0) return true;
      return sec.applicableTo.includes(relationType);
    });
  }

  const answers: Record<string, any> = {};
  const scaleQs: string[] = [];
  const textQs: string[] = [];

  for (const sec of sections) {
    for (const q of (sec.questions || [])) {
      if (q.applicableTo && q.applicableTo.length > 0 && !q.applicableTo.includes(relationType)) continue;
      if (q.type === 'scale') scaleQs.push(q.id);
      else if (q.type === 'text') textQs.push(q.id);
    }
  }

  // Score base: 4-5 normalmente; 1-2 si es outlier
  for (const qId of scaleQs) {
    if (isOutlier) {
      answers[qId] = randInt(1, 2); // outlier — significativamente más bajo
    } else {
      const r = Math.random();
      answers[qId] = r < 0.05 ? 2 : r < 0.15 ? 3 : r < 0.50 ? 4 : 5;
    }
  }

  for (let i = 0; i < textQs.length; i++) {
    answers[textQs[i]] =
      i % 2 === 0 ? FORTALEZAS[randInt(0, FORTALEZAS.length - 1)] : MEJORAS[randInt(0, MEJORAS.length - 1)];
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

main().catch((e) => {
  console.error('\n✗ Error:', e);
  process.exit(1);
});
