/**
 * sentry.server.config.ts — Sentry config para el server-side de Next.js
 * (SSR, getServerSideProps, API routes, middleware).
 *
 * Separado del client porque el server no tiene acceso al DOM y usa
 * distinta instrumentacion (Node.js http module en vez de fetch browser).
 *
 * Si NEXT_PUBLIC_SENTRY_DSN esta vacio, Sentry queda desactivado.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // En el server no necesitamos ignoreErrors tan agresivos como en el
    // client — los errores del server son genuinos (no hay extensiones
    // de Chrome ni ResizeObserver). Solo filtramos los operacionales.
    ignoreErrors: [
      /ECONNRESET/,
      /socket hang up/,
      /Client network socket disconnected/,
    ],

    beforeSend(event) {
      // Redactar cookies y headers de auth del contexto server
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, string>;
        if (h['authorization']) h['authorization'] = '[REDACTED]';
        if (h['cookie']) h['cookie'] = '[REDACTED]';
      }
      if (event.request?.data) delete event.request.data;
      return event;
    },
  });
}
