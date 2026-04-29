import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { CycleOrgSnapshot } from '../evaluations/entities/cycle-org-snapshot.entity';
import { Objective } from '../objectives/entities/objective.entity';
import { FormTemplate } from '../templates/entities/form-template.entity';
import { FormSubTemplate } from '../templates/entities/form-sub-template.entity';
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
import { CrossAnalysisService } from './cross-analysis.service';
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
import { UserDeparture } from '../users/entities/user-departure.entity';
import { UserMovement } from '../users/entities/user-movement.entity';

@Module({
  imports: [
    forwardRef(() => SubscriptionsModule),
    AuditModule,
    TypeOrmModule.forFeature([
      EvaluationCycle,
      EvaluationAssignment,
      EvaluationResponse,
      CycleOrgSnapshot,
      Objective,
      FormTemplate,
      FormSubTemplate,
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
      UserDeparture,
      UserMovement,
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, KpiService, ExecutiveDashboardService, AnalyticsService, CrossAnalysisService],
  exports: [ReportsService, KpiService],
})
export class ReportsModule {}
