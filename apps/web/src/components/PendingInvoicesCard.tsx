'use client';

/**
 * Card listing the tenant's unpaid invoices (statuses `sent` or `overdue`)
 * with a "Pagar" button per row. Shown on `/mi-suscripcion` for the
 * tenant_admin. When there are no pending invoices the card is hidden
 * (we return null) so we don't clutter the happy-path UI.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import PayInvoiceModal from './PayInvoiceModal';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number | string;
  currency: string;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

function formatAmount(amount: number, currency: string): string {
  const c = (currency || '').toUpperCase();
  if (c === 'CLP') return `$${Math.round(amount).toLocaleString('es-CL')} CLP`;
  if (c === 'UF') return `${Number(amount).toFixed(2)} UF`;
  if (c === 'USD') return `US$${Number(amount).toFixed(2)}`;
  return `${amount} ${currency}`;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CL');
}

export default function PendingInvoicesCard() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const [selected, setSelected] = useState<InvoiceRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', 'my', 'pending'],
    queryFn: async () => {
      const all = await api.invoices.my(token!);
      // Filter to statuses that still accept payment.
      return (all || []).filter((i: any) =>
        ['sent', 'overdue', 'SENT', 'OVERDUE'].includes(i.status),
      ) as InvoiceRow[];
    },
    enabled: !!token && role === 'tenant_admin',
    staleTime: 30 * 1000,
  });

  // Hide the card for everyone except tenant_admin, and for tenant_admins
  // with no outstanding balance. The super_admin path pays through
  // `/facturacion`; there's no need to duplicate the affordance here.
  if (role !== 'tenant_admin') return null;
  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  return (
    <>
      <div
        className="card"
        style={{
          padding: '1.5rem',
          borderLeft: '3px solid var(--danger)',
          background: 'rgba(239,68,68,0.04)',
        }}
      >
        <h2
          style={{
            fontSize: '0.95rem',
            fontWeight: 700,
            marginBottom: '0.35rem',
            color: 'var(--danger)',
          }}
        >
          Facturas pendientes de pago
        </h2>
        <p
          style={{
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
          }}
        >
          Regulariza tus pagos para mantener tu suscripción activa. Aceptamos
          Stripe y MercadoPago.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.85rem',
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '0.72rem',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                  }}
                >
                  Factura
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '0.72rem',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                  }}
                >
                  Período
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '0.72rem',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                  }}
                >
                  Monto
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '0.72rem',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                  }}
                >
                  Vencimiento
                </th>
                <th
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--border)',
                  }}
                ></th>
              </tr>
            </thead>
            <tbody>
              {data.map((inv) => (
                <tr
                  key={inv.id}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <td style={{ padding: '10px', fontWeight: 600 }}>
                    {inv.invoiceNumber}
                  </td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                    {formatDate(inv.periodStart)} → {formatDate(inv.periodEnd)}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>
                    {formatAmount(Number(inv.total), inv.currency)}
                  </td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                    {formatDate(inv.dueDate)}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => setSelected(inv)}
                      style={{
                        padding: '6px 16px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--accent)',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                      }}
                    >
                      Pagar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <PayInvoiceModal
          invoiceId={selected.id}
          invoiceNumber={selected.invoiceNumber}
          amountLabel={formatAmount(Number(selected.total), selected.currency)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
