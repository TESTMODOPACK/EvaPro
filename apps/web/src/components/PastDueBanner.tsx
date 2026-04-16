'use client';

/**
 * Persistent banner shown above the dashboard when the current tenant has:
 *   (a) a suspended/expired subscription, or
 *   (b) at least one overdue invoice.
 *
 * Only visible to `tenant_admin` since (i) other roles can't take payment
 * action and (ii) super_admin is NOT part of a paying tenant. The banner is
 * dismissible per-tab (sessionStorage flag) so the user can work in peace
 * after acknowledging it once, but it reappears on hard-refresh until the
 * balance is zero — we don't let the issue be permanently silenced.
 */

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useMySubscription } from '@/hooks/useSubscription';

const DISMISS_KEY = 'eva360:past-due-banner-dismissed';

function formatAmount(amount: number, currency: string): string {
  const c = (currency || '').toUpperCase();
  if (c === 'CLP') return `$${Math.round(amount).toLocaleString('es-CL')} CLP`;
  if (c === 'UF') return `${Number(amount).toFixed(2)} UF`;
  if (c === 'USD') return `US$${Number(amount).toFixed(2)}`;
  return `${amount} ${currency}`;
}

export default function PastDueBanner() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const { data: sub } = useMySubscription();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    }
  }, []);

  // Only query invoices for tenant_admin — for other roles the hook stays
  // disabled and the banner early-returns.
  const { data: invoices } = useQuery({
    queryKey: ['invoices', 'my', 'overdue'],
    queryFn: async () => {
      const all = await api.invoices.my(token!);
      return (all || []).filter((i: any) =>
        ['overdue', 'OVERDUE'].includes(i.status),
      );
    },
    enabled: !!token && role === 'tenant_admin',
    staleTime: 60 * 1000,
  });

  // Compute totals by currency (we may have mixed UF/CLP invoices).
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    (invoices || []).forEach((inv: any) => {
      const curr = (inv.currency || 'UF').toUpperCase();
      m.set(curr, (m.get(curr) || 0) + Number(inv.total));
    });
    return Array.from(m.entries()).map(([currency, amount]) => ({ currency, amount }));
  }, [invoices]);

  if (role !== 'tenant_admin') return null;
  if (dismissed) return null;

  const suspended =
    sub?.status === 'suspended' || sub?.status === 'SUSPENDED' || sub?.status === 'expired' || sub?.status === 'EXPIRED';
  const hasOverdue = (invoices || []).length > 0;
  if (!suspended && !hasOverdue) return null;

  const title = suspended
    ? 'Tu cuenta está suspendida'
    : `Tienes ${invoices!.length} factura${invoices!.length > 1 ? 's' : ''} vencida${invoices!.length > 1 ? 's' : ''}`;
  const totalsLabel = totals.map((t) => formatAmount(t.amount, t.currency)).join(' + ');

  return (
    <div
      role="alert"
      style={{
        background: suspended ? 'linear-gradient(90deg,#991b1b 0%,#b91c1c 100%)' : 'linear-gradient(90deg,#b45309 0%,#d97706 100%)',
        color: '#ffffff',
        padding: '10px 20px',
        fontSize: '0.88rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '1.1rem' }}>{suspended ? '🚫' : '⚠️'}</span>
        <div>
          <div style={{ fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
            {suspended
              ? 'Regulariza el pago para reactivar el acceso a evaluaciones, reportes y OKRs.'
              : `Total adeudado: ${totalsLabel || '—'}. Paga para mantener tu acceso ininterrumpido.`}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <a
          href="/dashboard/mi-suscripcion"
          style={{
            background: '#ffffff',
            color: suspended ? '#991b1b' : '#b45309',
            fontWeight: 700,
            padding: '6px 14px',
            borderRadius: 6,
            textDecoration: 'none',
            fontSize: '0.82rem',
          }}
        >
          Pagar ahora →
        </a>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, '1');
            setDismissed(true);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '1rem',
            padding: '4px 8px',
            opacity: 0.8,
          }}
          aria-label="Ocultar hasta recargar"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
