'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Reusable AI quota bar — shows credits used/remaining with progress bar.
 * Place this component on any page that consumes AI credits.
 */
export function AiQuotaBar() {
  const token = useAuthStore((s) => s.token);
  const { data: quota } = useQuery({
    queryKey: ['ai', 'quota'],
    queryFn: () => api.ai.getUsage(token!),
    enabled: !!token,
    staleTime: 30_000,
    retry: false,
  });

  if (!quota || !quota.hasAiAccess) return null;

  const pct = quota.monthlyLimit > 0 ? Math.round((quota.monthlyUsed / quota.monthlyLimit) * 100) : 0;
  const barColor = quota.monthlyRemaining <= 0 ? 'var(--danger)' : quota.nearLimit ? 'var(--warning)' : 'var(--success)';
  const periodLabel = quota.periodStart && quota.periodEnd
    ? `${new Date(quota.periodStart).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })} al ${new Date(quota.periodEnd).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}`
    : '';

  return (
    <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        Informes IA: {quota.monthlyUsed} de {quota.monthlyLimit} usados este período ({quota.monthlyRemaining} restantes)
      </span>
      <div style={{ flex: 1, minWidth: '100px', height: '8px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: barColor, borderRadius: '999px', transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        Período: {periodLabel}
      </span>
      {quota.warning && (
        <span style={{ fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 600 }}>{quota.warning}</span>
      )}
    </div>
  );
}
