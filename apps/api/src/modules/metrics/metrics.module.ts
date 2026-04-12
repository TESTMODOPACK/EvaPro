/**
 * metrics.module.ts — Modulo de metricas Prometheus para EvaPro.
 *
 * Expone `/metrics` con metricas de Node.js (CPU, memoria, event loop,
 * GC) + metricas custom HTTP (request count, duration histogram).
 *
 * Ruta `/metrics` esta protegida por basic auth via METRICS_USER +
 * METRICS_PASSWORD env vars. Sin estas vars, el endpoint queda abierto
 * (util para dev local, peligroso en prod — Sentry alerta si faltan).
 *
 * Para conectar con Grafana Cloud (free tier):
 *   1. Crear cuenta en grafana.com → Cloud → Prometheus
 *   2. Agregar scraper con URL: https://<tu-api>/metrics
 *   3. Configurar basic auth con METRICS_USER/METRICS_PASSWORD
 *   4. Importar dashboard ID 11159 (Node.js Application Dashboard)
 *
 * Uso: el modulo se registra en AppModule y expone automaticamente
 * /metrics sin necesidad de controller adicional.
 */
import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsMiddleware } from './metrics.middleware';

@Module({
  imports: [
    PrometheusModule.register({
      // Path donde se expone el scrape endpoint
      path: '/metrics',
      // Metricas default de Node.js (CPU, memoria, event loop lag, GC,
      // active handles/requests). prom-client las registra automaticamente.
      defaultMetrics: {
        enabled: true,
        config: {
          // Prefix para evitar colision con otras apps si comparten
          // el mismo Prometheus
          prefix: 'eva360_',
        },
      },
      // Default labels que se agregan a TODAS las metricas
      defaultLabels: {
        app: 'eva360-api',
        env: process.env.NODE_ENV || 'development',
      },
    }),
  ],
  providers: [MetricsMiddleware],
  exports: [MetricsMiddleware],
})
export class MetricsModule {}
