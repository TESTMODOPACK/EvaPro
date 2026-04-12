'use client';

/**
 * global-error.tsx — Error boundary de ULTIMO RECURSO.
 *
 * Se activa solo cuando el error ocurre en el root layout (layout.tsx).
 * Es el unico error boundary que puede atrapar errores del layout
 * principal porque error.tsx vive DENTRO del layout, no fuera.
 *
 * Como el layout principal puede estar roto, este componente NO puede
 * depender de ningún proveedor (QueryProvider, i18n, Zustand) ni de
 * CSS externo. Todo esta inline y autocontenido.
 *
 * En la practica, este componente casi nunca se ve — solo si hay un
 * error catastrofico en los providers del root layout.
 */

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: 'global-error', digest: error.digest || 'none' },
      level: 'fatal',
    });
    console.error('[GlobalErrorBoundary]', error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          textAlign: 'center',
          background: '#faf9f6',
          color: '#1a1206',
          margin: 0,
        }}
      >
        <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>{'🔧'}</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          Eva360 — Error del sistema
        </h1>
        <p
          style={{
            fontSize: '0.95rem',
            color: '#64748b',
            maxWidth: '480px',
            lineHeight: 1.6,
            marginBottom: '2rem',
          }}
        >
          Ocurrió un error crítico al cargar la aplicación.
          Nuestro equipo técnico ya fue notificado automáticamente.
          Por favor recarga la página.
        </p>
        <button
          onClick={reset}
          style={{
            padding: '0.75rem 2rem',
            fontSize: '1rem',
            fontWeight: 700,
            color: '#fff',
            background: '#c9933a',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(201,147,58,0.3)',
          }}
        >
          Recargar aplicación
        </button>
        {error.digest && (
          <p style={{ marginTop: '2rem', fontSize: '0.72rem', color: '#94a3b8' }}>
            Ref: {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
