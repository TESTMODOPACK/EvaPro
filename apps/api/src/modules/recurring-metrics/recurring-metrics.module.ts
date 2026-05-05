import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecurringMetric } from './entities/recurring-metric.entity';
import { MetricMeasurement } from './entities/metric-measurement.entity';
import { RecurringMetricsService } from './recurring-metrics.service';
import { RecurringMetricsController } from './recurring-metrics.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecurringMetric, MetricMeasurement]),
    AuditModule,
  ],
  controllers: [RecurringMetricsController],
  providers: [RecurringMetricsService],
  exports: [RecurringMetricsService],
})
export class RecurringMetricsModule {}
