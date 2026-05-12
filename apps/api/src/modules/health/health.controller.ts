import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Mejora #6 — Lectura del SHA capturado al build-time.
 *
 * El Dockerfile escribe el SHA en /app/.git-sha (build arg GIT_SHA).
 * Si no existe (dev local sin docker, o build sin la build-arg), fallback
 * a la env var GIT_SHA, y finalmente a 'unknown'.
 *
 * Cacheamos el resultado en memoria — el archivo no cambia durante el
 * lifetime del proceso, así que leerlo una vez es suficiente.
 */
let cachedVersion: { sha: string; builtAt: string | null } | null = null;
function readBuildVersion(): { sha: string; builtAt: string | null } {
  if (cachedVersion) return cachedVersion;
  let sha = process.env.GIT_SHA || 'unknown';
  let builtAt: string | null = null;
  try {
    const file = path.resolve('/app/.git-sha');
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8').trim();
      // Permitir formato "SHA" o "SHA|ISO_DATE"
      const [s, d] = content.split('|');
      if (s) sha = s.trim();
      if (d) builtAt = d.trim();
    }
  } catch {
    // Best-effort. Si falla, mantener defaults.
  }
  cachedVersion = { sha, builtAt };
  return cachedVersion;
}

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

  /**
   * Mejora #6 — Endpoint de version. Devuelve el SHA del build + entorno.
   * Permite a cualquier persona (con o sin SSH al VPS) confirmar que
   * version está corriendo en producción con un simple curl.
   *
   * Marcado @Public por la herencia de la clase, así no requiere auth.
   * Ejemplo de respuesta:
   *   GET /health/version
   *   {
   *     "sha": "f6fbb3f",
   *     "builtAt": "2026-05-07T01:30:00Z",
   *     "env": "production",
   *     "node": "v20.10.0"
   *   }
   */
  @Get('version')
  @HttpCode(HttpStatus.OK)
  version() {
    const v = readBuildVersion();
    return {
      sha: v.sha,
      builtAt: v.builtAt,
      env: process.env.NODE_ENV || 'unknown',
      node: process.version,
    };
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
