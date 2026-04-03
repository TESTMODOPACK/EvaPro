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
import { Tenant } from '../tenants/entities/tenant.entity';
import { ReportsService } from './reports.service';
import { KpiService } from './kpi.service';
import { ExecutiveDashboardService } from './executive-dashboard.service';
import { AnalyticsService } from './analytics.service';
import { ReportsController } from './reports.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AuditModule } from '../audit/audit.module';
import { EngagementSurvey } from '../surveys/entities/engagement-survey.entity';
import { SurveyResponse } from '../surveys/entities/survey-response.entity';
import { SurveyQuestion } from '../surveys/entities/survey-question.entity';
import { OrgDevelopmentPlan } from '../org-development/entities/org-development-plan.entity';
import { OrgDevelopmentInitiative } from '../org-development/entities/org-development-initiative.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

@Module({
  imports: [
    SubscriptionsModule,
    AuditModule,
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
      Tenant,
      EngagementSurvey,
      SurveyResponse,
      SurveyQuestion,
      OrgDevelopmentPlan,
      OrgDevelopmentInitiative,
      DevelopmentPlan,
      DevelopmentAction,
      AuditLog,
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, KpiService, ExecutiveDashboardService, AnalyticsService],
  exports: [ReportsService, KpiService],
})
export class ReportsModule {}
