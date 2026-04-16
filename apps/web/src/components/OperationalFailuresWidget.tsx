'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

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

// Las labels/descriptions se resuelven por i18n dentro del componente.
// Los iconos y el filtro de auditoría son estáticos.
const FAILURE_META: Record<keyof FailureCounts, { i18nKey: string; icon: string; auditFilter: string }> = {
  'cron.failed': { i18nKey: 'cronFailed', icon: '⏱️', auditFilter: 'cron.failed' },
  'notification.failed': { i18nKey: 'notificationFailed', icon: '📨', auditFilter: 'notification.failed' },
  'access.denied': { i18nKey: 'accessDenied', icon: '🚫', auditFilter: 'access.denied' },
  'system.error': { i18nKey: 'systemError', icon: '🔥', auditFilter: 'system.error' },
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
  const { t } = useTranslation();
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
            <span aria-hidden="true">🛠️</span> {t('components.operationalFailures.title')}
          </h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {t('components.operationalFailures.period', { days: daysBack })}
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
            {t('components.operationalFailures.viewAll')} →
          </Link>
        )}
      </div>

      {allClear ? (
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: '#065f46' }}>
          ✅ {t('components.operationalFailures.allClear')}
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
            // Mapa de i18n keys: cronFailed → components.operationalFailures.cronFailed/cronDesc
            const labelMap: Record<string, string> = {
              cronFailed: t('components.operationalFailures.cronFailed'),
              notificationFailed: t('components.operationalFailures.notificationFailed'),
              accessDenied: t('components.operationalFailures.accessDenied'),
              systemError: t('components.operationalFailures.systemError'),
            };
            const descMap: Record<string, string> = {
              cronFailed: t('components.operationalFailures.cronDesc'),
              notificationFailed: t('components.operationalFailures.notificationDesc'),
              accessDenied: t('components.operationalFailures.accessDesc'),
              systemError: t('components.operationalFailures.systemDesc'),
            };
            return (
              <Link
                key={key}
                href={`/dashboard/auditoria?dateFrom=${dateFrom}&action=${encodeURIComponent(meta.auditFilter)}`}
                title={descMap[meta.i18nKey] || key}
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
                  {labelMap[meta.i18nKey] || key}
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
                    {t('components.operationalFailures.investigate')} →
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
