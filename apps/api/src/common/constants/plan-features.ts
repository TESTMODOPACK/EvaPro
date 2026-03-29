/**
 * Standard feature keys used across the platform.
 * These MUST match the features array in subscription_plans DB records.
 *
 * Plan → Feature mapping:
 *   Starter : EVAL_90_180, BASIC_REPORTS
 *   Growth  : all Starter + EVAL_270, OKR, FEEDBACK, CHECKINS, TEMPLATES_CUSTOM
 *   Pro     : all Growth + EVAL_360, ADVANCED_REPORTS, PDI, NINE_BOX, CALIBRATION
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

  // Módulos
  OKR: 'OKR',
  FEEDBACK: 'FEEDBACK',
  CHECKINS: 'CHECKINS',
  TEMPLATES_CUSTOM: 'TEMPLATES_CUSTOM',
  PDI: 'PDI',
  NINE_BOX: 'NINE_BOX',
  CALIBRATION: 'CALIBRATION',
  POSTULANTS: 'POSTULANTS',

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
  ],
  pro: [
    PlanFeature.EVAL_90_180,
    PlanFeature.EVAL_270,
    PlanFeature.EVAL_360,
    PlanFeature.BASIC_REPORTS,
    PlanFeature.ADVANCED_REPORTS,
    PlanFeature.OKR,
    PlanFeature.FEEDBACK,
    PlanFeature.CHECKINS,
    PlanFeature.TEMPLATES_CUSTOM,
    PlanFeature.PDI,
    PlanFeature.NINE_BOX,
    PlanFeature.CALIBRATION,
    PlanFeature.POSTULANTS,
  ],
  enterprise: [
    PlanFeature.EVAL_90_180,
    PlanFeature.EVAL_270,
    PlanFeature.EVAL_360,
    PlanFeature.BASIC_REPORTS,
    PlanFeature.ADVANCED_REPORTS,
    PlanFeature.OKR,
    PlanFeature.FEEDBACK,
    PlanFeature.CHECKINS,
    PlanFeature.TEMPLATES_CUSTOM,
    PlanFeature.PDI,
    PlanFeature.NINE_BOX,
    PlanFeature.CALIBRATION,
    PlanFeature.POSTULANTS,
    PlanFeature.AI_INSIGHTS,
    PlanFeature.PUBLIC_API,
  ],
};
