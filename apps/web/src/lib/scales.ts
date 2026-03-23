/**
 * Performance scale configuration for EvaPro.
 * Used across evaluations, dashboards, reports, and talent modules.
 */

export interface ScaleLevel {
  min: number;
  max: number;
  label: string;
  color: string;
  bgLight: string;
  description: string;
}

export const PERFORMANCE_SCALE: ScaleLevel[] = [
  {
    min: 9.0, max: 10.0,
    label: 'Excepcional',
    color: '#8b5cf6',
    bgLight: 'rgba(139, 92, 246, 0.12)',
    description: 'Supera consistentemente las expectativas. Referente para el equipo.',
  },
  {
    min: 7.0, max: 8.99,
    label: 'Destacado',
    color: '#10b981',
    bgLight: 'rgba(16, 185, 129, 0.12)',
    description: 'Cumple y frecuentemente supera lo esperado. Alto desempeno.',
  },
  {
    min: 5.0, max: 6.99,
    label: 'Competente',
    color: '#6366f1',
    bgLight: 'rgba(99, 102, 241, 0.12)',
    description: 'Cumple con las expectativas del cargo. Desempeno esperado.',
  },
  {
    min: 3.0, max: 4.99,
    label: 'En desarrollo',
    color: '#f59e0b',
    bgLight: 'rgba(245, 158, 11, 0.12)',
    description: 'Cumple parcialmente. Necesita apoyo y capacitacion.',
  },
  {
    min: 0.0, max: 2.99,
    label: 'Insuficiente',
    color: '#ef4444',
    bgLight: 'rgba(239, 68, 68, 0.12)',
    description: 'No cumple con las expectativas. Requiere plan de mejora urgente.',
  },
];

/** Get the scale level for a given score (0-10) */
export function getScaleLevel(score: number | null | undefined): ScaleLevel | null {
  if (score == null || isNaN(score)) return null;
  const s = Number(score);
  return PERFORMANCE_SCALE.find((l) => s >= l.min && s <= l.max) || null;
}

/** Get just the label for a score */
export function getScoreLabel(score: number | null | undefined): string {
  return getScaleLevel(score)?.label || '--';
}

/** Get the color for a score */
export function getScoreColor(score: number | null | undefined): string {
  return getScaleLevel(score)?.color || 'var(--text-muted)';
}
