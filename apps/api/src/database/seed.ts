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
import { Department } from '../modules/tenants/entities/department.entity';
import { Position } from '../modules/tenants/entities/position.entity';
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
import { MeetingLocation } from '../modules/feedback/entities/meeting-location.entity';
import { Objective } from '../modules/objectives/entities/objective.entity';
import { ObjectiveUpdate } from '../modules/objectives/entities/objective-update.entity';
import { ObjectiveComment } from '../modules/objectives/entities/objective-comment.entity';
import { KeyResult } from '../modules/objectives/entities/key-result.entity';

// ── Phase 3 ────────────────────────────────────────────────────────────────
import { UserNote } from '../modules/users/entities/user-note.entity';
import { UserDeparture } from '../modules/users/entities/user-departure.entity';
import { UserMovement } from '../modules/users/entities/user-movement.entity';
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

// ── Phase 3: AI Insights ─────────────────────────────────────────────────
import { AiInsight } from '../modules/ai-insights/entities/ai-insight.entity';

// ── PDO: Org Development ─────────────────────────────────────────────────
import { OrgDevelopmentPlan } from '../modules/org-development/entities/org-development-plan.entity';
import { OrgDevelopmentInitiative } from '../modules/org-development/entities/org-development-initiative.entity';
import { OrgDevelopmentAction } from '../modules/org-development/entities/org-development-action.entity';

// ── Additional entities (needed for TypeORM synchronize) ─────────────────
import { PaymentHistory } from '../modules/subscriptions/entities/payment-history.entity';
import { RoleCompetency } from '../modules/development/entities/role-competency.entity';
import { Recognition } from '../modules/recognition/entities/recognition.entity';
import { Badge } from '../modules/recognition/entities/badge.entity';
import { UserBadge } from '../modules/recognition/entities/user-badge.entity';
import { UserPoints } from '../modules/recognition/entities/user-points.entity';
import { SystemChangelog } from '../modules/system/entities/system-changelog.entity';
import { CustomKpi } from '../modules/reports/entities/custom-kpi.entity';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL not set — cannot seed.');
  process.exit(1);
}

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  entities: [
    // Phase 1
    Tenant, Department, Position, User, FormTemplate,
    EvaluationCycle, EvaluationAssignment, EvaluationResponse,
    BulkImport, AuditLog, PeerAssignment, CycleStage,
    // Phase 2
    CheckIn, QuickFeedback, MeetingLocation,
    Objective, ObjectiveUpdate, ObjectiveComment, KeyResult,
    // Phase 3
    UserNote, UserDeparture, UserMovement, SubscriptionPlan, Subscription,
    // Phase 4
    TalentAssessment, CalibrationSession, CalibrationEntry,
    // Phase 5
    Competency, DevelopmentPlan, DevelopmentAction, DevelopmentComment,
    // B3: Notifications
    Notification,
    // Phase 3: AI
    AiInsight,
    // Billing & new modules
    PaymentHistory, RoleCompetency,
    Recognition, Badge, UserBadge, UserPoints,
    SystemChangelog, CustomKpi,
    // PDO: Org Development
    OrgDevelopmentPlan, OrgDevelopmentInitiative, OrgDevelopmentAction,
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
    title: 'Competencias Técnicas',
    description: 'Evalúe el dominio técnico y la calidad del trabajo del colaborador.',
    questions: [
      { id: 'q1', text: 'Domina las herramientas, metodologías y conocimientos requeridos por su cargo', type: 'scale', scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } }, required: true },
      { id: 'q2', text: 'La calidad de sus entregables es consistente y cumple con los estándares esperados', type: 'scale', scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } }, required: true },
      { id: 'q3', text: 'Se mantiene actualizado y busca mejorar continuamente sus conocimientos', type: 'scale', scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } }, required: true },
    ],
  },
  {
    id: 'sec2',
    title: 'Competencias Blandas',
    description: 'Evalúe las habilidades interpersonales y de comunicación.',
    questions: [
      { id: 'q4', text: 'Se comunica de forma clara, respetuosa y efectiva con su entorno', type: 'scale', scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } }, required: true },
      { id: 'q5', text: 'Colabora efectivamente con otros miembros del equipo y áreas transversales', type: 'scale', scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } }, required: true },
      { id: 'q6', text: 'Se adapta positivamente a los cambios y nuevas situaciones', type: 'scale', scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } }, required: true },
      { id: 'q7', text: 'Demuestra creatividad e innovación al proponer soluciones', type: 'scale', scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } }, required: true },
    ],
  },
  {
    id: 'sec3',
    title: 'Orientación a Resultados',
    description: 'Evalúe el compromiso con los objetivos y la productividad.',
    questions: [
      { id: 'q8', text: 'Cumple con sus compromisos, metas y plazos asignados', type: 'scale', scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } }, required: true },
      { id: 'q9', text: 'Toma iniciativa y propone mejoras de forma proactiva', type: 'scale', scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } }, required: true },
      { id: 'q10', text: 'Prioriza actividades según su impacto en los resultados del equipo', type: 'scale', scale: { min: 1, max: 5, labels: { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' } }, required: true },
    ],
  },
  {
    id: 'sec4',
    title: 'Retroalimentación General',
    description: 'Espacio para comentarios cualitativos sobre el desempeño.',
    questions: [
      { id: 'q11', text: '¿Cuáles son las principales fortalezas del colaborador?', type: 'text', required: true },
      { id: 'q12', text: '¿En qué áreas específicas podría mejorar?', type: 'text', required: true },
      { id: 'q13', text: '¿Qué acción concreta recomendaría para su plan de desarrollo?', type: 'text', required: false },
    ],
  },
];

/* ── System Templates (global, tenantId = null) ────────────────────────── */
const SCALE_LABELS = { 1: 'Deficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy Bueno', 5: 'Excelente' };
const scale = () => ({ min: 1, max: 5, labels: SCALE_LABELS });

const SYSTEM_TEMPLATES = [
  {
    name: 'Evaluación de Liderazgo',
    description: 'Plantilla para evaluar competencias de liderazgo y gestión de equipos. Ideal para gerentes, subgerentes y jefes de área.',
    sections: [
      { id: 'lid1', title: 'Visión Estratégica y Gestión', description: 'Capacidad de definir rumbo y tomar decisiones acertadas.', questions: [
        { id: 'l1', text: 'Define objetivos claros y alineados con la estrategia de la organización', type: 'scale', scale: scale(), required: true },
        { id: 'l2', text: 'Anticipa riesgos y oportunidades del entorno', type: 'scale', scale: scale(), required: true },
        { id: 'l3', text: 'Comunica la visión de forma inspiradora al equipo', type: 'scale', scale: scale(), required: true },
        { id: 'l4', text: 'Toma decisiones oportunas basadas en datos y análisis', type: 'scale', scale: scale(), required: true },
        { id: 'l5', text: 'Asume responsabilidad por los resultados de su área', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'lid2', title: 'Gestión de Personas y Desarrollo de Talento', description: 'Habilidad para liderar, motivar y desarrollar al equipo.', questions: [
        { id: 'l6', text: 'Delega responsabilidades de forma efectiva según las capacidades del equipo', type: 'scale', scale: scale(), required: true },
        { id: 'l7', text: 'Desarrolla activamente el talento de sus colaboradores (feedback, coaching, planes de desarrollo)', type: 'scale', scale: scale(), required: true },
        { id: 'l8', text: 'Gestiona conflictos de manera constructiva y oportuna', type: 'scale', scale: scale(), required: true },
        { id: 'l9', text: 'Reconoce y valora los logros individuales y colectivos del equipo', type: 'scale', scale: scale(), required: true },
        { id: 'l10', text: 'Crea un ambiente de confianza donde el equipo puede expresar ideas y preocupaciones', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'lid3', title: 'Comunicación e Influencia', description: 'Efectividad como comunicador y referente organizacional.', questions: [
        { id: 'l11', text: 'Comunica cambios y decisiones de forma transparente y oportuna', type: 'scale', scale: scale(), required: true },
        { id: 'l12', text: 'Promueve la colaboración entre su equipo y otras áreas', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'lid4', title: 'Retroalimentación de Liderazgo', questions: [
        { id: 'l13', text: '¿Cuál es la mayor fortaleza de liderazgo de esta persona?', type: 'text', required: true },
        { id: 'l14', text: '¿Qué acción concreta mejoraría su liderazgo?', type: 'text', required: true },
        { id: 'l15', text: '¿Cómo describiría el clima del equipo bajo su dirección?', type: 'text', required: false },
      ]},
    ],
  },
  {
    name: 'Evaluación Técnica y Operativa',
    description: 'Plantilla para evaluar competencias técnicas, resolución de problemas y productividad. Para roles operativos, especialistas y analistas.',
    sections: [
      { id: 'tec1', title: 'Conocimiento Técnico', description: 'Dominio de herramientas y conocimientos del cargo.', questions: [
        { id: 't1', text: 'Domina las herramientas y tecnologías requeridas por el cargo', type: 'scale', scale: scale(), required: true },
        { id: 't2', text: 'Se mantiene actualizado en su área de especialidad', type: 'scale', scale: scale(), required: true },
        { id: 't3', text: 'Aplica mejores prácticas y estándares de la industria', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'tec2', title: 'Resolución de Problemas e Innovación', description: 'Capacidad analítica y propositiva.', questions: [
        { id: 't4', text: 'Identifica la causa raíz de los problemas de forma metódica', type: 'scale', scale: scale(), required: true },
        { id: 't5', text: 'Propone soluciones innovadoras y eficientes', type: 'scale', scale: scale(), required: true },
        { id: 't6', text: 'Documenta su trabajo y comparte conocimiento con el equipo', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'tec3', title: 'Productividad y Cumplimiento', description: 'Compromiso con plazos y calidad de entregables.', questions: [
        { id: 't7', text: 'Cumple con los plazos y compromisos establecidos', type: 'scale', scale: scale(), required: true },
        { id: 't8', text: 'La calidad de sus entregables es consistente y confiable', type: 'scale', scale: scale(), required: true },
        { id: 't9', text: 'Gestiona su tiempo y prioridades de forma efectiva', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'tec4', title: 'Retroalimentación Técnica', questions: [
        { id: 't10', text: '¿En qué área técnica destaca más esta persona?', type: 'text', required: true },
        { id: 't11', text: '¿Qué capacitación o certificación le beneficiaría?', type: 'text', required: false },
      ]},
    ],
  },
  {
    name: 'Evaluación 360° Completa',
    description: 'Plantilla integral para evaluación 360° que cubre todas las competencias organizacionales. Diseñada para recibir evaluaciones de jefe, pares, reportes directos y autoevaluación.',
    sections: [
      { id: '360a', title: 'Competencias Transversales', description: 'Habilidades interpersonales y valores organizacionales.', questions: [
        { id: 'f1', text: 'Se comunica de forma clara, respetuosa y asertiva', type: 'scale', scale: scale(), required: true },
        { id: 'f2', text: 'Colabora efectivamente con personas de distintas áreas y niveles', type: 'scale', scale: scale(), required: true },
        { id: 'f3', text: 'Demuestra integridad y ética profesional en todas sus acciones', type: 'scale', scale: scale(), required: true },
        { id: 'f4', text: 'Se adapta positivamente a los cambios y nuevas situaciones', type: 'scale', scale: scale(), required: true },
      ]},
      { id: '360b', title: 'Orientación a Resultados', description: 'Compromiso con los objetivos y la mejora continua.', questions: [
        { id: 'f5', text: 'Cumple sus compromisos, metas y plazos asignados', type: 'scale', scale: scale(), required: true },
        { id: 'f6', text: 'Prioriza actividades según su impacto en los resultados del equipo y organización', type: 'scale', scale: scale(), required: true },
        { id: 'f7', text: 'Busca continuamente mejorar sus procesos de trabajo', type: 'scale', scale: scale(), required: true },
        { id: 'f8', text: 'Toma iniciativa y propone soluciones sin esperar instrucciones', type: 'scale', scale: scale(), required: true },
      ]},
      { id: '360c', title: 'Liderazgo y Trabajo en Equipo', description: 'Influencia positiva en el equipo, independiente del cargo.', questions: [
        { id: 'f9', text: 'Contribuye a un ambiente de trabajo positivo y colaborativo', type: 'scale', scale: scale(), required: true },
        { id: 'f10', text: 'Comparte conocimiento y ayuda al desarrollo de sus compañeros', type: 'scale', scale: scale(), required: true },
        { id: 'f11', text: 'Acepta y aplica retroalimentación de forma constructiva', type: 'scale', scale: scale(), required: true },
      ]},
      { id: '360d', title: 'Desarrollo Profesional', description: 'Compromiso con el aprendizaje y crecimiento.', questions: [
        { id: 'f12', text: 'Busca activamente oportunidades de aprendizaje y capacitación', type: 'scale', scale: scale(), required: true },
        { id: 'f13', text: 'Aplica nuevos conocimientos y habilidades en su trabajo diario', type: 'scale', scale: scale(), required: true },
      ]},
      { id: '360e', title: 'Retroalimentación Abierta', description: 'Comentarios cualitativos para complementar la evaluación numérica.', questions: [
        { id: 'f14', text: '¿Cuáles son las 3 principales fortalezas de esta persona?', type: 'text', required: true },
        { id: 'f15', text: '¿Qué debería dejar de hacer o cambiar?', type: 'text', required: true },
        { id: 'f16', text: '¿Qué consejo le darías para su desarrollo profesional?', type: 'text', required: false },
      ]},
    ],
  },
  {
    name: 'Evaluación de Servicio al Cliente',
    description: 'Plantilla para evaluar competencias de atención, empatía y orientación al servicio. Para roles de soporte, ventas y atención al público.',
    sections: [
      { id: 'srv1', title: 'Atención y Empatía', description: 'Calidad de la interacción con clientes.', questions: [
        { id: 's1', text: 'Atiende a los clientes con amabilidad, empatía y paciencia', type: 'scale', scale: scale(), required: true },
        { id: 's2', text: 'Escucha activamente las necesidades del cliente antes de responder', type: 'scale', scale: scale(), required: true },
        { id: 's3', text: 'Resuelve consultas de forma rápida y efectiva', type: 'scale', scale: scale(), required: true },
        { id: 's4', text: 'Maneja quejas y reclamos con profesionalismo, buscando soluciones', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'srv2', title: 'Conocimiento y Proactividad', description: 'Dominio del producto/servicio y capacidad de anticipación.', questions: [
        { id: 's5', text: 'Domina las características de los productos o servicios de la organización', type: 'scale', scale: scale(), required: true },
        { id: 's6', text: 'Identifica oportunidades para mejorar la experiencia del cliente', type: 'scale', scale: scale(), required: true },
        { id: 's7', text: 'Hace seguimiento proactivo para asegurar la satisfacción del cliente', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'srv3', title: 'Retroalimentación de Servicio', questions: [
        { id: 's8', text: '¿Qué hace bien esta persona al atender clientes?', type: 'text', required: true },
        { id: 's9', text: '¿Cómo podría mejorar la experiencia del cliente?', type: 'text', required: true },
      ]},
    ],
  },
  {
    name: 'Evaluación por Competencias Organizacionales',
    description: 'Plantilla alineada al modelo de competencias de la organización. Cubre las 8 competencias base del sistema: Liderazgo, Comunicación, Trabajo en equipo, Resolución de problemas, Adaptabilidad, Orientación a resultados, Conocimiento técnico, Creatividad e innovación.',
    sections: [
      { id: 'comp1', title: 'Liderazgo', description: 'Capacidad de influir, guiar y motivar a otros.', questions: [
        { id: 'c1', text: 'Inspira confianza y guía a otros con su ejemplo', type: 'scale', scale: scale(), required: true },
        { id: 'c2', text: 'Toma decisiones responsables considerando el impacto en el equipo', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'comp2', title: 'Comunicación', description: 'Efectividad para transmitir y recibir información.', questions: [
        { id: 'c3', text: 'Se expresa con claridad, tanto verbal como escritamente', type: 'scale', scale: scale(), required: true },
        { id: 'c4', text: 'Escucha activamente y demuestra comprensión de otros puntos de vista', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'comp3', title: 'Trabajo en Equipo', description: 'Colaboración y contribución al logro colectivo.', questions: [
        { id: 'c5', text: 'Colabora activamente y contribuye al logro de los objetivos del equipo', type: 'scale', scale: scale(), required: true },
        { id: 'c6', text: 'Apoya a sus compañeros y comparte conocimiento sin restricción', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'comp4', title: 'Resolución de Problemas', description: 'Capacidad analítica y orientación a soluciones.', questions: [
        { id: 'c7', text: 'Analiza problemas desde múltiples perspectivas antes de actuar', type: 'scale', scale: scale(), required: true },
        { id: 'c8', text: 'Genera soluciones prácticas y efectivas ante situaciones complejas', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'comp5', title: 'Adaptabilidad', description: 'Flexibilidad ante cambios y nuevos desafíos.', questions: [
        { id: 'c9', text: 'Se adapta rápidamente a cambios en procesos, prioridades o entorno', type: 'scale', scale: scale(), required: true },
        { id: 'c10', text: 'Mantiene un desempeño estable bajo presión o incertidumbre', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'comp6', title: 'Orientación a Resultados', description: 'Compromiso con el logro de metas y la excelencia.', questions: [
        { id: 'c11', text: 'Se enfoca en cumplir y superar las metas establecidas', type: 'scale', scale: scale(), required: true },
        { id: 'c12', text: 'Mide su propio desempeño y busca mejorar continuamente', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'comp7', title: 'Conocimiento Técnico', description: 'Dominio de las habilidades y herramientas del cargo.', questions: [
        { id: 'c13', text: 'Posee el conocimiento técnico necesario para desempeñar su rol con efectividad', type: 'scale', scale: scale(), required: true },
        { id: 'c14', text: 'Se mantiene actualizado en su área de especialización', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'comp8', title: 'Creatividad e Innovación', description: 'Capacidad de generar ideas nuevas y mejorar procesos.', questions: [
        { id: 'c15', text: 'Propone ideas innovadoras para mejorar procesos o resultados', type: 'scale', scale: scale(), required: true },
        { id: 'c16', text: 'Está abierto a nuevas formas de hacer las cosas y experimentar', type: 'scale', scale: scale(), required: true },
      ]},
      { id: 'comp9', title: 'Retroalimentación por Competencias', questions: [
        { id: 'c17', text: '¿En qué competencia destaca más esta persona? Explique con un ejemplo concreto.', type: 'text', required: true },
        { id: 'c18', text: '¿Qué competencia debería desarrollar como prioridad?', type: 'text', required: true },
        { id: 'c19', text: '¿Qué acción específica recomendaría para su plan de desarrollo individual?', type: 'text', required: false },
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

    // Ensure PostgreSQL enum includes new AI insight types
    try {
      await dataSource.query(`ALTER TYPE ai_insights_type_enum ADD VALUE IF NOT EXISTS 'cv_analysis'`);
      await dataSource.query(`ALTER TYPE ai_insights_type_enum ADD VALUE IF NOT EXISTS 'recruitment_recommendation'`);
      console.log('✅ AI insight type enum updated');
    } catch (e: any) {
      // Ignore if already exists or enum name is different
      console.log('   AI enum update skipped:', e.message?.slice(0, 80));
    }

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

    /* ── Subscription Plans (UF pricing) + Demo Subscription ──────────── */
    // Prices in UF (Unidad de Fomento, Chile) — reajustable por IPC
    // UF March 2026 ≈ $39.841 CLP
    // ── Create each plan independently (upsert pattern) ──────────────────
    const planDefs = [
      {
        code: 'starter', name: 'Starter', displayOrder: 1,
        description: 'Gratis — Ideal para conocer EvaPro (hasta 15 usuarios, 2 ciclos/año)',
        maxEmployees: 15, monthlyPrice: 0,
        features: ['EVAL_90_180', 'BASIC_REPORTS'],
      },
      {
        code: 'growth', name: 'Growth', displayOrder: 2,
        description: 'Para PYMEs en crecimiento — 1,5 UF/mes (hasta 50 usuarios)',
        maxEmployees: 50, monthlyPrice: 1.5,
        quarterlyPrice: 4.05, semiannualPrice: 7.65, yearlyPrice: 14.40,
        features: ['EVAL_90_180', 'EVAL_270', 'BASIC_REPORTS', 'OKR', 'FEEDBACK', 'CHECKINS', 'TEMPLATES_CUSTOM', 'RECOGNITION', 'ENGAGEMENT_SURVEYS'],
      },
      {
        code: 'pro', name: 'Pro', displayOrder: 3,
        description: 'Para empresas medianas — 3,5 UF/mes (hasta 200 usuarios)',
        maxEmployees: 200, monthlyPrice: 3.5,
        quarterlyPrice: 9.45, semiannualPrice: 17.85, yearlyPrice: 33.60,
        features: ['EVAL_90_180', 'EVAL_270', 'EVAL_360', 'BASIC_REPORTS', 'ADVANCED_REPORTS', 'ANALYTICS_REPORTS', 'OKR', 'FEEDBACK', 'CHECKINS', 'TEMPLATES_CUSTOM', 'PDI', 'NINE_BOX', 'CALIBRATION', 'POSTULANTS', 'RECOGNITION', 'ORG_DEVELOPMENT', 'SIGNATURES', 'ENGAGEMENT_SURVEYS', 'AUDIT_LOG', 'DEI'],
        maxAiCallsPerMonth: 100,
      },
      {
        code: 'enterprise', name: 'Enterprise', displayOrder: 4,
        description: 'Para corporativos y consultores — 8 UF/mes (usuarios ilimitados)',
        maxEmployees: 9999, monthlyPrice: 8,
        quarterlyPrice: 21.60, semiannualPrice: 40.80, yearlyPrice: 76.80,
        features: ['EVAL_90_180', 'EVAL_270', 'EVAL_360', 'BASIC_REPORTS', 'ADVANCED_REPORTS', 'ANALYTICS_REPORTS', 'OKR', 'FEEDBACK', 'CHECKINS', 'TEMPLATES_CUSTOM', 'PDI', 'NINE_BOX', 'CALIBRATION', 'POSTULANTS', 'RECOGNITION', 'ORG_DEVELOPMENT', 'SIGNATURES', 'ENGAGEMENT_SURVEYS', 'AUDIT_LOG', 'DEI', 'AI_INSIGHTS', 'PUBLIC_API'],
        maxAiCallsPerMonth: 400,
      },
    ];

    let starterPlan: any = null;
    for (const def of planDefs) {
      let plan = await planRepo.findOne({ where: { code: def.code } });
      if (!plan) {
        plan = planRepo.create({ ...def, isActive: true });
        plan = await planRepo.save(plan);
        console.log(`✅  Plan "${def.name}" created (${def.monthlyPrice} UF/mes)`);
      } else {
        // Ensure all required features exist
        const missing = (def.features || []).filter((f: string) => !(plan!.features || []).includes(f));
        let changed = false;
        if (missing.length > 0) {
          plan.features = [...(plan.features || []), ...missing];
          changed = true;
          console.log(`✅  Added features to "${plan.name}": ${missing.join(', ')}`);
        }
        // Ensure maxAiCallsPerMonth is set correctly
        if (def.maxAiCallsPerMonth && (!plan.maxAiCallsPerMonth || plan.maxAiCallsPerMonth < def.maxAiCallsPerMonth)) {
          plan.maxAiCallsPerMonth = def.maxAiCallsPerMonth;
          changed = true;
          console.log(`✅  Updated "${plan.name}" maxAiCallsPerMonth → ${def.maxAiCallsPerMonth}`);
        }
        if (changed) await planRepo.save(plan);
      }
      if (def.code === 'starter') starterPlan = plan;
    }

    // Use Enterprise plan for demo to test AI features
    const enterprisePlan = await planRepo.findOne({ where: { code: 'enterprise' } });
    // Find the active subscription (same logic as SubscriptionsService.findByTenantId)
    let subscription = await subRepo.findOne({
      where: { tenantId: tenant.id, status: 'active' },
      order: { createdAt: 'DESC' as const },
    }) || await subRepo.findOne({
      where: { tenantId: tenant.id },
      order: { createdAt: 'DESC' as const },
    });
    if (!subscription) {
      subscription = subRepo.create({
        tenantId: tenant.id,
        planId: enterprisePlan?.id || starterPlan.id,
        status: 'active',
        startDate: new Date(),
        aiAddonCalls: 50,
      });
      await subRepo.save(subscription);
      console.log('\u2705  Subscription created for demo tenant (Enterprise plan, 50 addon credits)');
    } else {
      // Migrate existing subscription to Enterprise + 50 addon credits for testing
      let subChanged = false;
      if (enterprisePlan && subscription.planId !== enterprisePlan.id) {
        subscription.planId = enterprisePlan.id;
        subChanged = true;
      }
      if (!subscription.aiAddonCalls || subscription.aiAddonCalls < 50) {
        subscription.aiAddonCalls = 50;
        subChanged = true;
      }
      if (subChanged) {
        subscription.status = 'active'; // Ensure it's active
        await subRepo.save(subscription);
        console.log(`✅  Subscription upgraded: planId=${subscription.planId}, plan=${enterprisePlan?.name}, aiAddonCalls=${subscription.aiAddonCalls}, status=${subscription.status}`);
      } else {
        console.log(`   Subscription already configured: planId=${subscription.planId}, status=${subscription.status}, aiAddonCalls=${subscription.aiAddonCalls}`);
      }
    }

    /* ── Department & Position records ─────────────────────────────────── */
    const deptRepo = dataSource.getRepository(Department);
    const posRepo = dataSource.getRepository(Position);

    const defaultDepts = ['Tecnología', 'Recursos Humanos', 'Ventas', 'Marketing', 'Operaciones', 'Finanzas', 'Legal', 'Administración'];
    const defaultPositionsDef = [
      { name: 'Gerente General', level: 1 }, { name: 'Gerente de Área', level: 2 },
      { name: 'Subgerente', level: 3 }, { name: 'Jefe de Área', level: 4 },
      { name: 'Coordinador', level: 5 }, { name: 'Analista', level: 6 }, { name: 'Asistente', level: 7 },
    ];

    // Create department records (idempotent)
    const deptIdMap = new Map<string, string>(); // name lowercase → id
    for (let i = 0; i < defaultDepts.length; i++) {
      const name = defaultDepts[i];
      let dept = await deptRepo.createQueryBuilder('d')
        .where('d.tenant_id = :tenantId', { tenantId: tenant.id })
        .andWhere('LOWER(d.name) = LOWER(:name)', { name })
        .getOne();
      if (!dept) {
        dept = await deptRepo.save(deptRepo.create({ tenantId: tenant.id, name, sortOrder: i, isActive: true }));
      }
      deptIdMap.set(name.toLowerCase(), dept.id);
    }
    console.log(`✅  ${deptIdMap.size} department records ensured`);

    // Create position records (idempotent)
    const posIdMap = new Map<string, string>(); // name lowercase → id
    for (const p of defaultPositionsDef) {
      let pos = await posRepo.createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId: tenant.id })
        .andWhere('LOWER(p.name) = LOWER(:name)', { name: p.name })
        .getOne();
      if (!pos) {
        pos = await posRepo.save(posRepo.create({ tenantId: tenant.id, name: p.name, level: p.level, isActive: true }));
      }
      posIdMap.set(p.name.toLowerCase(), pos.id);
    }
    // Also create custom positions used by seed users
    for (const extra of [
      { name: 'Super Administrador', level: 0 },
      { name: 'Encargado del Sistema', level: 4 },
      { name: 'Gerente de Tecnología', level: 2 },
      { name: 'Diseñadora UX', level: 6 },
      { name: 'Ingeniero DevOps', level: 6 },
      { name: 'Analista QA', level: 6 },
    ]) {
      if (!posIdMap.has(extra.name.toLowerCase())) {
        let pos = await posRepo.createQueryBuilder('p')
          .where('p.tenant_id = :tenantId', { tenantId: tenant.id })
          .andWhere('LOWER(p.name) = LOWER(:name)', { name: extra.name })
          .getOne();
        if (!pos) {
          pos = await posRepo.save(posRepo.create({ tenantId: tenant.id, name: extra.name, level: extra.level, isActive: true }));
        }
        posIdMap.set(extra.name.toLowerCase(), pos.id);
      }
    }
    console.log(`✅  ${posIdMap.size} position records ensured`);

    /** Helper to resolve departmentId and positionId from text */
    const resolveDeptId = (name?: string) => name ? deptIdMap.get(name.toLowerCase()) || null : null;
    const resolvePosId = (name?: string) => name ? posIdMap.get(name.toLowerCase()) || null : null;

    /* ── Super Admin ─────────────────────────────────────────────────────── */
    let superAdmin: any = await userRepo.findOne({
      where: { email: 'superadmin@evapro.demo', tenantId: tenant.id },
    });
    if (!superAdmin) {
      const pwHash = await bcrypt.hash('EvaPro2026!', 10);
      superAdmin = await userRepo.save(userRepo.create({
        email: 'superadmin@evapro.demo', passwordHash: pwHash,
        firstName: 'Super', lastName: 'Admin',
        role: 'super_admin', department: 'Tecnología', departmentId: resolveDeptId('Tecnología'),
        position: 'Super Administrador', positionId: resolvePosId('Super Administrador'),
        isActive: true, tenantId: tenant.id,
      } as any));
      console.log('\u2705  Super Admin created: superadmin@evapro.demo');
    }

    /* ── Tenant Admin ────────────────────────────────────────────────────── */
    let admin: any = await userRepo.findOne({
      where: { email: 'admin@evapro.demo', tenantId: tenant.id },
    });
    if (!admin) {
      const passwordHash = await bcrypt.hash('EvaPro2026!', 10);
      admin = await userRepo.save(userRepo.create({
        email: 'admin@evapro.demo', passwordHash,
        firstName: 'Admin', lastName: 'EvaPro',
        role: 'tenant_admin', department: 'Recursos Humanos', departmentId: resolveDeptId('Recursos Humanos'),
        position: 'Encargado del Sistema', positionId: resolvePosId('Encargado del Sistema'),
        isActive: true, tenantId: tenant.id,
      } as any));
      console.log('\u2705  Admin created: admin@evapro.demo');
    }

    /* ── Manager ─────────────────────────────────────────────────────────── */
    let manager: any = await userRepo.findOne({
      where: { email: 'carlos.lopez@evapro.demo', tenantId: tenant.id },
    });
    if (!manager) {
      const pwHash = await bcrypt.hash('EvaPro2026!', 10);
      manager = await userRepo.save(userRepo.create({
        email: 'carlos.lopez@evapro.demo', passwordHash: pwHash,
        firstName: 'Carlos', lastName: 'Lopez',
        role: 'manager', department: 'Tecnología', departmentId: resolveDeptId('Tecnología'),
        position: 'Gerente de Tecnología', positionId: resolvePosId('Gerente de Tecnología'),
        hierarchyLevel: 2, isActive: true, tenantId: tenant.id, managerId: admin.id,
      } as any));
      console.log('\u2705  Manager created: carlos.lopez@evapro.demo');
    }

    /* ── Test user for first-login password change ──────────────────────── */
    let testNewUser: any = await userRepo.findOne({ where: { email: 'nuevo.usuario@evapro.demo', tenantId: tenant.id } });
    if (!testNewUser) {
      const pwHash = await bcrypt.hash('Temporal2026!', 10);
      testNewUser = await userRepo.save(userRepo.create({
        email: 'nuevo.usuario@evapro.demo', passwordHash: pwHash,
        firstName: 'Nuevo', lastName: 'Usuario',
        role: 'employee', department: 'Recursos Humanos', departmentId: resolveDeptId('Recursos Humanos'),
        position: 'Analista', positionId: resolvePosId('Analista'),
        hierarchyLevel: 6, isActive: true, tenantId: tenant.id,
        managerId: admin.id, mustChangePassword: true,
      } as any));
      console.log('\u2705  Test user created: nuevo.usuario@evapro.demo (mustChangePassword=true)');
    }

    /* ── Employees (realistic hierarchy) ───────────────────────────────── */
    const employeeDefs = [
      { email: 'ana.martinez@evapro.demo', firstName: 'Ana', lastName: 'Martinez', department: 'Tecnología', position: 'Diseñadora UX', hierarchyLevel: 6 },
      { email: 'luis.rodriguez@evapro.demo', firstName: 'Luis', lastName: 'Rodriguez', department: 'Tecnología', position: 'Ingeniero DevOps', hierarchyLevel: 6 },
      { email: 'sandra.torres@evapro.demo', firstName: 'Sandra', lastName: 'Torres', department: 'Tecnología', position: 'Analista QA', hierarchyLevel: 6 },
    ];

    const empUsers: any[] = [];
    for (const emp of employeeDefs) {
      let user: any = await userRepo.findOne({ where: { email: emp.email, tenantId: tenant.id } });
      if (!user) {
        const pwHash = await bcrypt.hash('EvaPro2026!', 10);
        user = await userRepo.save(
          userRepo.create({ ...emp, passwordHash: pwHash, role: 'employee', isActive: true, tenantId: tenant.id, managerId: manager.id, departmentId: resolveDeptId(emp.department), positionId: resolvePosId(emp.position) } as any),
        );
        console.log(`\u2705  Employee created: ${emp.email}`);
      }
      empUsers.push(user);
    }

    // Ensure ASCII-safe names (fix any old encoding issues)
    const nameFixMap: Record<string, { firstName: string; lastName: string; department: string; position: string; hierarchyLevel?: number }> = {
      'carlos.lopez@evapro.demo': { firstName: 'Carlos', lastName: 'Lopez', department: 'Tecnología', position: 'Gerente de Tecnología', hierarchyLevel: 2 },
      'ana.martinez@evapro.demo': { firstName: 'Ana', lastName: 'Martinez', department: 'Tecnología', position: 'Diseñadora UX', hierarchyLevel: 6 },
      'luis.rodriguez@evapro.demo': { firstName: 'Luis', lastName: 'Rodriguez', department: 'Tecnología', position: 'Ingeniero DevOps', hierarchyLevel: 6 },
      'sandra.torres@evapro.demo': { firstName: 'Sandra', lastName: 'Torres', department: 'Tecnología', position: 'Analista QA', hierarchyLevel: 6 },
      'admin@evapro.demo': { firstName: 'Admin', lastName: 'EvaPro', department: 'Recursos Humanos', position: 'Encargado del Sistema', hierarchyLevel: 4 },
    };
    for (const [email, fix] of Object.entries(nameFixMap)) {
      const user = await userRepo.findOne({ where: { email, tenantId: tenant.id } });
      if (user) {
        let changed = false;
        if (user.firstName !== fix.firstName) { user.firstName = fix.firstName; changed = true; }
        if (user.lastName !== fix.lastName) { user.lastName = fix.lastName; changed = true; }
        if (user.department !== fix.department) { user.department = fix.department; changed = true; }
        if (user.position !== fix.position) { user.position = fix.position; changed = true; }
        if (fix.hierarchyLevel && user.hierarchyLevel !== fix.hierarchyLevel) { user.hierarchyLevel = fix.hierarchyLevel; changed = true; }
        // Backfill department/position IDs
        const dId = resolveDeptId(fix.department);
        const pId = resolvePosId(fix.position);
        if (dId && user.departmentId !== dId) { user.departmentId = dId; changed = true; }
        if (pId && user.positionId !== pId) { user.positionId = pId; changed = true; }
        // Ensure manager hierarchy: employees report to Carlos, Carlos reports to Admin
        if (email === 'carlos.lopez@evapro.demo' && admin && !user.managerId) { user.managerId = admin.id; changed = true; }
        if (changed) { await userRepo.save(user); console.log(`   Fixed data for: ${email}`); }
      }
    }

    /* ── Configure positions catalog in tenant settings ──────────────────── */
    const defaultPositions = [
      { name: 'Gerente General', level: 1 },
      { name: 'Gerente de Área', level: 2 },
      { name: 'Subgerente', level: 3 },
      { name: 'Jefe de Área', level: 4 },
      { name: 'Coordinador', level: 5 },
      { name: 'Analista', level: 6 },
      { name: 'Asistente', level: 7 },
    ];
    if (!tenant.settings?.positions || (tenant.settings.positions as any[]).length === 0) {
      tenant.settings = { ...(tenant.settings || {}), positions: defaultPositions };
      await tenantRepo.save(tenant);
      console.log('\u2705  Positions catalog configured (7 levels)');
    }

    // Also fix hierarchy for ALL users without hierarchyLevel based on their position
    const allTenantUsers = await userRepo.find({ where: { tenantId: tenant.id, isActive: true } });
    const posMap = new Map(defaultPositions.map(p => [p.name.toLowerCase(), p.level]));
    for (const u of allTenantUsers) {
      if (u.position && !u.hierarchyLevel) {
        const level = posMap.get(u.position.toLowerCase());
        if (level) {
          u.hierarchyLevel = level;
          await userRepo.save(u);
          console.log(`   Auto-assigned level ${level} to ${u.firstName} ${u.lastName} (${u.position})`);
        }
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

    /* ── System Templates — DISABLED: organizations now generate their own from competency catalog ── */
    /* Each organization uses "Generar plantillas de muestra" button to create templates
       based on their own competency catalog instead of generic system templates.
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
      } else {
        // Update existing system template if it has fewer questions (was old version)
        const countQ = (secs: any[]) => (secs || []).reduce((s: number, sec: any) => s + (sec.questions?.length || 0), 0);
        const existingQ = countQ(exists.sections);
        const newQ = countQ(tpl.sections);
        if (newQ > existingQ) {
          exists.sections = tpl.sections;
          exists.description = tpl.description;
          await templateRepo.save(exists);
          console.log(`\u2705  System template updated: ${tpl.name} (${existingQ} → ${newQ} questions)`);
        }
      }
    }
    */

    /* ── Competencias por defecto ─────────────────────────────────────────── */
    const existingComps = await compRepo.count({ where: { tenantId: tenant.id } });
    if (existingComps === 0) {
      const defaultCompetencies = [
        { name: 'Liderazgo', category: 'Gestion', description: 'Capacidad de guiar, motivar e inspirar a equipos hacia el logro de objetivos organizacionales' },
        { name: 'Comunicaci\u00f3n efectiva', category: 'Blanda', description: 'Habilidad para transmitir ideas de forma clara, asertiva y adaptada a la audiencia' },
        { name: 'Trabajo en equipo', category: 'Blanda', description: 'Capacidad de colaborar y contribuir activamente al logro colectivo respetando la diversidad' },
        { name: 'Resoluci\u00f3n de problemas', category: 'Tecnica', description: 'Habilidad para analizar situaciones complejas y encontrar soluciones efectivas y sustentables' },
        { name: 'Adaptabilidad', category: 'Blanda', description: 'Flexibilidad para ajustarse a cambios, nuevas situaciones y ambientes de incertidumbre' },
        { name: 'Orientaci\u00f3n a resultados', category: 'Gestion', description: 'Enfoque en cumplir objetivos y metas con calidad, eficiencia y dentro de los plazos' },
        { name: 'Conocimiento t\u00e9cnico del \u00e1rea', category: 'Tecnica', description: 'Dominio de las herramientas, tecnolog\u00edas y procesos espec\u00edficos del \u00e1rea de trabajo' },
        { name: 'Creatividad e innovaci\u00f3n', category: 'Blanda', description: 'Capacidad de generar ideas nuevas y proponer mejoras a procesos y productos' },
      ];
      for (const c of defaultCompetencies) {
        await compRepo.save(compRepo.create({ ...c, tenantId: tenant.id, isActive: true }));
      }
      console.log(`\u2705  Default competencies created (${defaultCompetencies.length})`);
    }

    /* ── Meeting Locations ──────────────────────────────────────────────── */
    const locationRepo = dataSource.getRepository(MeetingLocation);
    const existingLocations = await locationRepo.count({ where: { tenantId: tenant.id } });
    if (existingLocations === 0) {
      const locations = [
        { tenantId: tenant.id, name: 'Sala de Reuniones Principal', type: 'physical', address: 'Piso 3, Oficina 301', capacity: 10 },
        { tenantId: tenant.id, name: 'Oficina Gerencia', type: 'physical', address: 'Piso 4, Oficina 401', capacity: 4 },
        { tenantId: tenant.id, name: 'Google Meet', type: 'virtual', address: 'https://meet.google.com' },
        { tenantId: tenant.id, name: 'Microsoft Teams', type: 'virtual', address: 'https://teams.microsoft.com' },
      ];
      for (const loc of locations) {
        await locationRepo.save(locationRepo.create(loc as any));
      }
      console.log('  \u2714 Meeting locations created');
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
