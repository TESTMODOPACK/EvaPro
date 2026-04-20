'use client';

import React from 'react';

/**
 * LoadingState — spinner centrado + mensaje accesible.
 *
 * Uso cuando la página/sección aún no tiene suficiente estructura conocida
 * para mostrar un Skeleton. Para listas o tablas, preferir
 * `LoadingSkeleton` porque da mejor sensación de performance percibida.
 *
 * Accesibilidad:
 *   - `role="status"` + `aria-live="polite"` → screenreader anuncia el mensaje.
 *   - Mensaje textual siempre visible (aunque sea pequeño) para cumplir
 *     WCAG 2.1 (no confiar solo en animación del spinner).
 *
 * Ejemplos:
 *   <LoadingState />                                    // default: "Cargando…"
 *   <LoadingState message="Cargando objetivos…" />
 *   <LoadingState compact />                            // inline en card
 *   <LoadingState fullHeight message="Analizando IA…" /> // 60vh
 */
export interface LoadingStateProps {
  message?: string;
  /** Variante compacta: padding 1rem, para usar dentro de cards pequeños. */
  compact?: boolean;
  /** Usa 60vh de alto mínimo — para "pantalla completa" mientras carga. */
  fullHeight?: boolean;
  /** Tamaño del spinner (px). Default 24. */
  size?: number;
}

export default function LoadingState({
  message = 'Cargando…',
  compact = false,
  fullHeight = false,
  size = 24,
}: LoadingStateProps) {
  const padding = compact ? '1rem' : '2.5rem 1.5rem';
  const minHeight = fullHeight ? '60vh' : undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding,
        minHeight,
        color: 'var(--text-muted)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          border: '2px solid rgba(201,147,58,0.2)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          display: 'inline-block',
        }}
      />
      {message && (
        <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>
          {message}
        </span>
      )}
    </div>
  );
}
