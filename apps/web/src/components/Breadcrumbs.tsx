'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';

/**
 * Breadcrumbs — navegación contextual "jerárquica".
 *
 * Uso:
 *   <Breadcrumbs
 *     items={[
 *       { label: 'Evaluaciones', href: '/dashboard/evaluaciones' },
 *       { label: 'Ciclo Q1 2026' }, // último ítem, sin href (current page)
 *     ]}
 *   />
 *
 * El último ítem NO debe tener href (página actual, `aria-current="page"`).
 * Los previos sí tienen href. Renderizamos como `<nav aria-label="Breadcrumb">`
 * para cumplir WCAG 2.4.8 (Location).
 */
export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        marginBottom: '0.75rem',
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
      }}
    >
      <ol
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          flexWrap: 'wrap',
          listStyle: 'none',
          padding: 0,
          margin: 0,
        }}
      >
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              {i > 0 && (
                <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>/</span>
              )}
              {isLast || !item.href ? (
                <span aria-current={isLast ? 'page' : undefined} style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  style={{
                    color: 'var(--text-muted)',
                    textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * BackButton — botón "← Volver" genérico. Usa `router.back()` si hay
 * history, si no, navega al `fallback` (por defecto `/dashboard`).
 *
 * Uso:
 *   <BackButton /> // vuelve al /dashboard si no hay history
 *   <BackButton fallback="/dashboard/usuarios" label="Volver a usuarios" />
 */
export function BackButton({
  fallback = '/dashboard',
  label = '← Volver',
}: {
  fallback?: string;
  label?: string;
}) {
  const router = useRouter();

  const handleClick = () => {
    // Si hay history (>1 entry), volver. Si no, fallback fijo.
    // `window.history.length > 1` es aproximado pero adecuado para nuestros
    // casos (usuario llegó por link externo → length=1 típicamente).
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="btn-text"
      style={{ marginBottom: '0.5rem' }}
      aria-label={label}
    >
      {label}
    </button>
  );
}
