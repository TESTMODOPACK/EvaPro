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

  // ─── Graceful shutdown ────────────────────────────────────────────────
  // Hace que NestJS responda a SIGTERM/SIGINT cerrando los modulos en
  // orden (destroyers de repositorios, cron jobs, conexiones DB) antes de
  // matar el proceso. Sin esto, un `docker stop` o un deploy rolling dejan
  // requests a medio procesar y conexiones DB huerfanas.
  app.enableShutdownHooks();

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

  // CORS – reflect the request origin so credentials work with any frontend URL
  const frontendUrl = process.env.FRONTEND_URL;
  const allowedOrigins = frontendUrl
    ? frontendUrl.split(',').map((u) => u.trim())
    : null;

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: string | boolean) => void) => {
      // Allow requests with no origin (curl, mobile apps, server-to-server)
      if (!origin) return callback(null, true);
      // If FRONTEND_URL is set, check against whitelist
      if (allowedOrigins && allowedOrigins.length > 0) {
        if (allowedOrigins.includes(origin)) return callback(null, origin);
        // Still allow for development/other frontends
      }
      // Reflect origin (permissive — safe for MVP)
      callback(null, origin);
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
