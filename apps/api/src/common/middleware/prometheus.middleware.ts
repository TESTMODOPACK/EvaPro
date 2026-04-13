/**
 * prometheus.middleware.ts — Metricas HTTP para Prometheus.
 *
 * Registra dos metricas custom por cada request HTTP:
 *
 * 1. http_requests_total{method, status, route}
 *    Counter — total de requests. Util para calcular RPS y error rate.
 *
 * 2. http_request_duration_seconds{method, route}
 *    Histogram — latencia por endpoint. Util para p50/p95/p99.
 *
 * Las rutas se normalizan para evitar alta cardinalidad:
 * - /users/abc-123 → /users/:id
 * - /evaluation-cycles/xyz/responses → /evaluation-cycles/:id/responses
 * - /health, /metrics → se excluyen (ruido)
 *
 * Uso: registrar como middleware global en main.ts o en AppModule.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Counter, Histogram, register } from 'prom-client';

// Crear metricas una sola vez (singleton via modulo)
const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'status', 'route'] as const,
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/** UUID v4 pattern para normalizar rutas */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Normalizar la ruta para evitar alta cardinalidad en las metricas.
 *  Reemplaza UUIDs por :id y numeros por :n. */
function normalizeRoute(url: string): string {
  // Quitar query params
  const path = url.split('?')[0];
  // Reemplazar UUIDs por :id
  let normalized = path.replace(UUID_PATTERN, ':id');
  // Reemplazar numeros puros en segmentos (ej: /page/3 → /page/:n)
  normalized = normalized.replace(/\/\d+/g, '/:n');
  return normalized || '/';
}

/** Rutas a ignorar — no aportan valor como metricas */
const IGNORE_ROUTES = new Set(['/metrics', '/health', '/health/live', '/health/ready', '/favicon.ico']);

@Injectable()
export class PrometheusMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const route = normalizeRoute(req.originalUrl || req.url);

    // No medir rutas de infra
    if (IGNORE_ROUTES.has(route)) {
      return next();
    }

    const start = process.hrtime.bigint();

    // Registrar cuando la response termine
    res.on('finish', () => {
      const durationNs = Number(process.hrtime.bigint() - start);
      const durationSecs = durationNs / 1e9;
      const method = req.method;
      const status = String(res.statusCode);

      httpRequestsTotal.inc({ method, status, route });
      httpRequestDuration.observe({ method, route }, durationSecs);
    });

    next();
  }
}
