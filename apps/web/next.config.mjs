import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

// withSentryConfig wrappea la config de Next.js para:
// 1. Inyectar los configs de sentry.client/server/edge.config.ts
// 2. Subir source maps al build (si SENTRY_AUTH_TOKEN esta definido)
// 3. Instrumentar las rutas para performance tracing
//
// Si NEXT_PUBLIC_SENTRY_DSN no esta definido, los configs de Sentry
// hacen un early-return y quedan como no-op — el bundle final NO
// incluye codigo activo de Sentry. Seguro para dev sin cuenta.
export default withSentryConfig(nextConfig, {
  // Org y proyecto de Sentry — requeridos solo para source maps upload.
  // Si faltan, el build funciona pero sin upload (stack traces minificados).
  org: process.env.SENTRY_ORG || undefined,
  project: process.env.SENTRY_PROJECT || undefined,

  // Solo subir source maps si tenemos token. Sin token el build NO falla,
  // simplemente skipea el upload silenciosamente.
  authToken: process.env.SENTRY_AUTH_TOKEN || undefined,

  // No imprimir logs de Sentry en el build output (ruidoso).
  silent: true,

  // Ocultar source maps del bundle publico — evita que un atacante
  // vea el codigo fuente original via DevTools. Los maps se suben
  // SOLO a Sentry (server-side) para decodificar stack traces.
  hideSourceMaps: true,

  // Desactivar el "tunnel" de Sentry — la alternativa es rutear los
  // eventos via un endpoint propio (/api/sentry) para evitar ad blockers.
  // Por ahora no lo necesitamos; si los ad blockers filtran mucho,
  // se habilita en el futuro.
  tunnelRoute: undefined,

  // Ampliar el tree-shaking: si Sentry esta desactivado (sin DSN),
  // Next.js puede eliminar mas codigo muerto del bundle.
  disableLogger: true,

  // Automaticamente instrumentar server components y API routes.
  automaticVercelMonitors: false,
});
