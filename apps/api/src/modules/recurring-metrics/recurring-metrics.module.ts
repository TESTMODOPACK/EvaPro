import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecurringMetric } from './entities/recurring-metric.entity';
import { MetricMeasurement } from './entities/metric-measurement.entity';
import { User } from '../users/entities/user.entity';
import { RecurringMetricsService } from './recurring-metrics.service';
import { RecurringMetricsController } from './recurring-metrics.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    // B2-01: User entity registrada para que assertManagerCanAccessUser
    // pueda resolver la jerarquía del owner de la métrica.
    TypeOrmModule.forFeature([RecurringMetric, MetricMeasurement, User]),
    AuditModule,
  ],
  controllers: [RecurringMetricsController],
  providers: [RecurringMetricsService],
  exports: [RecurringMetricsService],
})
export class RecurringMetricsModule {}
