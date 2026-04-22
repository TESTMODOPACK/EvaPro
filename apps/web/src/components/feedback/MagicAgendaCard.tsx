'use client';

import React from 'react';

/**
 * MagicAgendaCard — card genérica reusable para los 4 bloques de la
 * Agenda Mágica (Pendientes del anterior, OKRs, Feedback reciente,
 * Reconocimientos) + carriedOverActionItems.
 *
 * Props:
 *   - icon:        emoji o nodo a mostrar a la izquierda del título
 *   - title:       título de la card
 *   - subtitle:    línea secundaria gris
 *   - count:       badge con número de items (opcional)
 *   - items:       array de items a renderizar
 *   - renderItem:  función (item, idx) => ReactNode
 *   - emptyIcon:   emoji del empty state (opcional)
 *   - emptyTitle:  título si items.length === 0
 *   - emptyHint:   descripción del empty state
 *   - accentColor: color del borde izquierdo (default: var(--accent))
 */
export interface MagicAgendaCardProps<T> {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  count?: number;
  items: T[];
  renderItem: (item: T, idx: number) => React.ReactNode;
  emptyIcon?: React.ReactNode;
  emptyTitle?: string;
  emptyHint?: string;
  accentColor?: string;
}

export default function MagicAgendaCard<T>({
  icon,
  title,
  subtitle,
  count,
  items,
  renderItem,
  emptyIcon = '—',
  emptyTitle = 'Sin datos',
  emptyHint,
  accentColor = 'var(--accent)',
}: MagicAgendaCardProps<T>) {
  const isEmpty = !items || items.length === 0;

  return (
    <div
      className="card animate-fade-up"
      style={{
        padding: '1.15rem 1.25rem',
        borderLeft: `3px solid ${accentColor}`,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          marginBottom: subtitle || !isEmpty ? '0.5rem' : '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          {icon && (
            <span style={{ fontSize: '1.15rem', lineHeight: 1, flexShrink: 0 }} aria-hidden>
              {icon}
            </span>
          )}
          <h3
            style={{
              margin: 0,
              fontSize: '0.88rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </h3>
        </div>
        {typeof count === 'number' && count > 0 && (
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              padding: '0.15rem 0.5rem',
              borderRadius: '999px',
              background: `${accentColor}18`,
              color: accentColor,
              flexShrink: 0,
            }}
          >
            {count}
          </span>
        )}
      </div>

      {subtitle && (
        <p
          style={{
            margin: '0 0 0.6rem',
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
            lineHeight: 1.4,
          }}
        >
          {subtitle}
        </p>
      )}

      {/* Content */}
      {isEmpty ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '0.75rem 0.5rem',
            color: 'var(--text-muted)',
          }}
        >
          {emptyIcon && (
            <div style={{ fontSize: '1.25rem', opacity: 0.6, marginBottom: '0.35rem' }}>
              {emptyIcon}
            </div>
          )}
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {emptyTitle}
          </div>
          {emptyHint && (
            <div style={{ fontSize: '0.72rem', marginTop: '0.2rem', lineHeight: 1.4, maxWidth: '240px' }}>
              {emptyHint}
            </div>
          )}
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.45rem',
            flex: 1,
          }}
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderItem(item, idx)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
