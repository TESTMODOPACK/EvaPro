/**
 * sentry.edge.config.ts — Sentry config para Edge Runtime de Next.js
 * (middleware.ts, API routes con runtime: 'edge').
 *
 * EvaPro actualmente no usa Edge Runtime de forma extensiva, pero este
 * archivo es requerido por @sentry/nextjs para cubrir el caso. Si se
 * activa un middleware en el futuro, los errores seran capturados
 * automaticamente.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}
