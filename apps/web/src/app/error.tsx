'use client';

/**
 * error.tsx — Error boundary para TODAS las rutas dentro de /app.
 *
 * Next.js App Router lo usa como catch-all cuando un componente hijo
 * tira una excepcion durante el render. Sin este archivo, un error en
 * cualquier pagina produce una pantalla blanca sin explicacion.
 *
 * Este componente:
 * 1. Reporta el error a Sentry (si esta activo) automaticamente via
 *    `@sentry/nextjs` (el SDK intercepta el error boundary de React).
 * 2. Muestra una UI amigable con un boton "Reintentar" que llama a
 *    `reset()` — que re-renderiza el componente hijo sin recargar
 *    toda la pagina.
 * 3. Un boton "Recargar pagina" como fallback si reintentar no arregla.
 *
 * Estilos inline para no depender de ningun CSS que pueda estar roto
 * (si el error esta en un provider global, los estilos externos
 * podrian no cargar).
 */

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reportar a Sentry con contexto adicional. Si Sentry esta
    // desactivado (sin DSN), captureException es no-op.
    Sentry.captureException(error, {
      tags: { boundary: 'app-error', digest: error.digest || 'none' },
    });
    // Loggear en consola para debug local
    console.error('[ErrorBoundary]', error);
  }, [error]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        padding: '2rem',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: '3rem',
          marginBottom: '1rem',
        }}
      >
        {'⚠️'}
      </div>
      <h2
        style={{
          fontSize: '1.25rem',
          fontWeight: 700,
          color: '#1a1206',
          marginBottom: '0.5rem',
        }}
      >
        Algo no salió bien
      </h2>
      <p
        style={{
          fontSize: '0.9rem',
          color: '#64748b',
          maxWidth: '420px',
          lineHeight: 1.6,
          marginBottom: '1.5rem',
        }}
      >
        Ocurrió un error inesperado. Nuestro equipo ya fue notificado automáticamente.
        Puedes reintentar o recargar la página.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          onClick={reset}
          style={{
            padding: '0.65rem 1.5rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            color: '#fff',
            background: '#c9933a',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '0.65rem 1.5rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            color: '#64748b',
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          Recargar página
        </button>
      </div>
      {error.digest && (
        <p
          style={{
            marginTop: '1.5rem',
            fontSize: '0.72rem',
            color: '#94a3b8',
          }}
        >
          Código de referencia: {error.digest}
        </p>
      )}
    </div>
  );
}
