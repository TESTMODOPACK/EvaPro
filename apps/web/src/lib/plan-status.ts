// Diccionarios compartidos para estados de planes de desarrollo y sus acciones.
// Centralizan colores y labels legibles en espanol para que analytics-pdi,
// PlanDetailModal y cualquier otra vista consuman la misma fuente de verdad.
// Mantener sincronizado con el backend DevelopmentPlanStatus.

export const PLAN_STATUS_COLORS: Record<string, string> = {
  activo: 'var(--accent)',
  completado: 'var(--success)',
  cancelado: 'var(--danger)',
  borrador: 'var(--text-muted)',
  en_revision: 'var(--warning)',
  pausado: 'var(--text-muted)',
  aprobado: 'var(--success)',
};

export const PLAN_STATUS_LABELS: Record<string, string> = {
  activo: 'Activo',
  completado: 'Completado',
  cancelado: 'Cancelado',
  borrador: 'Borrador',
  en_revision: 'En revisión',
  pausado: 'Pausado',
  aprobado: 'Aprobado',
};

export const PLAN_ACTION_STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  completada: 'Completada',
  completed: 'Completada',
  cancelada: 'Cancelada',
};

export const PLAN_ACTION_STATUS_COLORS: Record<string, string> = {
  pendiente: 'var(--warning)',
  en_progreso: 'var(--accent)',
  completada: 'var(--success)',
  completed: 'var(--success)',
  cancelada: 'var(--danger)',
};

export const PLAN_PRIORITY_LABELS: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
};

export const PLAN_PRIORITY_COLORS: Record<string, string> = {
  baja: 'var(--text-muted)',
  media: 'var(--warning)',
  alta: 'var(--danger)',
};
