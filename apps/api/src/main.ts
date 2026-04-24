// ──────────────────────────────────────────────────────────────────────
// SENTRY — debe ser el PRIMER import del proceso. Ver instrument.ts para
// detalles. El side-effect del import ejecuta Sentry.init() que registra
// los hooks de OpenTelemetry antes de que se cargue express/typeorm/pg.
// eslint-disable-next-line @typescript-eslint/no-require-imports
// ──────────────────────────────────────────────────────────────────────
import './instrument';

import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';
import { AppModule } from './app.module';

async function bootstrap() {
  // `bufferLogs: true` hace que NestJS acumule los logs de arranque hasta
  // que el LoggerModule (pino) este listo, despues los flushea con el
  // formato correcto. Sin esto los primeros logs salen con el formato
  // default de Nest, lo cual rompe el parsing JSON.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Reemplazar el logger default de Nest por el pino global registrado
  // en LoggerModule. A partir de aqui, todo `new Logger(...)` en cualquier
  // servicio usa pino, todos los logs salen en JSON, y request-id +
  // tenantId + userId se propagan automaticamente.
  app.useLogger(app.get(PinoLogger));

  const logger = new Logger('Bootstrap');

  // ─── Validación temprana de JWT_SECRET ─────────────────────────────
  // En prod: debe estar definido, tener ≥32 caracteres y no ser un default
  // conocido. Sin esto, un deploy con secret débil firma tokens trivialmente
  // falsificables (JwtModule lo consume via `?? ''` fallback en auth.module).
  // En dev/test: warn pero continuar — no bloquea el flujo local.
  const jwtSecret = process.env.JWT_SECRET ?? '';
  const knownWeakSecrets = new Set([
    'CAMBIAR_POR_SECRETO_JWT_SEGURO',
    'super-secret-jwt-key-for-dev-only',
    'changeme',
    'secret',
    'jwt-secret',
    'your-secret-here',
  ]);
  const jwtSecretWeak =
    jwtSecret.length < 32 || knownWeakSecrets.has(jwtSecret);
  if (process.env.NODE_ENV === 'production' && jwtSecretWeak) {
    throw new Error(
      'JWT_SECRET is weak or missing in production. Required: at least 32 characters and not a known default. Generate one with: openssl rand -base64 32',
    );
  }
  if (process.env.NODE_ENV !== 'production' && jwtSecretWeak) {
    logger.warn(
      'JWT_SECRET is weak (< 32 chars or known default). OK for dev; must be rotated in production.',
    );
  }

  // ─── Trust proxy (X-Forwarded-For validation) ────────────────────────
  // El API corre detrás de nginx dentro de la misma red de Docker. nginx
  // setea X-Forwarded-For con la IP real del cliente. Sin esto, Express
  // usa req.connection.remoteAddress (que es la IP del contenedor nginx,
  // no la del cliente real) → el rate limit cuenta TODO como "una sola
  // IP" y un atacante puede brute-forcear sin fricción.
  //
  // `'loopback, linklocal, uniquelocal'` cubre las redes privadas Docker
  // (172.x.x.x y similar) + localhost. Rechaza X-Forwarded-For vencido
  // desde IPs públicas (atacante externo mandando el header) porque solo
  // confía en proxies en redes internas. Así el req.ip resuelto refleja
  // la IP real del cliente, no el header falseable.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  // ─── Graceful shutdown ────────────────────────────────────────────────
  // Hace que NestJS responda a SIGTERM/SIGINT cerrando los modulos en
  // orden (destroyers de repositorios, cron jobs, conexiones DB) antes de
  // matar el proceso. Sin esto, un `docker stop` o un deploy rolling dejan
  // requests a medio procesar y conexiones DB huerfanas.
  app.enableShutdownHooks();

  // ─── /metrics basic auth ──────────────────────────────────────────────
  // Protege el endpoint de Prometheus con basic auth para que no sea
  // publico en prod (metadata sensible: rutas, latencia, error rate).
  // Si METRICS_USER o METRICS_PASSWORD no estan definidos, el endpoint
  // queda abierto (util para dev local — peligroso en prod).
  const metricsUser = process.env.METRICS_USER;
  const metricsPass = process.env.METRICS_PASSWORD;
  if (metricsUser && metricsPass) {
    app.use('/metrics', (req: any, res: any, next: any) => {
      const authHeader = req.headers['authorization'] || '';
      if (!authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="metrics"');
        return res.status(401).send('Authentication required');
      }
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const [user, pass] = decoded.split(':');
      if (user === metricsUser && pass === metricsPass) return next();
      res.setHeader('WWW-Authenticate', 'Basic realm="metrics"');
      return res.status(401).send('Invalid credentials');
    });
    logger.log('Metrics endpoint /metrics protected with basic auth');
  } else {
    logger.warn('METRICS_USER/METRICS_PASSWORD not set — /metrics endpoint is UNPROTECTED');
  }

  // ─── Cookies (required by SSO callback for signed state cookie) ─────
  // Must come before any body parsers so cookie-parser populates req.cookies
  // on every route, including webhook paths that use raw body.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cookieParser = require('cookie-parser');
  app.use(cookieParser());

  // ─── Webhook raw body ─────────────────────────────────────────────────
  // Stripe and MercadoPago verify webhook signatures against the EXACT bytes
  // they sent. If Nest's JSON parser touches the body first, Stripe's
  // `constructEvent` will throw "signature verification failed" for every
  // legitimate event. We register express.raw() BEFORE the global JSON
  // parser for the two webhook endpoints only.
  //
  // Important: paths must match the controller routes exactly — any global
  // prefix (none here) would need to be prepended.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  app.use('/webhooks/stripe', express.raw({ type: '*/*', limit: '1mb' }));
  app.use('/webhooks/mercadopago', express.raw({ type: '*/*', limit: '1mb' }));

  // Increase body size limit for base64 file uploads (CVs, attachments stored in DB)
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true } as any);

  // ─── Security headers (replaces helmet for zero-dependency approach) ────
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.removeHeader('X-Powered-By');
    next();
  });

  // ─── CORS con validación obligatoria en producción ──────────────────
  //
  // Antes usaba reflect mode (callback(null, origin)) como fallback si
  // FRONTEND_URL no estaba seteado. Eso dejaba prod abierto a cualquier
  // origen si alguien olvidaba la env var → CSRF posible.
  //
  // Ahora:
  //   - En prod (NODE_ENV=production): FRONTEND_URL es OBLIGATORIO.
  //     Sin él, el container falla al bootstrap. No hay modo reflect.
  //   - En dev/test: mantener reflect como conveniencia local.
  const frontendUrl = process.env.FRONTEND_URL;
  const allowedOrigins = frontendUrl
    ? frontendUrl.split(',').map((u) => u.trim()).filter((u) => u.length > 0)
    : null;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && (!allowedOrigins || allowedOrigins.length === 0)) {
    // Falla loud: mejor que el container crashee y el deploy falle al
    // rollout que silenciosamente quedar con CORS abierto a cualquier
    // origen.
    throw new Error(
      'FRONTEND_URL is required in production. Set it to the exact frontend origin(s) (comma-separated if multiple). Reflect-all-origins mode is disabled in production.',
    );
  }

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: string | boolean) => void) => {
      // Requests sin origin (curl, mobile apps, server-to-server) siempre
      // permitidos — el CORS header solo aplica a navegadores.
      if (!origin) return callback(null, true);
      // Si hay whitelist, validar estrictamente contra ella (prod o dev con
      // FRONTEND_URL seteado).
      if (allowedOrigins && allowedOrigins.length > 0) {
        return callback(null, allowedOrigins.includes(origin));
      }
      // Solo llega acá en dev/test sin FRONTEND_URL: permitir reflect.
      return callback(null, origin);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Global validation pipe – activates class-validator decorators on all DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: false, // don't reject unknown – avoids breaking legacy clients
      transform: true, // auto-transform payloads to DTO class instances
    }),
  );

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  logger.log(`API running on port ${port}`);
  logger.log(`CORS allowed origins: ${allowedOrigins ? allowedOrigins.join(', ') : 'all (reflect)'}`);
  logger.log(`Health check: GET /health | /health/live | /health/ready`);
}

// Catch promesas sin .catch() y excepciones uncaught — sin esto Node
// silenciosamente sigue corriendo en estado inconsistente. Loggeamos Y
// reportamos a Sentry (si esta configurado) para diagnostico remoto.
process.on('unhandledRejection', (reason) => {
  const logger = new Logger('UnhandledRejection');
  logger.error(`Unhandled promise rejection: ${reason}`, (reason as any)?.stack);
  // Sentry captura tambien estos eventos automaticamente via
  // OnUncaughtExceptionStrategy, pero los mandamos explicitamente con
  // mas contexto. Si Sentry esta desactivado, este call es no-op.
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    tags: { source: 'unhandledRejection' },
  });
  // Deliberadamente NO llamamos process.exit(1). EvaPro tiene muchos
  // fire-and-forget (emails, notificaciones) con .catch() vacio que pueden
  // ocasionalmente tirar rejections — matar el API por eso seria demasiado
  // agresivo. Loggear + reportar es suficiente para diagnostico.
});
process.on('uncaughtException', (err) => {
  const logger = new Logger('UncaughtException');
  logger.error(`Uncaught exception: ${err.message}`, err.stack);
  Sentry.captureException(err, { tags: { source: 'uncaughtException' } });
  // Dar tiempo al logger Y a Sentry de flushear antes de salir.
  // Sentry.close() espera a que los eventos pendientes se envien.
  Sentry.close(2000).finally(() => {
    setTimeout(() => process.exit(1), 500);
  });
});

void bootstrap();
