import { useTranslation } from 'react-i18next';

// ─── Subscription Status ────────────────────────────────────────────────────
export const subscriptionStatusLabel: Record<string, string> = {
  active: 'Activa',
  trial: 'En trial',
  suspended: 'Suspendida',
  cancelled: 'Cancelada',
  expired: 'Expirada',
};

export const subscriptionStatusBadge: Record<string, string> = {
  active: 'badge-success',
  trial: 'badge-warning',
  suspended: 'badge-danger',
  cancelled: 'badge-danger',
  expired: 'badge-danger',
};

// ─── Evaluation Cycle Status ────────────────────────────────────────────────
export const cycleStatusLabel: Record<string, string> = {
  draft: 'Borrador',
  active: 'Activo',
  closed: 'Cerrado',
};

export const cycleStatusBadge: Record<string, string> = {
  draft: 'badge-warning',
  active: 'badge-success',
  closed: 'badge-accent',
};

// ─── Evaluation Type ────────────────────────────────────────────────────────
export const cycleTypeLabel: Record<string, string> = {
  '90': 'Evaluaci\u00f3n 90\u00b0',
  '180': 'Evaluaci\u00f3n 180\u00b0',
  '270': 'Evaluaci\u00f3n 270\u00b0',
  '360': 'Evaluaci\u00f3n 360\u00b0',
};

export const cycleTypeBadge: Record<string, string> = {
  '90': 'badge-accent',
  '180': 'badge-warning',
  '270': 'badge-success',
  '360': 'badge-danger',
};

// ─── Assignment / Evaluation Status ─────────────────────────────────────────
export const assignmentStatusLabel: Record<string, string> = {
  pending: 'Pendiente',
  in_progress: 'En progreso',
  completed: 'Completada',
  submitted: 'Enviada',
};

export const assignmentStatusBadge: Record<string, string> = {
  pending: 'badge-warning',
  in_progress: 'badge-accent',
  completed: 'badge-success',
  submitted: 'badge-success',
};

// ─── Relation Type ──────────────────────────────────────────────────────────
export const relationTypeLabel: Record<string, string> = {
  self: 'Autoevaluaci\u00f3n',
  manager: 'Evaluaci\u00f3n del jefe',
  peer: 'Evaluaci\u00f3n de par',
  direct_report: 'Evaluaci\u00f3n de reporte directo',
};

// ─── Calibration Status ─────────────────────────────────────────────────────
export const calibrationStatusLabel: Record<string, string> = {
  draft: 'Borrador',
  in_progress: 'En progreso',
  completed: 'Completada',
};

export const calibrationStatusBadge: Record<string, string> = {
  draft: 'badge-warning',
  in_progress: 'badge-accent',
  completed: 'badge-success',
};

export const calibrationEntryStatusLabel: Record<string, string> = {
  pending: 'Pendiente',
  discussed: 'En discusión',
  agreed: 'Acordado',
  adjusted: 'Ajustado',
  approved: 'Aprobado',
  draft: 'Borrador',
  in_progress: 'En progreso',
  completed: 'Completada',
  not_required: 'No requiere',
  pending_approval: 'Aprobación pendiente',
  rejected: 'Rechazado',
};

export const calibrationEntryStatusBadge: Record<string, string> = {
  pending: 'badge-warning',
  discussed: 'badge-accent',
  agreed: 'badge-success',
  adjusted: 'badge-accent',
  approved: 'badge-success',
  draft: 'badge-warning',
  in_progress: 'badge-accent',
  completed: 'badge-success',
  not_required: 'badge-ghost',
  pending_approval: 'badge-warning',
  rejected: 'badge-danger',
};

// ─── Postulant Process Status ───────────────────────────────────────────────
export const processStatusLabel: Record<string, string> = {
  draft: 'Borrador',
  in_progress: 'En Progreso',
  completed: 'Completado',
  closed: 'Cerrado',
};
export const processStatusBadge: Record<string, string> = {
  draft: 'badge-warning',
  in_progress: 'badge-accent',
  completed: 'badge-success',
  closed: 'badge-ghost',
};

// ─── Postulant Entry Status ─────────────────────────────────────────────────
export const postulantEntryStatusLabel: Record<string, string> = {
  applied: 'Postulado',
  evaluating: 'En Evaluación',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  hired: 'Contratado',
};
export const postulantEntryStatusBadge: Record<string, string> = {
  applied: 'badge-ghost',
  evaluating: 'badge-accent',
  approved: 'badge-success',
  rejected: 'badge-danger',
  hired: 'badge-success',
};

// ─── i18n-aware hook ─────────────────────────────────────────────────────────
// Use this in components; static maps above remain as fallback for non-hook contexts

export function useStatusLabels() {
  const { t } = useTranslation();
  return {
    subscription: (s: string) => t(`status.subscription.${s}`, { defaultValue: subscriptionStatusLabel[s] ?? s }),
    cycle: (s: string) => t(`status.cycle.${s}`, { defaultValue: cycleStatusLabel[s] ?? s }),
    cycleType: (s: string) => t(`status.cycleType.${s}`, { defaultValue: cycleTypeLabel[s] ?? s }),
    assignment: (s: string) => t(`status.assignment.${s}`, { defaultValue: assignmentStatusLabel[s] ?? s }),
    relation: (s: string) => t(`status.relation.${s}`, { defaultValue: relationTypeLabel[s] ?? s }),
    calibration: (s: string) => t(`status.calibration.${s}`, { defaultValue: calibrationStatusLabel[s] ?? s }),
    calibrationEntry: (s: string) => t(`status.calibrationEntry.${s}`, { defaultValue: calibrationEntryStatusLabel[s] ?? s }),
    process: (s: string) => t(`status.process.${s}`, { defaultValue: processStatusLabel[s] ?? s }),
    postulant: (s: string) => t(`status.postulant.${s}`, { defaultValue: postulantEntryStatusLabel[s] ?? s }),
  };
}
