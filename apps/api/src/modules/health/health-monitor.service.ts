import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { runWithCronLock } from '../../common/utils/cron-lock';
import { EmailService } from '../notifications/email.service';

/**
 * HealthMonitorService — cron auto-monitoring del propio API.
 *
 * Cada 5 min ejecuta un health check interno (ping a la DB). Lleva un
 * contador de fallos consecutivos en memoria. Al 2° fallo consecutivo,
 * manda un email de alerta a `contacto@ascenda.cl` (o `LEADS_NOTIFY_TO`
 * si está definido, reutilizamos esa variable para no crear otra).
 * Cuando el sistema se recupera, manda otro email "restored".
 *
 * Limitaciones conocidas (asumidas):
 *   - El monitor es in-process: si el process muere completamente, este
 *     cron tampoco corre. Para cubrir ese caso se necesita un monitor
 *     externo (UptimeRobot, PingDom, cron local del VPS). Este monitor
 *     cubre el caso "DB down / pool agotado / query lenta" que no
 *     matan al process pero sí inutilizan el API.
 *   - `runWithCronLock` previene que múltiples réplicas manden el mismo
 *     email (advisory lock PostgreSQL). En setup single-VPS actual es
 *     redundante pero lo mantenemos por consistencia con los otros
 *     crons del sistema.
 */
@Injectable()
export class HealthMonitorService {
  private readonly logger = new Logger(HealthMonitorService.name);

  // In-memory counters — no persistimos para evitar state drift entre
  // deploys. En el peor caso, un restart del api resetea el contador y
  // esperamos una vuelta más (5 min) para alertar.
  private consecutiveFailures = 0;
  private lastAlertSentAt: Date | null = null;
  private wasDown = false;

  // Umbral: cuántos fallos consecutivos gatillan la alerta.
  private readonly FAILURE_THRESHOLD = 2;

  // Cooldown entre alertas del mismo tipo (evita spam si el problema
  // persiste muchas vueltas). 30 min.
  private readonly ALERT_COOLDOWN_MS = 30 * 60 * 1000;

  constructor(
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
  ) {}

  /** Cron cada 5 minutos. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkHealth(): Promise<void> {
    // runWithCronLock garantiza que solo una réplica ejecuta (idempotencia
    // en multi-replica). En single-replica es un no-op funcional.
    await runWithCronLock('healthMonitor', this.dataSource, this.logger, async () => {
      const healthy = await this.pingDatabase();

      if (healthy) {
        // Si veníamos de un estado down y ahora subimos → email "restored".
        if (this.wasDown && this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
          await this.sendRestoredAlert().catch((err) =>
            this.logger.error(`sendRestoredAlert failed: ${err?.message || err}`),
          );
        }
        this.consecutiveFailures = 0;
        this.wasDown = false;
        return;
      }

      // Health check failed
      this.consecutiveFailures++;
      this.logger.warn(`Health check failed (consecutive=${this.consecutiveFailures})`);

      // Alerta al pasar el umbral
      if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
        this.wasDown = true;
        const now = Date.now();
        const cooldownActive =
          this.lastAlertSentAt &&
          now - this.lastAlertSentAt.getTime() < this.ALERT_COOLDOWN_MS;

        if (!cooldownActive) {
          await this.sendDownAlert().catch((err) =>
            this.logger.error(`sendDownAlert failed: ${err?.message || err}`),
          );
          this.lastAlertSentAt = new Date();
        }
      }
    });
  }

  /** Ping a la DB: SELECT 1 con timeout implícito del pool. */
  private async pingDatabase(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch (err: any) {
      this.logger.warn(`DB ping failed: ${err?.message || err}`);
      return false;
    }
  }

  private async sendDownAlert(): Promise<void> {
    const to = process.env.HEALTH_ALERT_TO || process.env.LEADS_NOTIFY_TO || 'contacto@ascenda.cl';
    const when = new Date().toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'long' });
    const subject = '🚨 ALERTA — EVA360 API no responde';
    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
        <div style="max-width:560px;margin:2rem auto;background:#ffffff;border:1px solid #fecaca;border-radius:12px;overflow:hidden;">
          <div style="background:#dc2626;padding:1.25rem 2rem;color:#fff;">
            <div style="font-family:Georgia,serif;font-size:1.2rem;font-weight:700;">🚨 EVA360 · HEALTH ALERT</div>
          </div>
          <div style="padding:1.75rem 2rem;">
            <h2 style="margin:0 0 0.5rem;font-size:1.3rem;color:#dc2626;">API down / DB no responde</h2>
            <p style="font-size:0.95rem;color:#334155;line-height:1.6;">
              El health monitor detectó que la base de datos no respondió al ping en
              <strong>${this.FAILURE_THRESHOLD} intentos consecutivos</strong> (cada 5 min).
              Revisar inmediatamente:
            </p>
            <ul style="font-size:0.9rem;color:#334155;line-height:1.6;padding-left:1.2rem;">
              <li><code>docker compose ps</code> — ¿está db healthy?</li>
              <li><code>docker compose logs --tail=50 db</code></li>
              <li><code>docker compose logs --tail=50 api</code> — buscar "ECONNREFUSED" o "pool exhausted"</li>
              <li><code>df -h /</code> — ¿disco lleno?</li>
              <li>Restart: <code>docker compose restart db api</code></li>
            </ul>
            <div style="background:#fef2f2;padding:0.8rem 1rem;border-left:3px solid #dc2626;border-radius:0 4px 4px 0;font-size:0.85rem;color:#7f1d1d;margin:1rem 0 0;">
              Detectado: <strong>${when}</strong><br/>
              Próxima alerta (si persiste): en 30 minutos
            </div>
          </div>
        </div>
      </body></html>`;
    await this.emailService.send(to, subject, html);
    this.logger.error(`🚨 Health alert sent to ${to}`);
  }

  private async sendRestoredAlert(): Promise<void> {
    const to = process.env.HEALTH_ALERT_TO || process.env.LEADS_NOTIFY_TO || 'contacto@ascenda.cl';
    const when = new Date().toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'long' });
    const subject = '✅ EVA360 API restablecido';
    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="margin:0;padding:0;background:#f0fdf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
        <div style="max-width:560px;margin:2rem auto;background:#ffffff;border:1px solid #bbf7d0;border-radius:12px;overflow:hidden;">
          <div style="background:#16a34a;padding:1.25rem 2rem;color:#fff;">
            <div style="font-family:Georgia,serif;font-size:1.2rem;font-weight:700;">✅ EVA360 · HEALTH RESTORED</div>
          </div>
          <div style="padding:1.75rem 2rem;">
            <h2 style="margin:0 0 0.5rem;font-size:1.2rem;color:#16a34a;">API vuelve a responder</h2>
            <p style="font-size:0.95rem;color:#334155;line-height:1.6;">
              El health monitor detectó que la DB volvió a responder normalmente.
              El incidente está cerrado automáticamente.
            </p>
            <div style="background:#f0fdf4;padding:0.8rem 1rem;border-left:3px solid #16a34a;border-radius:0 4px 4px 0;font-size:0.85rem;color:#14532d;">
              Restablecido: <strong>${when}</strong>
            </div>
          </div>
        </div>
      </body></html>`;
    await this.emailService.send(to, subject, html);
    this.logger.log(`✅ Health restored alert sent to ${to}`);
  }
}
