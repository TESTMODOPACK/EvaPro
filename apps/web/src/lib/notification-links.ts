// Deep-linking y categorización de notificaciones.
// Mapea (type, metadata) → href para que cada notificación sea clickable.

type Metadata = Record<string, any> | null | undefined;

/**
 * Retorna la ruta del dashboard a la que debe navegar una notificación,
 * o null si no se puede construir un link (e.g. tipo "general").
 */
export function getNotificationHref(type: string, metadata: Metadata): string | null {
  const m = metadata || {};

  switch (type) {
    // ─── Evaluaciones ───────────────────────────────────────────────
    case 'evaluation_pending':
      return '/dashboard/evaluaciones';
    case 'evaluation_completed':
      return '/dashboard/mi-desempeno';
    case 'cycle_closing':
    case 'cycle_closed':
    case 'stage_advanced':
    case 'calibration_pending':
      return '/dashboard/evaluaciones';
    case 'escalation_evaluation_overdue':
      return '/dashboard/evaluaciones';

    // ─── Feedback / Check-ins ───────────────────────────────────────
    case 'feedback_received':
      return '/dashboard/mi-desempeno';
    case 'checkin_scheduled':
    case 'checkin_rejected':
    case 'checkin_overdue':
      return '/dashboard/feedback';

    // ─── Objetivos ──────────────────────────────────────────────────
    case 'objective_at_risk':
    case 'escalation_objective_critical':
      return '/dashboard/objetivos';

    // ─── Desarrollo (PDI) ───────────────────────────────────────────
    case 'pdi_action_due':
    case 'pdi_required':
    case 'escalation_pdi_overdue':
      return '/dashboard/desarrollo';

    // ─── Encuestas ──────────────────────────────────────────────────
    case 'survey_invitation':
    case 'survey_reminder':
      return m.surveyId
        ? `/dashboard/encuestas-clima`
        : '/dashboard/encuestas-clima';
    case 'survey_closed':
      return '/dashboard/encuestas-clima';

    // ─── Sistema / Suscripción ──────────────────────────────────────
    case 'subscription_expiring':
    case 'subscription_expiring_urgent':
      return '/dashboard/mi-suscripcion';

    // ─── General ────────────────────────────────────────────────────
    case 'general':
    default:
      return null;
  }
}

// ─── Categorías ─────────────────────────────────────────────────────

export const NOTIFICATION_CATEGORIES: Record<string, { label: string; icon: string; types: string[] }> = {
  evaluaciones: {
    label: 'Evaluaciones',
    icon: '📝',
    types: [
      'evaluation_pending', 'evaluation_completed',
      'cycle_closing', 'cycle_closed',
      'calibration_pending', 'stage_advanced',
      'escalation_evaluation_overdue',
    ],
  },
  feedback: {
    label: 'Feedback',
    icon: '💬',
    types: [
      'feedback_received',
      'checkin_scheduled', 'checkin_rejected', 'checkin_overdue',
    ],
  },
  objetivos: {
    label: 'Objetivos',
    icon: '🎯',
    types: ['objective_at_risk', 'escalation_objective_critical'],
  },
  desarrollo: {
    label: 'Desarrollo',
    icon: '📈',
    types: ['pdi_action_due', 'pdi_required', 'escalation_pdi_overdue'],
  },
  encuestas: {
    label: 'Encuestas',
    icon: '📋',
    types: ['survey_invitation', 'survey_reminder', 'survey_closed'],
  },
  sistema: {
    label: 'Sistema',
    icon: '⚙️',
    types: ['subscription_expiring', 'subscription_expiring_urgent', 'general'],
  },
};

/** Labels legibles para los tipos de notificación (para preferencias UI). */
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  evaluation_pending: 'Evaluaciones pendientes',
  evaluation_completed: 'Evaluaciones completadas',
  cycle_closing: 'Ciclo por cerrar',
  cycle_closed: 'Ciclo cerrado',
  calibration_pending: 'Calibración pendiente',
  stage_advanced: 'Avance de etapa',
  escalation_evaluation_overdue: 'Escalamiento: evaluación vencida',
  feedback_received: 'Feedback recibido',
  checkin_scheduled: 'Check-in agendado',
  checkin_rejected: 'Check-in rechazado',
  checkin_overdue: 'Check-in vencido',
  objective_at_risk: 'Objetivo en riesgo',
  escalation_objective_critical: 'Escalamiento: objetivo crítico',
  pdi_action_due: 'Acción PDI vencida',
  pdi_required: 'Plan de desarrollo requerido',
  escalation_pdi_overdue: 'Escalamiento: PDI vencido',
  survey_invitation: 'Invitación a encuesta',
  survey_reminder: 'Recordatorio de encuesta',
  survey_closed: 'Encuesta cerrada',
  subscription_expiring: 'Suscripción por vencer',
  subscription_expiring_urgent: 'Suscripción urgente',
  general: 'Notificación general',
};
