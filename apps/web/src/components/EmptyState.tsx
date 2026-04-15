'use client';

import React from 'react';
import Link from 'next/link';

/**
 * EmptyState — componente reusable para listas/secciones sin datos.
 *
 * Reemplaza los "Sin resultados" genéricos por un empty state con:
 *   - Ícono grande (emoji o SVG via `icon` prop)
 *   - Título claro
 *   - Descripción explicativa
 *   - CTA opcional que guía al usuario al siguiente paso
 *
 * Ejemplo:
 *   <EmptyState
 *     icon="🎯"
 *     title="Aún no tienes objetivos"
 *     description="Define tu primer objetivo para que tu jefatura pueda darte feedback sobre él."
 *     ctaLabel="Crear mi primer objetivo"
 *     ctaHref="/dashboard/objetivos?new=1"
 *   />
 */
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  ctaLabel?: string;
  /** Si se provee href → renderiza <Link>. Si se provee onClick → renderiza <button>. */
  ctaHref?: string;
  ctaOnClick?: () => void;
  /** Variante compacta para usar dentro de cards pequeños. */
  compact?: boolean;
}

export default function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  ctaHref,
  ctaOnClick,
  compact = false,
}: EmptyStateProps) {
  const padding = compact ? '1.25rem 1rem' : '2.5rem 1.5rem';
  const iconSize = compact ? '2rem' : '3rem';
  const titleSize = compact ? '0.92rem' : '1.05rem';

  const cta = ctaLabel && (ctaHref || ctaOnClick) ? (
    ctaHref ? (
      <Link
        href={ctaHref}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginTop: '1rem',
          padding: '0.55rem 1.1rem',
          background: 'var(--accent)',
          color: '#fff',
          borderRadius: 'var(--radius-sm, 8px)',
          textDecoration: 'none',
          fontSize: '0.85rem',
          fontWeight: 600,
          transition: 'transform 0.15s, filter 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}
      >
        {ctaLabel} →
      </Link>
    ) : (
      <button
        onClick={ctaOnClick}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          marginTop: '1rem',
          padding: '0.55rem 1.1rem',
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-sm, 8px)',
          cursor: 'pointer',
          fontSize: '0.85rem',
          fontWeight: 600,
          transition: 'transform 0.15s, filter 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}
      >
        {ctaLabel} →
      </button>
    )
  ) : null;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding,
        color: 'var(--text-secondary)',
      }}
    >
      {icon && (
        <div style={{ fontSize: iconSize, lineHeight: 1, marginBottom: '0.75rem', opacity: 0.8 }}>
          {icon}
        </div>
      )}
      <h3
        style={{
          margin: 0,
          fontSize: titleSize,
          fontWeight: 700,
          color: 'var(--text-primary)',
        }}
      >
        {title}
      </h3>
      {description && (
        <p
          style={{
            margin: '0.4rem 0 0',
            fontSize: '0.83rem',
            color: 'var(--text-muted)',
            maxWidth: '420px',
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}
      {cta}
    </div>
  );
}
