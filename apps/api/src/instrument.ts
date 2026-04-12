/**
 * instrument.ts — Inicializa Sentry antes de cualquier otro import.
 *
 * IMPORTANTE: Este archivo tiene que ser el PRIMER import de main.ts
 * (antes incluso de `@nestjs/core`). Sentry usa OpenTelemetry para
 * auto-instrumentar los modules de Node (http, express, typeorm, pg),
 * y la instrumentacion funciona registrando hooks que interceptan los
 * imports. Si `Sentry.init()` se ejecuta despues de que se importo
 * express, los requests NO quedan instrumentados — la doc oficial lo
 * llama el "hoist-on-top" rule.
 *
 * Ver: https://docs.sentry.io/platforms/javascript/guides/nestjs/#1-install-sentry-sdk
 *
 * Control por env vars:
 *   SENTRY_DSN          — obligatorio. Si no esta definido, Sentry queda
 *                         desactivado silenciosamente (ideal para dev
 *                         local sin cuenta Sentry).
 *   SENTRY_ENVIRONMENT  — "production" / "staging" / "development".
 *                         Default: valor de NODE_ENV.
 *   SENTRY_RELEASE      — SHA del commit o version. Render lo setea via
 *                         RENDER_GIT_COMMIT; lo usamos como fallback.
 *   SENTRY_TRACES_SAMPLE_RATE — fraccion de requests a samplear para
 *                               performance tracing. Default 0.1 (10%)
 *                               en prod, 1.0 (100%) en dev.
 *   SENTRY_PROFILES_SAMPLE_RATE — fraccion de transacciones con CPU
 *                                 profiling. Default 0.1. Solo aplica
 *                                 si el profiler esta habilitado.
 */

import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env.SENTRY_DSN;

// Si no hay DSN, Sentry queda completamente inactivo — el SDK detecta
// el DSN vacio y convierte todas las llamadas a no-op. Util en dev
// local, tests, y durante el primer deploy antes de configurar la
// cuenta Sentry.
if (dsn) {
  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
  const release =
    process.env.SENTRY_RELEASE ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    undefined;

  // En dev muestreamos 100% porque el volumen es bajo y queremos ver
  // todo mientras debuggeamos. En prod bajamos a 10% para no
  // desperdiciar quota ni impactar latencia.
  const isProduction = environment === 'production';
  const tracesSampleRate = parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE || (isProduction ? '0.1' : '1.0'),
  );
  const profilesSampleRate = parseFloat(
    process.env.SENTRY_PROFILES_SAMPLE_RATE || (isProduction ? '0.1' : '1.0'),
  );

  Sentry.init({
    dsn,
    environment,
    release,

    // Performance tracing
    tracesSampleRate,

    // CPU profiling — requiere profilesSampleRate > 0 Y la integration
    profilesSampleRate,
    integrations: [nodeProfilingIntegration()],

    // Captura breadcrumbs de console.* automaticamente. El redact de
    // pino ya saneo las entradas sensibles, asi que Sentry ve la misma
    // version redactada.
    attachStacktrace: true,

    // Ignorar errores operacionales esperados (el usuario mando dto
    // invalido, 404 normal, credenciales erradas). Estos son "bugs del
    // cliente" o "estados normales", no necesitan atencion del dev.
    // Complementa el exception filter que tambien los skipea.
    ignoreErrors: [
      // HTTP exceptions de cliente
      /^BadRequestException/,
      /^UnauthorizedException/,
      /^NotFoundException/,
      /^ForbiddenException/,
      /^ConflictException/,
      // Errores comunes de validacion
      /class-validator/,
      /Validation failed/i,
      // Ruido de conexion del cliente (navegacion cancelada, etc)
      /ECONNRESET/,
      /socket hang up/,
      /Client network socket disconnected/,
    ],

    // Custom beforeSend — ultima oportunidad de filtrar o enriquecer
    // eventos antes de que salgan del proceso. Redactamos headers
    // sensibles aqui ademas del redact de pino, porque Sentry no los
    // recibe via logs sino via su propio capturador de HTTP context.
    beforeSend(event) {
      // Redact Authorization y Cookie headers del contexto HTTP
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, string>;
        if (h['authorization']) h['authorization'] = '[REDACTED]';
        if (h['Authorization']) h['Authorization'] = '[REDACTED]';
        if (h['cookie']) h['cookie'] = '[REDACTED]';
        if (h['Cookie']) h['Cookie'] = '[REDACTED]';
      }
      // Nunca enviar request body — puede contener password/tokens/PII
      // que el redact de pino atrapo pero Sentry captura por separado.
      if (event.request) {
        delete event.request.data;
      }
      return event;
    },
  });
}
