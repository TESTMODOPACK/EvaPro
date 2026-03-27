import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { Objective } from '../objectives/entities/objective.entity';
import { FormTemplate } from '../templates/entities/form-template.entity';
import { User } from '../users/entities/user.entity';
import { RoleCompetency } from '../development/entities/role-competency.entity';
import { Competency } from '../development/entities/competency.entity';
import { QuickFeedback } from '../feedback/entities/quick-feedback.entity';
import { CustomKpi } from './entities/custom-kpi.entity';
import { ReportsService } from './reports.service';
import { KpiService } from './kpi.service';
import { ReportsController } from './reports.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    SubscriptionsModule,
    TypeOrmModule.forFeature([
      EvaluationCycle,
      EvaluationAssignment,
      EvaluationResponse,
      Objective,
      FormTemplate,
      User,
      RoleCompetency,
      Competency,
      QuickFeedback,
      CustomKpi,
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, KpiService],
  exports: [ReportsService, KpiService],
})
export class ReportsModule {}
