'use client';

import { getScaleLevel, PERFORMANCE_SCALE } from '@/lib/scales';

/**
 * Inline badge showing score + level label with color.
 *
 * Optional `previousScore` triggers a delta badge (↑/↓/=) comparing the
 * current score with the previous period. Useful in KPIs to communicate
 * "mejoraste" vs "bajaste" a primera vista.
 */
export function ScoreBadge({
  score,
  previousScore,
  size = 'md',
  deltaTooltip,
}: {
  score: number | null | undefined;
  previousScore?: number | null;
  size?: 'sm' | 'md' | 'lg';
  /** Texto opcional para el tooltip del delta, ej: "vs ciclo anterior". */
  deltaTooltip?: string;
}) {
  const level = getScaleLevel(score);
  if (!level || score == null) return <span style={{ color: 'var(--text-muted)' }}>--</span>;

  const fontSize = size === 'sm' ? '0.72rem' : size === 'lg' ? '1rem' : '0.85rem';
  const padding = size === 'sm' ? '0.15rem 0.4rem' : size === 'lg' ? '0.35rem 0.75rem' : '0.2rem 0.5rem';

  const delta = previousScore != null && Number.isFinite(previousScore)
    ? Number(score) - Number(previousScore)
    : null;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
        padding,
        background: level.bgLight,
        color: level.color,
        borderRadius: '999px',
        fontSize,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>
        {Number(score).toFixed(1)}
        <span style={{ fontWeight: 600, fontSize: size === 'sm' ? '0.65rem' : '0.75rem', opacity: 0.85 }}>
          {level.label}
        </span>
      </span>
      {delta != null && Math.abs(delta) >= 0.05 && (
        <DeltaBadge delta={delta} size={size} tooltip={deltaTooltip} />
      )}
    </span>
  );
}

/**
 * Standalone delta badge: ↑/↓/= + valor absoluto, color verde/rojo/gris.
 * Se puede reusar fuera de ScoreBadge para cualquier KPI con comparativo.
 */
export function DeltaBadge({
  delta,
  size = 'md',
  tooltip,
  unit = '',
}: {
  delta: number;
  size?: 'sm' | 'md' | 'lg';
  tooltip?: string;
  /** Unidad opcional: '%', 'pts', etc. */
  unit?: string;
}) {
  const fontSize = size === 'sm' ? '0.65rem' : size === 'lg' ? '0.82rem' : '0.7rem';
  const padding = size === 'sm' ? '0.1rem 0.35rem' : '0.15rem 0.45rem';
  const isUp = delta > 0.05;
  const isDown = delta < -0.05;
  const color = isUp ? '#10b981' : isDown ? '#ef4444' : 'var(--text-muted)';
  const bg = isUp ? 'rgba(16,185,129,0.12)' : isDown ? 'rgba(239,68,68,0.12)' : 'rgba(148,163,184,0.12)';
  const icon = isUp ? '↑' : isDown ? '↓' : '=';
  const abs = Math.abs(delta).toFixed(1);

  return (
    <span
      title={tooltip || 'Cambio respecto al periodo anterior'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
        padding,
        background: bg,
        color,
        borderRadius: '999px',
        fontSize,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">{icon}</span>
      {abs}{unit}
    </span>
  );
}

/** Full scale legend - shows all levels with colors and descriptions */
export function ScaleLegend({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.72rem' }}>
        {PERFORMANCE_SCALE.map((level) => (
          <span
            key={level.label}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
              padding: '0.15rem 0.5rem',
              background: level.bgLight,
              color: level.color,
              borderRadius: '999px',
              fontWeight: 600,
            }}
          >
            {level.min}-{level.max < 10 ? level.max.toFixed(1) : '10'} {level.label}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div style={{
      padding: '1rem',
      background: 'var(--bg-surface)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)',
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
        Escala de desempeño
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {PERFORMANCE_SCALE.map((level) => (
          <div
            key={level.label}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.5rem 0.75rem',
              background: level.bgLight,
              borderRadius: 'var(--radius-sm)',
              borderLeft: `3px solid ${level.color}`,
            }}
          >
            <div style={{
              minWidth: '65px',
              fontWeight: 800,
              fontSize: '0.82rem',
              color: level.color,
              fontFamily: 'monospace',
            }}>
              {level.min.toFixed(1)} - {level.max < 10 ? level.max.toFixed(1) : '10.0'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', color: level.color }}>
                {level.label}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                {level.description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
