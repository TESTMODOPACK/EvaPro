'use client';

import React from 'react';
import Link from 'next/link';

interface FailureCounts {
  'cron.failed': number;
  'notification.failed': number;
  'access.denied': number;
  'system.error': number;
}

export interface OperationalFailuresWidgetProps {
  /** Counts por tipo de fallo en el periodo. Si null/undefined → loading. */
  counts: FailureCounts | null | undefined;
  /** Días que abarca el periodo (default 7). */
  daysBack: number;
  /** Última vez que ocurrió un fallo, ISO string o null. */
  lastFailureAt?: string | null;
  loading?: boolean;
}

const FAILURE_META: Record<keyof FailureCounts, { label: string; icon: string; description: string; auditFilter: string }> = {
  'cron.failed': {
    label: 'Crons fallidos',
    icon: '⏱️',
    description: 'Jobs programados con error (recordatorios, escalamientos, digest).',
    auditFilter: 'cron.failed',
  },
  'notification.failed': {
    label: 'Notificaciones',
    icon: '📨',
    description: 'Emails o notificaciones que no se pudieron entregar.',
    auditFilter: 'notification.failed',
  },
  'access.denied': {
    label: 'Accesos denegados',
    icon: '🚫',
    description: 'Intentos de acceso bloqueados por permisos insuficientes.',
    auditFilter: 'access.denied',
  },
  'system.error': {
    label: 'Errores de sistema',
    icon: '🔥',
    description: 'Excepciones 5xx no manejadas. Revisa Sentry para el stack completo.',
    auditFilter: 'system.error',
  },
};

/**
 * OperationalFailuresWidget — card del dashboard admin que agrega los
 * audit logs de tipo `cron.failed`, `notification.failed`, `access.denied`,
 * `system.error` de los últimos N días en una sola vista accionable.
 *
 * Cada contador es clickeable y abre la auditoría con el filtro aplicado.
 * Cuando todos los contadores son 0 muestra un estado "todo en orden".
 */
export default function OperationalFailuresWidget({
  counts,
  daysBack,
  lastFailureAt,
  loading,
}: OperationalFailuresWidgetProps) {
  if (loading) {
    return (
      <section className="card animate-fade-up" style={{ padding: '1.25rem 1.4rem', marginBottom: '1.25rem' }}>
        <div style={{ height: 16, width: 200, background: 'var(--border)', borderRadius: 4, marginBottom: '0.75rem', opacity: 0.5 }} />
        <div style={{ height: 60, background: 'var(--border)', borderRadius: 8, opacity: 0.3 }} />
      </section>
    );
  }
  if (!counts) return null;

  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  const allClear = total === 0;
  const dateFrom = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);

  return (
    <section
      className="card animate-fade-up"
      style={{
        padding: '1.25rem 1.4rem',
        marginBottom: '1.25rem',
        borderLeft: `4px solid ${allClear ? '#10b981' : '#b45309'}`,
      }}
      aria-label={`Fallos operativos últimos ${daysBack} días`}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: allClear ? 0 : '0.85rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span aria-hidden="true">🛠️</span> Fallos operativos
          </h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Últimos {daysBack} días · Eventos del registro de auditoría
            {lastFailureAt && ` · Último: ${new Date(lastFailureAt).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        {!allClear && (
          <Link
            href={`/dashboard/auditoria?dateFrom=${dateFrom}&action=failed`}
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--accent)',
              textDecoration: 'none',
              padding: '0.35rem 0.7rem',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-sm, 6px)',
            }}
          >
            Ver todos →
          </Link>
        )}
      </div>

      {allClear ? (
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: '#065f46' }}>
          ✅ Sin fallos operativos registrados en el periodo. Todo funcionando con normalidad.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '0.6rem',
          }}
        >
          {(Object.keys(FAILURE_META) as (keyof FailureCounts)[]).map((key) => {
            const meta = FAILURE_META[key];
            const count = counts[key] ?? 0;
            const hasFailures = count > 0;
            return (
              <Link
                key={key}
                href={`/dashboard/auditoria?dateFrom=${dateFrom}&action=${encodeURIComponent(meta.auditFilter)}`}
                title={meta.description}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '0.7rem 0.85rem',
                  background: hasFailures ? 'rgba(239,68,68,0.06)' : 'var(--bg-surface)',
                  border: `1px solid ${hasFailures ? 'rgba(239,68,68,0.30)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-sm, 8px)',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'transform 0.12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <span aria-hidden="true">{meta.icon}</span>
                  {meta.label}
                </div>
                <div
                  style={{
                    fontSize: '1.5rem',
                    fontWeight: 800,
                    color: hasFailures ? '#b91c1c' : 'var(--text-muted)',
                    marginTop: '0.2rem',
                    lineHeight: 1.1,
                  }}
                >
                  {count}
                </div>
                {hasFailures && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 600, marginTop: '0.25rem' }}>
                    Investigar →
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
