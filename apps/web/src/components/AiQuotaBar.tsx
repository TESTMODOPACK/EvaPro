'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Hook to check AI quota status — use to disable buttons when credits exhausted.
 */
export function useAiQuota() {
  const token = useAuthStore((s) => s.token);
  const { data: quota } = useQuery({
    queryKey: ['ai', 'quota'],
    queryFn: () => api.ai.getUsage(token!),
    enabled: !!token,
    staleTime: 30_000,
    retry: false,
  });

  return {
    quota,
    isBlocked: quota ? quota.monthlyRemaining <= 0 : false,
    hasAccess: quota?.hasAiAccess ?? false,
    remaining: quota?.monthlyRemaining ?? 0,
  };
}

/**
 * Reusable AI quota bar — shows credits used/remaining with progress bar.
 * Shows blocked state when credits are exhausted.
 */
export function AiQuotaBar() {
  const { quota } = useAiQuota();

  if (!quota || !quota.hasAiAccess) return null;

  const pct = quota.monthlyLimit > 0 ? Math.round((quota.monthlyUsed / quota.monthlyLimit) * 100) : 0;
  const isExhausted = quota.monthlyRemaining <= 0;
  const barColor = isExhausted ? 'var(--danger)' : quota.nearLimit ? 'var(--warning)' : 'var(--success)';
  const periodLabel = quota.periodStart && quota.periodEnd
    ? `${new Date(quota.periodStart).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })} al ${new Date(quota.periodEnd).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}`
    : '';

  return (
    <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderLeft: isExhausted ? '4px solid var(--danger)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: isExhausted ? 'var(--danger)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {isExhausted
            ? `Créditos IA agotados (${quota.monthlyUsed}/${quota.monthlyLimit} usados)`
            : `Informes IA: ${quota.monthlyUsed} de ${quota.monthlyLimit} usados (${quota.monthlyRemaining} restantes)`}
        </span>
        <div style={{ flex: 1, minWidth: '100px', height: '8px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: barColor, borderRadius: '999px', transition: 'width 0.5s ease' }} />
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          Período: {periodLabel}
        </span>
      </div>
      {isExhausted && (
        <p style={{ fontSize: '0.78rem', color: 'var(--danger)', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
          Los informes con IA están bloqueados hasta que se renueve el período o adquiera créditos adicionales desde Mi Suscripción.
        </p>
      )}
      {quota.warning && !isExhausted && (
        <p style={{ fontSize: '0.75rem', color: 'var(--warning)', margin: '0.35rem 0 0', fontWeight: 600 }}>{quota.warning}</p>
      )}
    </div>
  );
}
