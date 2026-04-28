import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FormTemplate } from './entities/form-template.entity';
import { FormSubTemplate } from './entities/form-sub-template.entity';
import { Competency } from '../development/entities/competency.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FormTemplate,
      FormSubTemplate,
      Competency,
      EvaluationCycle,
    ]),
  ],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
