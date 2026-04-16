'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { usePaymentSession } from '@/hooks/usePayments';
import { useAuthStore } from '@/store/auth.store';

/**
 * Landing page after a successful checkout. The provider redirects here
 * with `?sessionId=xxx`. We poll the session until the webhook lands and
 * flips status to `paid` — typically <5s but can stretch for bank-backed
 * methods (MercadoPago "pending" state).
 *
 * If the user is not authenticated (rare — session may have expired during
 * checkout on a slow connection), we still show the state; they can click
 * through to /login to regain access.
 */
function PagoExitosoInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const sessionId = searchParams.get('sessionId');
  const [giveUp, setGiveUp] = useState(false);

  // After 60s of polling, stop and tell the user to refresh their mail
  // inbox. This covers pathological cases where the provider webhook
  // arrives many minutes late.
  useEffect(() => {
    if (!sessionId) return;
    const t = setTimeout(() => setGiveUp(true), 60_000);
    return () => clearTimeout(t);
  }, [sessionId]);

  const { data, isLoading, isError } = usePaymentSession(sessionId);

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
          {!sessionId ? (
            <>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                Enlace inválido
              </h1>
              <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
                No pudimos encontrar el identificador de tu pago.
              </p>
            </>
          ) : isLoading || (data?.status === 'pending' && !giveUp) ? (
            <>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⏳</div>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                Procesando tu pago…
              </h1>
              <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
                Estamos confirmando el pago con el proveedor. Esto puede tardar unos segundos.
              </p>
            </>
          ) : data?.status === 'paid' ? (
            <>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✓</div>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                Pago recibido
              </h1>
              <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 1.5rem' }}>
                Tu factura fue marcada como pagada. Recibirás un comprobante por email.
              </p>
            </>
          ) : data?.status === 'failed' || data?.status === 'cancelled' ? (
            <>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚠️</div>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                El pago no se completó
              </h1>
              <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 1.5rem' }}>
                {data.failureReason || 'El proveedor rechazó la operación. Puedes reintentar con otro método.'}
              </p>
            </>
          ) : giveUp || isError ? (
            <>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⏱</div>
              <h1 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                Confirmación demorada
              </h1>
              <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 1.5rem' }}>
                No pudimos confirmar el estado en tiempo razonable. Revisa tu inbox — cuando
                llegue el comprobante el pago ya estará aplicado.
              </p>
            </>
          ) : null}

          {(data?.status === 'paid' ||
            data?.status === 'failed' ||
            data?.status === 'cancelled' ||
            giveUp) && (
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
              {isAuth ? 'Ir a mi suscripción' : 'Iniciar sesión'} →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PagoExitosoPage() {
  return (
    <Suspense fallback={null}>
      <PagoExitosoInner />
    </Suspense>
  );
}
