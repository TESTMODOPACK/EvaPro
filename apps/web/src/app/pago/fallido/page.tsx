'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

/**
 * Shown when the provider redirects back without completing payment
 * (user cancelled, failure, session expired). This page does NOT poll —
 * the state is terminal by design. If the webhook later reports success
 * (rare race), the user will still see a "✓ Pago recibido" email because
 * our webhook handler is unaffected by what UI the user lands on.
 */
function PagoFallidoInner() {
  const searchParams = useSearchParams();
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const reason = searchParams.get('reason');

  const titleByReason: Record<string, string> = {
    cancelled: 'Pago cancelado',
    expired: 'La sesión expiró',
    declined: 'Pago rechazado',
  };
  const descByReason: Record<string, string> = {
    cancelled: 'Cancelaste el pago antes de completarlo. Tu factura sigue pendiente.',
    expired: 'La sesión de pago expiró. Puedes iniciar una nueva desde Mi Suscripción.',
    declined: 'Tu tarjeta fue rechazada por el proveedor. Intenta con otro método.',
  };

  const title = titleByReason[reason || ''] || 'Pago no completado';
  const description =
    descByReason[reason || ''] ||
    'No pudimos procesar tu pago. Vuelve a intentarlo desde tu panel de suscripción.';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        padding: '2rem 1rem',
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: '100%',
          background: '#ffffff',
          borderRadius: 16,
          boxShadow: '0 10px 40px rgba(15,23,42,0.08)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(135deg,#0a0b0e 0%,#1a1208 100%)',
            padding: '24px 32px',
            textAlign: 'center',
          }}
        >
          <span style={{ color: '#E8C97A', fontSize: '1.3rem', fontWeight: 700 }}>
            Eva<span style={{ color: '#ffffff', fontWeight: 400 }}>360</span>
          </span>
        </div>
        <div style={{ padding: '36px 40px', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚠️</div>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            {title}
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 1.5rem' }}>
            {description}
          </p>
          <a
            href={isAuth ? '/dashboard/mi-suscripcion' : '/login'}
            style={{
              display: 'inline-block',
              background: '#C9933A',
              color: '#ffffff',
              textDecoration: 'none',
              padding: '12px 28px',
              borderRadius: 10,
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            {isAuth ? 'Volver a Mi Suscripción' : 'Iniciar sesión'} →
          </a>
        </div>
      </div>
    </div>
  );
}

export default function PagoFallidoPage() {
  return (
    <Suspense fallback={null}>
      <PagoFallidoInner />
    </Suspense>
  );
}
