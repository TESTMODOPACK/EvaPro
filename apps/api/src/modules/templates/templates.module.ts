import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FormTemplate } from './entities/form-template.entity';
import { FormSubTemplate } from './entities/form-sub-template.entity';
import { Competency } from '../development/entities/competency.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { AiCallLog } from '../ai-insights/entities/ai-call-log.entity';
import { AiInsight } from '../ai-insights/entities/ai-insight.entity';
import { AiInsightsModule } from '../ai-insights/ai-insights.module';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FormTemplate,
      FormSubTemplate,
      Competency,
      EvaluationCycle,
      AiCallLog,
      AiInsight,
    ]),
    // forwardRef para evitar dependencias circulares (AiInsightsModule
    // importa ReportsModule que tiene FormTemplate como entity).
    forwardRef(() => AiInsightsModule),
  ],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
