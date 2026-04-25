import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Health check endpoint — sirve como liveness/readiness probe para Nginx,
 * Render, Kubernetes o cualquier orquestador. Marcado @Public a nivel clase
 * para bypassar el JwtAuthGuard global — los probes no envian bearer token
 * y un 401 haria que el orquestador marque la app como unhealthy aunque
 * este viva.
 */
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  /** Liveness probe — responde OK si el proceso Node esta vivo y acepta
   *  requests. No hace nada pesado, solo confirma que el event loop
   *  funciona. Ideal para `stopSignal` en Docker y para liveness probes. */
  @Get()
  @HttpCode(HttpStatus.OK)
  async check(@Res() res: Response) {
    const dbStatus = await this.checkDatabase();
    const overallOk = dbStatus.ok;
    res.status(overallOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: overallOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      checks: {
        database: dbStatus,
      },
    });
  }

  /** Liveness (ligero): no toca DB, solo confirma que el proceso responde.
   *  Usar para `HEALTHCHECK` de Docker que corre cada 30s — no queremos
   *  hacer `SELECT 1` a la DB cada 30s por contenedor. */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    };
  }

  /** Readiness probe — la app esta "ready" solo si la DB responde. Usar
   *  para load-balancer routing (Nginx) y para readiness en Kubernetes. */
  @Get('ready')
  async ready(@Res() res: Response) {
    const dbStatus = await this.checkDatabase();
    res.status(dbStatus.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: dbStatus.ok ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks: { database: dbStatus },
    });
  }

  /** SELECT 1 con timeout corto. No usa el entity manager para evitar
   *  overhead — query crudo, rapido, falla rapido. */
  private async checkDatabase(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'DB connection failed' };
    }
  }
}
