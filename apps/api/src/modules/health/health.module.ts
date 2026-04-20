import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthMonitorService } from './health-monitor.service';
import { NotificationsModule } from '../notifications/notifications.module';

/** Módulo de salud:
 *   - HealthController: endpoints públicos /health, /health/live, /health/ready
 *   - HealthMonitorService: cron cada 5 min que alerta por email si la DB
 *     deja de responder (2 fallos consecutivos → email a contacto@ascenda.cl
 *     o HEALTH_ALERT_TO). Cobertura baseline hasta tener UptimeRobot/PagerDuty.
 *
 * NotificationsModule se importa para acceder al EmailService. El DataSource
 * lo inyecta NestJS desde el TypeORM global.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [HealthController],
  providers: [HealthMonitorService],
})
export class HealthModule {}
