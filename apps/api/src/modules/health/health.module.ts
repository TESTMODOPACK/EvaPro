import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Modulo liviano — sin providers, solo expone el controller. El DataSource
 *  lo inyecta NestJS desde el TypeORM global. Publico (no guards). */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
