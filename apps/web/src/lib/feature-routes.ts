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
  '/dashboard/auditoria': 'AUDIT_LOG',
  '/dashboard/dei': 'DEI',
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
  ENGAGEMENT_SURVEYS: 'Growth',
  EVAL_360: 'Pro',
  ADVANCED_REPORTS: 'Pro',
  PDI: 'Pro',
  NINE_BOX: 'Pro',
  CALIBRATION: 'Pro',
  POSTULANTS: 'Pro',
  AUDIT_LOG: 'Pro',
  DEI: 'Pro',
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
  BASIC_REPORTS: 'Reportes basicos',
  ADVANCED_REPORTS: 'Reportes avanzados',
  OKR: 'OKRs / Objetivos',
  FEEDBACK: 'Feedback continuo',
  CHECKINS: 'Check-ins 1:1',
  TEMPLATES_CUSTOM: 'Plantillas personalizadas',
  PDI: 'Planes de desarrollo',
  NINE_BOX: 'Matriz Nine Box / Talento',
  CALIBRATION: 'Calibracion',
  POSTULANTS: 'Evaluacion de Postulantes',
  ENGAGEMENT_SURVEYS: 'Encuestas de Clima',
  AUDIT_LOG: 'Registro de Auditoria',
  DEI: 'Diversidad e Inclusion',
  AI_INSIGHTS: 'Informes IA',
  PUBLIC_API: 'API publica',
};
