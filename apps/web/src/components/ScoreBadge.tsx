'use client';

import { getScaleLevel, PERFORMANCE_SCALE } from '@/lib/scales';

/** Inline badge showing score + level label with color */
export function ScoreBadge({ score, size = 'md' }: { score: number | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const level = getScaleLevel(score);
  if (!level || score == null) return <span style={{ color: 'var(--text-muted)' }}>--</span>;

  const fontSize = size === 'sm' ? '0.72rem' : size === 'lg' ? '1rem' : '0.85rem';
  const padding = size === 'sm' ? '0.15rem 0.4rem' : size === 'lg' ? '0.35rem 0.75rem' : '0.2rem 0.5rem';

  return (
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
        Escala de desempeno
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
