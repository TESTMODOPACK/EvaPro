/**
 * seed-demo-evaluations.ts
 *
 * Elimina ciclos existentes de Demo Company y crea 4 nuevos ciclos
 * (uno por plantilla) con 80-100% evaluaciones completadas.
 *
 * Ejecutar: npx ts-node scripts/seed-demo-evaluations.ts
 * En Docker: node dist/scripts/seed-demo-evaluations.js
 */

import 'reflect-metadata';
import { DataSource, In } from 'typeorm';
import * as crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

// ── Score helpers ──
function randScore(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

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
  'Se mantiene actualizado y comparte conocimiento con el equipo',
  'Consistente en el cumplimiento de plazos y compromisos',
];

const MEJORAS = [
  'Podría mejorar la documentación de sus procesos',
  'Fortalecer habilidades de presentación ante públicos amplios',
  'Desarrollar mayor autonomía en la toma de decisiones',
  'Mejorar la gestión del tiempo en tareas de baja prioridad',
  'Trabajar en la delegación efectiva de responsabilidades',
  'Podría ser más asertivo al comunicar desacuerdos',
  'Mejorar seguimiento de compromisos asumidos en reuniones',
  'Desarrollar visión más estratégica y de largo plazo',
];

const CONSEJOS = [
  'Participar en un programa de mentoring como mentor',
  'Tomar un curso de gestión de proyectos o metodologías ágiles',
  'Liderar una iniciativa transversal para desarrollar visión estratégica',
  'Realizar una certificación en su área de especialidad',
  'Participar en presentaciones internas para ganar confianza',
  'Asumir un proyecto desafiante fuera de su zona de confort',
];

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
    synchronize: false,
    logging: false,
  });

  await ds.initialize();
  console.log('Connected to database.\n');

  // ── 1. Find Demo Company ──
  const tenantRow = await ds.query(`SELECT id, name FROM tenants WHERE slug = 'demo' OR name ILIKE '%demo%' LIMIT 1`);
  if (!tenantRow.length) { console.error('Demo Company not found'); process.exit(1); }
  const tenantId = tenantRow[0].id;
  console.log(`Tenant: ${tenantRow[0].name} (${tenantId})`);

  // ── 2. Get all users ──
  const users = await ds.query(`
    SELECT id, email, first_name, last_name, role, department, manager_id, hierarchy_level
    FROM users WHERE tenant_id = $1 AND is_active = true AND role != 'super_admin'
    ORDER BY hierarchy_level ASC NULLS LAST, first_name
  `, [tenantId]);
  console.log(`Users: ${users.length}`);

  const admin = users.find((u: any) => u.role === 'tenant_admin');
  const managers = users.filter((u: any) => u.role === 'manager');
  const employees = users.filter((u: any) => u.role === 'employee');
  const evaluatees = [...managers, ...employees]; // todos menos super_admin
  console.log(`  Admin: ${admin?.email}, Managers: ${managers.length}, Employees: ${employees.length}`);
  console.log(`  Evaluatees: ${evaluatees.length}`);

  // ── 3. Delete existing cycles + related data ──
  console.log('\nDeleting existing evaluation data...');
  const existingCycles = await ds.query(`SELECT id, name FROM evaluation_cycles WHERE tenant_id = $1`, [tenantId]);

  for (const cycle of existingCycles) {
    // Delete in order: responses → assignments → peer_assignments → stages → related FKs → cycle
    await ds.query(`DELETE FROM evaluation_responses WHERE tenant_id = $1 AND assignment_id IN (SELECT id FROM evaluation_assignments WHERE cycle_id = $2)`, [tenantId, cycle.id]);
    await ds.query(`DELETE FROM evaluation_assignments WHERE tenant_id = $1 AND cycle_id = $2`, [tenantId, cycle.id]);
    await ds.query(`DELETE FROM peer_assignments WHERE tenant_id = $1 AND cycle_id = $2`, [tenantId, cycle.id]);
    await ds.query(`DELETE FROM cycle_stages WHERE tenant_id = $1 AND cycle_id = $2`, [tenantId, cycle.id]);
    // Clear ALL FK references from other tables
    try { await ds.query(`UPDATE development_plans SET cycle_id = NULL WHERE cycle_id = $1`, [cycle.id]); } catch {}
    try { await ds.query(`DELETE FROM talent_assessments WHERE cycle_id = $1`, [cycle.id]); } catch {}
    try { await ds.query(`DELETE FROM calibration_entries WHERE session_id IN (SELECT id FROM calibration_sessions WHERE cycle_id = $1)`, [cycle.id]); } catch {}
    try { await ds.query(`DELETE FROM calibration_sessions WHERE cycle_id = $1`, [cycle.id]); } catch {}
    try { await ds.query(`DELETE FROM ai_insights WHERE metadata->>'cycleId' = $1`, [cycle.id]); } catch {}
    await ds.query(`DELETE FROM evaluation_cycles WHERE id = $1`, [cycle.id]);
    console.log(`  Deleted: ${cycle.name}`);
  }

  // ── 4. Get templates ──
  const templates = await ds.query(`
    SELECT id, name, sections FROM form_templates
    WHERE (tenant_id = $1 OR tenant_id IS NULL) AND status = 'published'
    ORDER BY created_at ASC
  `, [tenantId]);
  console.log(`\nTemplates found: ${templates.length}`);
  templates.forEach((t: any) => console.log(`  - ${t.name} (${t.id.slice(0, 8)})`));

  if (templates.length < 4) {
    console.error('Need at least 4 templates. Found:', templates.length);
    process.exit(1);
  }

  // ── 5. Create 4 cycles ──
  const cycleConfigs = [
    { name: 'Q1 2026 — Evaluación de Liderazgo', type: '90', template: templates.find((t: any) => t.name.includes('Liderazgo')) || templates[0], period: 'quarterly', start: '2026-01-06', end: '2026-03-14' },
    { name: 'S1 2026 — Evaluación Técnica', type: '180', template: templates.find((t: any) => t.name.includes('Técnica')) || templates[1], period: 'biannual', start: '2026-01-15', end: '2026-06-30' },
    { name: 'Q2 2026 — Evaluación 360° Completa', type: '360', template: templates.find((t: any) => t.name.includes('360')) || templates[2], period: 'quarterly', start: '2026-04-01', end: '2026-06-15' },
    { name: 'S1 2026 — Evaluación Servicio al Cliente', type: '270', template: templates.find((t: any) => t.name.includes('Servicio') || t.name.includes('Cliente')) || templates[3], period: 'biannual', start: '2026-02-01', end: '2026-06-30' },
  ];

  let totalAssignments = 0;
  let totalCompleted = 0;

  for (const config of cycleConfigs) {
    console.log(`\n━━━ Creating: ${config.name} (${config.type}°) ━━━`);
    console.log(`  Template: ${config.template.name}`);

    // Create cycle
    const cycleId = crypto.randomUUID();
    await ds.query(`
      INSERT INTO evaluation_cycles (id, tenant_id, name, type, status, period, start_date, end_date, template_id, created_by, settings, total_evaluated)
      VALUES ($1, $2, $3, $4, 'closed', $5, $6, $7, $8, $9, '{}', $10)
    `, [cycleId, tenantId, config.name, config.type, config.period, config.start, config.end, config.template.id, admin?.id, evaluatees.length]);

    // Create stages
    const stageTypes: { name: string; type: string }[] = [];
    if (['180', '270', '360'].includes(config.type)) stageTypes.push({ name: 'Autoevaluación', type: 'self_evaluation' });
    stageTypes.push({ name: 'Evaluación Jefatura', type: 'manager_evaluation' });
    if (['270', '360'].includes(config.type)) stageTypes.push({ name: 'Evaluación de Pares', type: 'peer_evaluation' });
    if (config.type === '360') stageTypes.push({ name: 'Calibración', type: 'calibration' });
    stageTypes.push({ name: 'Entrega de Feedback', type: 'feedback_delivery' });
    stageTypes.push({ name: 'Cerrado', type: 'closed' });

    for (let i = 0; i < stageTypes.length; i++) {
      await ds.query(`
        INSERT INTO cycle_stages (id, tenant_id, cycle_id, name, type, stage_order, status, start_date, end_date)
        VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8)
      `, [crypto.randomUUID(), tenantId, cycleId, stageTypes[i].name, stageTypes[i].type, i + 1, config.start, config.end]);
    }

    // Get scale questions from template
    const sections = typeof config.template.sections === 'string' ? JSON.parse(config.template.sections) : config.template.sections;
    const scaleQuestions: string[] = [];
    const textQuestions: string[] = [];
    for (const sec of sections) {
      for (const q of (sec.questions || [])) {
        if (q.type === 'scale') scaleQuestions.push(q.id);
        else if (q.type === 'text') textQuestions.push(q.id);
      }
    }

    // Determine relation types per cycle type
    const relationTypes: string[] = [];
    if (['180', '270', '360'].includes(config.type)) relationTypes.push('self');
    relationTypes.push('manager');
    if (['270', '360'].includes(config.type)) relationTypes.push('peer');
    if (config.type === '360') relationTypes.push('direct_report');

    // Create assignments + responses
    let cycleAssignments = 0;
    let cycleCompleted = 0;

    for (const evaluatee of evaluatees) {
      for (const relType of relationTypes) {
        let evaluatorId: string | null = null;

        if (relType === 'self') {
          evaluatorId = evaluatee.id;
        } else if (relType === 'manager') {
          evaluatorId = evaluatee.manager_id;
          if (!evaluatorId) continue; // skip if no manager
        } else if (relType === 'peer') {
          // Pick a random peer from same department (not self, not manager)
          const peers = evaluatees.filter((u: any) =>
            u.id !== evaluatee.id &&
            u.id !== evaluatee.manager_id &&
            u.department === evaluatee.department
          );
          if (peers.length === 0) continue;
          const peer = peers[randInt(0, peers.length - 1)];
          evaluatorId = peer.id;
        } else if (relType === 'direct_report') {
          // Find a direct report
          const reports = evaluatees.filter((u: any) => u.manager_id === evaluatee.id);
          if (reports.length === 0) continue;
          evaluatorId = reports[randInt(0, reports.length - 1)].id;
        }

        if (!evaluatorId) continue;

        // Check for duplicate
        const existing = await ds.query(`
          SELECT id FROM evaluation_assignments
          WHERE cycle_id = $1 AND evaluatee_id = $2 AND evaluator_id = $3 AND relation_type = $4
        `, [cycleId, evaluatee.id, evaluatorId, relType]);
        if (existing.length > 0) continue;

        // Decide if completed (80-100%)
        const isCompleted = Math.random() < (0.80 + Math.random() * 0.20); // 80-100%
        const status = isCompleted ? 'completed' : 'pending';
        const completedAt = isCompleted ? new Date(config.end) : null;

        const assignmentId = crypto.randomUUID();
        await ds.query(`
          INSERT INTO evaluation_assignments (id, tenant_id, cycle_id, evaluatee_id, evaluator_id, relation_type, status, due_date, completed_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [assignmentId, tenantId, cycleId, evaluatee.id, evaluatorId, relType, status, config.end, completedAt]);

        cycleAssignments++;

        // Create response for completed assignments
        if (isCompleted) {
          const answers: Record<string, any> = {};

          // Scale answers: realistic distribution (mostly 3-5, occasional 2)
          for (const qId of scaleQuestions) {
            const r = Math.random();
            if (r < 0.05) answers[qId] = 2;
            else if (r < 0.20) answers[qId] = 3;
            else if (r < 0.55) answers[qId] = 4;
            else answers[qId] = 5;
          }

          // Text answers
          for (const qId of textQuestions) {
            const idx = textQuestions.indexOf(qId);
            if (idx === 0) answers[qId] = FORTALEZAS[randInt(0, FORTALEZAS.length - 1)];
            else if (idx === 1) answers[qId] = MEJORAS[randInt(0, MEJORAS.length - 1)];
            else answers[qId] = CONSEJOS[randInt(0, CONSEJOS.length - 1)];
          }

          // Calculate overall score (avg of scale questions, normalized to 0-10)
          const nums = Object.values(answers).filter(v => typeof v === 'number') as number[];
          const avg = nums.length > 0 ? nums.reduce((s, v) => s + v, 0) / nums.length : 0;
          const overallScore = Math.round((avg / 5) * 10 * 100) / 100;

          await ds.query(`
            INSERT INTO evaluation_responses (id, tenant_id, assignment_id, answers, overall_score, submitted_at)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [crypto.randomUUID(), tenantId, assignmentId, JSON.stringify(answers), overallScore, completedAt]);

          cycleCompleted++;
        }
      }
    }

    totalAssignments += cycleAssignments;
    totalCompleted += cycleCompleted;

    const pct = cycleAssignments > 0 ? Math.round((cycleCompleted / cycleAssignments) * 100) : 0;
    console.log(`  Assignments: ${cycleAssignments}, Completed: ${cycleCompleted} (${pct}%)`);
  }

  console.log(`\n═══ SEED COMPLETE ═══`);
  console.log(`Total assignments: ${totalAssignments}`);
  console.log(`Total completed: ${totalCompleted} (${Math.round((totalCompleted / totalAssignments) * 100)}%)`);

  await ds.destroy();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
