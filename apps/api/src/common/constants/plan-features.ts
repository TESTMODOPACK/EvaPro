/**
 * Standard feature keys used across the platform.
 * These MUST match the features array in subscription_plans DB records.
 *
 * Plan → Feature mapping:
 *   Starter : EVAL_90_180, BASIC_REPORTS
 *   Growth  : all Starter + EVAL_270, OKR, FEEDBACK, CHECKINS, TEMPLATES_CUSTOM, RECOGNITION, ENGAGEMENT_SURVEYS
 *   Pro     : all Growth + EVAL_360, ADVANCED_REPORTS, PDI, NINE_BOX, CALIBRATION, POSTULANTS,
 *             ORG_DEVELOPMENT, SIGNATURES, ANALYTICS_REPORTS, AUDIT_LOG, DEI, MAGIC_MEETINGS
 *   Enterprise: all Pro + AI_INSIGHTS, PUBLIC_API
 */
export const PlanFeature = {
  // Evaluaciones
  EVAL_90_180: 'EVAL_90_180',
  EVAL_270: 'EVAL_270',
  EVAL_360: 'EVAL_360',

  // Reportes
  BASIC_REPORTS: 'BASIC_REPORTS',
  ADVANCED_REPORTS: 'ADVANCED_REPORTS', // radar, bell, heatmap, gap analysis
  ANALYTICS_REPORTS: 'ANALYTICS_REPORTS', // PDI compliance, rotation, usage, cycle comparison

  // Módulos
  OKR: 'OKR',
  FEEDBACK: 'FEEDBACK',
  CHECKINS: 'CHECKINS',
  TEMPLATES_CUSTOM: 'TEMPLATES_CUSTOM',
  PDI: 'PDI',
  NINE_BOX: 'NINE_BOX',
  CALIBRATION: 'CALIBRATION',
  POSTULANTS: 'POSTULANTS',
  RECOGNITION: 'RECOGNITION',
  ORG_DEVELOPMENT: 'ORG_DEVELOPMENT',
  SIGNATURES: 'SIGNATURES',

  // Engagement
  ENGAGEMENT_SURVEYS: 'ENGAGEMENT_SURVEYS',

  // Compliance & Analytics
  AUDIT_LOG: 'AUDIT_LOG',
  DEI: 'DEI',

  // v3.1 — Rituals & coaching
  // MAGIC_MEETINGS: agenda pre-generada para 1:1 (F1). Usa datos existentes
  // (OKRs, feedback, reconocimientos) + opcionalmente AI_INSIGHTS para
  // sugerencias de temas. La feature FUNCIONA sin AI_INSIGHTS — si el tenant
  // no lo tiene, los 4 bloques de datos se cargan igual y aiSuggestedTopics
  // queda vacío (degradación graceful).
  MAGIC_MEETINGS: 'MAGIC_MEETINGS',

  // v3.1 F3 — Mood tracking (check-in de ánimo diario). Widget en dashboard
  // + agregados por equipo para manager. Min 3 respuestas para mostrar
  // agregado (privacidad). Plan mínimo: Growth.
  MOOD_TRACKING: 'MOOD_TRACKING',

  // v3.1 F6 — Hábitos del líder (streaks). Agregación sobre data
  // existente (check-ins, feedback, reconocimientos). Sin tabla nueva.
  // Gamifica al manager mostrando rachas de buenas prácticas. Plan
  // mínimo: Growth.
  LEADER_STREAKS: 'LEADER_STREAKS',

  // Enterprise
  AI_INSIGHTS: 'AI_INSIGHTS',
  PUBLIC_API: 'PUBLIC_API',
} as const;

export type PlanFeatureKey = (typeof PlanFeature)[keyof typeof PlanFeature];

/**
 * Canonical feature sets per plan tier (used in seed).
 */
export const PLAN_FEATURES = {
  starter: [
    PlanFeature.EVAL_90_180,
    PlanFeature.BASIC_REPORTS,
  ],
  growth: [
    PlanFeature.EVAL_90_180,
    PlanFeature.EVAL_270,
    PlanFeature.BASIC_REPORTS,
    PlanFeature.OKR,
    PlanFeature.FEEDBACK,
    PlanFeature.CHECKINS,
    PlanFeature.TEMPLATES_CUSTOM,
    PlanFeature.RECOGNITION,
    PlanFeature.ENGAGEMENT_SURVEYS,
    PlanFeature.MOOD_TRACKING,
    PlanFeature.LEADER_STREAKS,
  ],
  pro: [
    PlanFeature.EVAL_90_180,
    PlanFeature.EVAL_270,
    PlanFeature.EVAL_360,
    PlanFeature.BASIC_REPORTS,
    PlanFeature.ADVANCED_REPORTS,
    PlanFeature.ANALYTICS_REPORTS,
    PlanFeature.OKR,
    PlanFeature.FEEDBACK,
    PlanFeature.CHECKINS,
    PlanFeature.TEMPLATES_CUSTOM,
    PlanFeature.PDI,
    PlanFeature.NINE_BOX,
    PlanFeature.CALIBRATION,
    PlanFeature.POSTULANTS,
    PlanFeature.RECOGNITION,
    PlanFeature.ORG_DEVELOPMENT,
    PlanFeature.SIGNATURES,
    PlanFeature.ENGAGEMENT_SURVEYS,
    PlanFeature.AUDIT_LOG,
    PlanFeature.DEI,
    PlanFeature.MAGIC_MEETINGS,
    PlanFeature.MOOD_TRACKING,
    PlanFeature.LEADER_STREAKS,
  ],
  enterprise: [
    PlanFeature.EVAL_90_180,
    PlanFeature.EVAL_270,
    PlanFeature.EVAL_360,
    PlanFeature.BASIC_REPORTS,
    PlanFeature.ADVANCED_REPORTS,
    PlanFeature.ANALYTICS_REPORTS,
    PlanFeature.OKR,
    PlanFeature.FEEDBACK,
    PlanFeature.CHECKINS,
    PlanFeature.TEMPLATES_CUSTOM,
    PlanFeature.PDI,
    PlanFeature.NINE_BOX,
    PlanFeature.CALIBRATION,
    PlanFeature.POSTULANTS,
    PlanFeature.RECOGNITION,
    PlanFeature.ORG_DEVELOPMENT,
    PlanFeature.SIGNATURES,
    PlanFeature.ENGAGEMENT_SURVEYS,
    PlanFeature.AUDIT_LOG,
    PlanFeature.DEI,
    PlanFeature.MAGIC_MEETINGS,
    PlanFeature.MOOD_TRACKING,
    PlanFeature.LEADER_STREAKS,
    PlanFeature.AI_INSIGHTS,
    PlanFeature.PUBLIC_API,
  ],
};
