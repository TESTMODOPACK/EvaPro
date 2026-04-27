import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiInsight } from './entities/ai-insight.entity';
import { AiCallLog } from './entities/ai-call-log.entity';
import { AiInsightsService } from './ai-insights.service';
import { AiInsightsController } from './ai-insights.controller';
import { ReportsModule } from '../reports/reports.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { User } from '../users/entities/user.entity';
import { Objective } from '../objectives/entities/objective.entity';
import { QuickFeedback } from '../feedback/entities/quick-feedback.entity';
import { Competency } from '../development/entities/competency.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiInsight,
      AiCallLog,
      EvaluationResponse,
      EvaluationAssignment,
      EvaluationCycle,
      User,
      Objective,
      QuickFeedback,
      Competency,
      TalentAssessment,
      Subscription,
    ]),
    ReportsModule,
    SubscriptionsModule,
    NotificationsModule,
  ],
  controllers: [AiInsightsController],
  providers: [AiInsightsService],
  exports: [AiInsightsService],
})
export class AiInsightsModule {}
