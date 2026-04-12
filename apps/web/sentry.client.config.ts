/**
 * sentry.client.config.ts — Sentry config para el browser (client-side).
 *
 * Se ejecuta una vez al cargar la pagina. Si NEXT_PUBLIC_SENTRY_DSN esta
 * vacio, Sentry queda completamente desactivado (no-op). Seguro para dev
 * local sin cuenta Sentry.
 *
 * El filtro de ruido (ignoreErrors) evita reportar errores de browser que
 * NO son bugs de EvaPro: extensiones de Chrome, ResizeObserver, AbortError,
 * ChunkLoadError, etc. Sin esto, el dashboard de Sentry se llena de ruido
 * el dia 1 y se vuelve inutil.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
  const isProduction = environment === 'production';

  Sentry.init({
    dsn,
    environment,

    // Performance — sample rate conservador en prod para no afectar
    // el bundle size ni la latencia del usuario.
    tracesSampleRate: isProduction ? 0.1 : 1.0,

    // Replay — captura la sesion del usuario cuando ocurre un error
    // para poder reproducirlo. Solo en prod y solo errores (no todas
    // las sesiones, que seria costoso en storage).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: isProduction ? 1.0 : 0,

    // ─── Filtro de ruido ──────────────────────────────────────────
    // Errores que NO son bugs de EvaPro y que spamean el dashboard.
    // Cada regex esta documentada con el motivo.
    ignoreErrors: [
      // ResizeObserver loop — ocurre en Chrome cuando un observer
      // trigger un layout que cambia el tamaño observado. No es un
      // error real, es un warning del browser.
      /ResizeObserver loop/,
      /ResizeObserver loop completed with undelivered notifications/,

      // Fetch cancelado — ocurre cuando el usuario navega a otra
      // pagina mientras un fetch esta en vuelo. Normal en SPAs.
      /AbortError/,
      /The user aborted a request/,
      /signal is aborted without reason/,

      // Red intermitente — el usuario perdio conexion momentaneamente.
      // No es un bug del codigo.
      /Failed to fetch/,
      /NetworkError/,
      /Load failed/,
      /Network request failed/,

      // Errores de extensiones de Chrome/Firefox — inyectan scripts
      // que rompen y Sentry los captura como si fueran nuestros.
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
      /safari-extension:\/\//,
      /^Script error\.?$/,

      // ChunkLoadError — Next.js no puede cargar un chunk (deploy
      // reciente invalido la cache, o red lenta). La solucion es
      // recargar la pagina, no un bug.
      /ChunkLoadError/,
      /Loading chunk \d+ failed/,
      /Loading CSS chunk \d+ failed/,

      // Hydration mismatch — puede ocurrir con extensiones que
      // modifican el DOM (traduccion, ad blockers, etc).
      /Hydration failed/,
      /Text content does not match/,
      /There was an error while hydrating/,

      // Safari private mode — localStorage no disponible. Normal.
      /QuotaExceededError/,
      /SecurityError.*localStorage/,
    ],

    // No reportar transacciones de health checks (si el frontend
    // hace polling de /health o similar).
    ignoreTransactions: [
      /^GET \/health/,
      /^GET \/api\/health/,
    ],

    // beforeSend — ultima oportunidad de filtrar o sanitizar. Redacta
    // cualquier dato que pueda tener PII en el contexto del evento.
    beforeSend(event) {
      // No enviar request body (puede tener passwords del login form)
      if (event.request?.data) {
        delete event.request.data;
      }
      // Redactar cookies
      if (event.request?.cookies) {
        event.request.cookies = {};
      }
      return event;
    },

    // beforeBreadcrumb — filtrar breadcrumbs ruidosos. Los console.*
    // generan muchos breadcrumbs en dev que no aportan contexto real.
    beforeBreadcrumb(breadcrumb) {
      // Ignorar fetch a la propia API de Sentry (recursion)
      if (breadcrumb.category === 'fetch' && breadcrumb.data?.url?.includes('sentry.io')) {
        return null;
      }
      return breadcrumb;
    },
  });
}
