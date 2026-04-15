'use client';

import React from 'react';
import Link from 'next/link';

export type AlertSeverity = 'critical' | 'warning' | 'info' | 'success';

export interface CommandAlert {
  id: string;
  severity: AlertSeverity;
  icon?: string;
  title: string;
  description?: string;
  count?: number;
  /** Si se provee, el alert es clickeable. */
  href?: string;
  /** Texto del CTA (opcional). Default: "Ver detalle". */
  ctaLabel?: string;
}

const SEVERITY_STYLES: Record<AlertSeverity, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: '#b91c1c', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.35)', label: 'CRÍTICO' },
  warning:  { color: '#b45309', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.35)', label: 'ATENCIÓN' },
  info:     { color: '#1e40af', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.30)', label: 'INFO' },
  success:  { color: '#065f46', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.30)', label: 'OK' },
};

/**
 * CommandCenter — widget prominente para el dashboard del admin que agrupa
 * alertas operacionales con acciones directas. Diseñado para ser "Mission
 * Control": el admin abre el dashboard y ve inmediatamente qué atender hoy.
 *
 * Orden visual: critical → warning → info → success.
 * Si no hay alertas se muestra un estado de "todo en orden".
 */
export default function CommandCenter({
  alerts,
  title = 'Centro de comando',
  subtitle,
}: {
  alerts: CommandAlert[];
  title?: string;
  subtitle?: string;
}) {
  const sorted = [...alerts].sort((a, b) => {
    const order: AlertSeverity[] = ['critical', 'warning', 'info', 'success'];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
  });

  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const warningCount = alerts.filter((a) => a.severity === 'warning').length;
  const headerColor = criticalCount > 0 ? '#b91c1c' : warningCount > 0 ? '#b45309' : '#065f46';

  return (
    <section
      className="card"
      style={{
        padding: '1.25rem 1.4rem',
        marginBottom: '1.25rem',
        borderLeft: `4px solid ${headerColor}`,
      }}
      aria-label={title}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            🎯 {title}
          </h2>
          {subtitle && (
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{subtitle}</p>
          )}
        </div>
        {alerts.length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {criticalCount > 0 && <Pill color="#b91c1c" bg="rgba(239,68,68,0.12)">{criticalCount} crítico{criticalCount !== 1 ? 's' : ''}</Pill>}
            {warningCount > 0 && <Pill color="#b45309" bg="rgba(245,158,11,0.12)">{warningCount} atención</Pill>}
          </div>
        )}
      </div>

      {alerts.length === 0 ? (
        <div
          style={{
            padding: '1rem',
            background: 'rgba(16,185,129,0.06)',
            borderRadius: 'var(--radius-sm, 8px)',
            border: '1px solid rgba(16,185,129,0.20)',
            color: '#065f46',
            fontSize: '0.85rem',
            textAlign: 'center',
          }}
        >
          ✅ No hay acciones urgentes pendientes. Tu organización está al día.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {sorted.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </div>
      )}
    </section>
  );
}

function AlertRow({ alert }: { alert: CommandAlert }) {
  const sev = SEVERITY_STYLES[alert.severity];

  const content = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.7rem 0.9rem',
        background: sev.bg,
        border: `1px solid ${sev.border}`,
        borderRadius: 'var(--radius-sm, 8px)',
        cursor: alert.href ? 'pointer' : 'default',
        transition: 'transform 0.12s, filter 0.12s',
      }}
      onMouseEnter={alert.href ? (e) => { e.currentTarget.style.filter = 'brightness(0.98)'; } : undefined}
      onMouseLeave={alert.href ? (e) => { e.currentTarget.style.filter = 'brightness(1)'; } : undefined}
    >
      {/* Severity indicator */}
      <span
        aria-hidden="true"
        style={{
          fontSize: '1.1rem',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {alert.icon || (alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : alert.severity === 'success' ? '🟢' : '🔵')}
      </span>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: sev.color }}>
            {typeof alert.count === 'number' && `${alert.count} · `}{alert.title}
          </span>
          <span
            style={{
              fontSize: '0.6rem',
              fontWeight: 700,
              color: sev.color,
              background: 'rgba(255,255,255,0.5)',
              padding: '1px 6px',
              borderRadius: '999px',
              letterSpacing: '0.04em',
            }}
          >
            {sev.label}
          </span>
        </div>
        {alert.description && (
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            {alert.description}
          </p>
        )}
      </div>

      {/* CTA */}
      {alert.href && (
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: sev.color,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {alert.ctaLabel || 'Ver'} →
        </span>
      )}
    </div>
  );

  return alert.href ? (
    <Link href={alert.href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {content}
    </Link>
  ) : (
    content
  );
}

function Pill({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span
      style={{
        fontSize: '0.68rem',
        fontWeight: 700,
        color,
        background: bg,
        padding: '0.15rem 0.55rem',
        borderRadius: '999px',
        letterSpacing: '0.02em',
      }}
    >
      {children}
    </span>
  );
}
