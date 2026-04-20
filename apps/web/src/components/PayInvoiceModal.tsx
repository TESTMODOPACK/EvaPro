'use client';

/**
 * Modal to select a payment provider (Stripe / MercadoPago) for an invoice.
 * On confirm:
 *   1. POST /payments/checkout with the selected provider.
 *   2. Redirect the browser to the provider's checkout URL.
 *
 * If only one provider is enabled in the deployment, we still show the modal
 * (to present the amount + brand) but hide the unusable option.
 */

import { useState, useEffect, useRef } from 'react';
import { usePaymentProviders, useCreateCheckout } from '@/hooks/usePayments';
import useFocusTrap from '@/hooks/useFocusTrap';

interface PayInvoiceModalProps {
  invoiceId: string;
  invoiceNumber: string;
  amountLabel: string; // pre-formatted, e.g. "3,50 UF" or "$150.000 CLP"
  onClose: () => void;
}

export default function PayInvoiceModal({
  invoiceId,
  invoiceNumber,
  amountLabel,
  onClose,
}: PayInvoiceModalProps) {
  const { data: providers, isLoading } = usePaymentProviders();
  const checkout = useCreateCheckout();
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  // P8-D: focus trap para navegación por teclado dentro del modal.
  useFocusTrap(dialogRef, true);

  const enabled = (providers ?? []).filter((p) => p.enabled);
  const stripeEnabled = enabled.some((p) => p.name === 'stripe');
  const mpEnabled = enabled.some((p) => p.name === 'mercadopago');

  // P8-A: escape key para cerrar, UX consistente con otros modales.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !checkout.isPending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, checkout.isPending]);

  async function pay(provider: 'stripe' | 'mercadopago') {
    setError('');
    try {
      const res = await checkout.mutateAsync({ invoiceId, provider });
      // Replace the current URL so the back button brings the user back to
      // the dashboard, not to the pre-redirect state of this modal.
      window.location.href = res.checkoutUrl;
    } catch (err: any) {
      setError(err?.message || 'No pudimos iniciar el pago.');
    }
  }

  return (
    <div
      onClick={(e) => {
        // P8-A fix drag-close + guard isPending: no cerrar si el pago
        // está en curso, ni si el click inició dentro del card (drag).
        if (e.target === e.currentTarget && !checkout.isPending) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="card animate-fade-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-invoice-modal-title"
        style={{ padding: '1.75rem', maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h2
          id="pay-invoice-modal-title"
          style={{
            fontSize: '1.1rem',
            fontWeight: 700,
            margin: '0 0 0.25rem',
          }}
        >
          Pagar factura
        </h2>
        <p
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
            margin: '0 0 1.25rem',
          }}
        >
          Selecciona un método de pago para la factura{' '}
          <strong>{invoiceNumber}</strong> — <strong>{amountLabel}</strong>.
        </p>

        {isLoading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Cargando métodos de pago…
          </p>
        ) : enabled.length === 0 ? (
          <div
            style={{
              padding: '12px 14px',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              color: '#991b1b',
            }}
          >
            No hay métodos de pago configurados en este momento. Contacta al
            equipo de soporte de Eva360 para regularizar tu pago manualmente.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {stripeEnabled && (
              <button
                type="button"
                disabled={checkout.isPending}
                onClick={() => pay('stripe')}
                style={{
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: '#ffffff',
                  cursor: checkout.isPending ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                    Pagar con Stripe
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Tarjeta de crédito/débito internacional, Link, Apple Pay, Google Pay.
                  </div>
                </div>
                <span style={{ fontSize: '1.15rem' }}>→</span>
              </button>
            )}
            {mpEnabled && (
              <button
                type="button"
                disabled={checkout.isPending}
                onClick={() => pay('mercadopago')}
                style={{
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: '#ffffff',
                  cursor: checkout.isPending ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                    Pagar con MercadoPago
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Tarjetas chilenas, transferencia, tarjetas de débito Redbanc.
                  </div>
                </div>
                <span style={{ fontSize: '1.15rem' }}>→</span>
              </button>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: '1rem',
              color: 'var(--danger)',
              fontSize: '0.82rem',
              padding: '8px 12px',
              background: 'rgba(239,68,68,0.08)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '1.5rem',
          }}
        >
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={checkout.isPending}
            style={{ fontSize: '0.875rem' }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
