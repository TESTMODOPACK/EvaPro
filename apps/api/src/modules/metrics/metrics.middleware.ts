/**
 * metrics.middleware.ts — Middleware que registra metricas HTTP por request.
 *
 * Dos metricas:
 * 1. eva360_http_requests_total — Counter con labels method, status, route
 * 2. eva360_http_request_duration_seconds — Histogram con labels method, route
 *
 * Las metricas se exponen via /metrics (PrometheusModule) y se pueden
 * scrapear con Grafana Cloud, Prometheus standalone, o cualquier
 * compatible.
 *
 * Excluye /metrics y /health* del tracking para no contaminar las
 * metricas con los probes del orquestador.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as client from 'prom-client';

const httpRequestsTotal = new client.Counter({
  name: 'eva360_http_requests_total',
  help: 'Total de requests HTTP recibidos',
  labelNames: ['method', 'status', 'route'] as const,
});

const httpRequestDuration = new client.Histogram({
  name: 'eva360_http_request_duration_seconds',
  help: 'Duracion de requests HTTP en segundos',
  labelNames: ['method', 'route'] as const,
  // Buckets tipicos para API web: 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/** Normaliza la ruta para evitar alta cardinalidad de labels.
 *  Reemplaza UUIDs y numeros por :id para que /users/abc-123 y
 *  /users/def-456 se agrupen como /users/:id. */
function normalizeRoute(url: string): string {
  return url
    .split('?')[0] // Quitar query params
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id') // UUIDs
    .replace(/\/\d+/g, '/:num') // Numbers
    .replace(/\/$/, '') // Trailing slash
    || '/';
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const url = req.originalUrl || req.url;

    // No trackear probes ni el propio /metrics (recursion + ruido)
    if (url.startsWith('/metrics') || url.startsWith('/health')) {
      return next();
    }

    const route = normalizeRoute(url);
    const method = req.method;
    const end = httpRequestDuration.startTimer({ method, route });

    res.on('finish', () => {
      end(); // Detiene el timer y registra la duracion
      httpRequestsTotal.inc({ method, status: String(res.statusCode), route });
    });

    next();
  }
}
