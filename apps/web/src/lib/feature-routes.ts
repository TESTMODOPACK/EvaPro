/**
 * Maps dashboard routes to the plan feature required to access them.
 * Routes not listed here are available to all plans.
 */
export const ROUTE_FEATURE_MAP: Record<string, string> = {
  '/dashboard/objetivos': 'OKR',
  '/dashboard/feedback': 'FEEDBACK',
  '/dashboard/desarrollo': 'PDI',
  '/dashboard/talento': 'NINE_BOX',
  '/dashboard/calibracion': 'CALIBRATION',
  '/dashboard/insights': 'AI_INSIGHTS',
  '/dashboard/encuestas-clima': 'ENGAGEMENT_SURVEYS',
  '/dashboard/analytics': 'ADVANCED_REPORTS',
  '/dashboard/analisis-integrado': 'ADVANCED_REPORTS',
  '/dashboard/analytics-pdi': 'ANALYTICS_REPORTS',
  '/dashboard/analytics-ciclos': 'ANALYTICS_REPORTS',
  '/dashboard/analytics-uso': 'ANALYTICS_REPORTS',
  '/dashboard/analytics-rotacion': 'ANALYTICS_REPORTS',
  '/dashboard/reconocimientos': 'RECOGNITION',
  '/dashboard/desarrollo-organizacional': 'ORG_DEVELOPMENT',
  '/dashboard/firmas': 'SIGNATURES',
  '/dashboard/auditoria': 'AUDIT_LOG',
  '/dashboard/dei': 'DEI',
  // v3.1 F1 — Agenda Mágica de 1:1. La ruta base /dashboard/feedback ya está
  // gated por FEEDBACK; este mapping aplica a la subruta /agenda (requiere
  // MAGIC_MEETINGS). PlanGate en el layout del página individual.
  '/dashboard/feedback/agenda': 'MAGIC_MEETINGS',
  // v3.1 F3 — Mood tracking: dashboard agregado de equipo (manager+admin).
  '/dashboard/mood-equipo': 'MOOD_TRACKING',
  // v3.1 F6 — Leader Streaks: ranking de hábitos del líder (solo admin).
  '/dashboard/lider-streaks': 'LEADER_STREAKS',
};

/**
 * Maps each feature to the minimum plan that includes it.
 * Used for user-facing messages like "Disponible en plan Growth".
 */
export const FEATURE_MIN_PLAN: Record<string, string> = {
  EVAL_270: 'Growth',
  OKR: 'Growth',
  FEEDBACK: 'Growth',
  CHECKINS: 'Growth',
  TEMPLATES_CUSTOM: 'Growth',
  RECOGNITION: 'Growth',
  ENGAGEMENT_SURVEYS: 'Growth',
  EVAL_360: 'Pro',
  ADVANCED_REPORTS: 'Pro',
  ANALYTICS_REPORTS: 'Pro',
  PDI: 'Pro',
  NINE_BOX: 'Pro',
  CALIBRATION: 'Pro',
  POSTULANTS: 'Pro',
  ORG_DEVELOPMENT: 'Pro',
  SIGNATURES: 'Pro',
  AUDIT_LOG: 'Pro',
  DEI: 'Pro',
  MAGIC_MEETINGS: 'Pro',
  MOOD_TRACKING: 'Growth',
  LEADER_STREAKS: 'Growth',
  AI_INSIGHTS: 'Enterprise',
  PUBLIC_API: 'Enterprise',
};

/**
 * Human-readable feature labels in Spanish.
 */
export const FEATURE_LABELS: Record<string, string> = {
  EVAL_90_180: 'Evaluaciones 90/180',
  EVAL_270: 'Evaluaciones 270',
  EVAL_360: 'Evaluaciones 360',
  BASIC_REPORTS: 'Reportes básicos',
  ADVANCED_REPORTS: 'Reportes avanzados (radar, heatmap, campana)',
  ANALYTICS_REPORTS: 'Reportes analíticos (PDI, rotación, uso, ciclos)',
  OKR: 'OKRs / Objetivos',
  FEEDBACK: 'Feedback continuo',
  CHECKINS: 'Check-ins 1:1',
  TEMPLATES_CUSTOM: 'Plantillas personalizadas',
  PDI: 'Planes de desarrollo individual',
  NINE_BOX: 'Matriz Nine Box / Talento',
  CALIBRATION: 'Calibración',
  POSTULANTS: 'Evaluación de Postulantes',
  RECOGNITION: 'Reconocimientos',
  ORG_DEVELOPMENT: 'Desarrollo Organizacional',
  SIGNATURES: 'Firmas Digitales',
  ENGAGEMENT_SURVEYS: 'Encuestas de Clima',
  AUDIT_LOG: 'Registro de Auditoría',
  DEI: 'Diversidad e Inclusión',
  MAGIC_MEETINGS: 'Agenda mágica de 1:1',
  MOOD_TRACKING: 'Check-in del ánimo diario',
  LEADER_STREAKS: 'Hábitos del líder (rachas)',
  AI_INSIGHTS: 'Informes IA (Anthropic)',
  PUBLIC_API: 'API pública',
};
