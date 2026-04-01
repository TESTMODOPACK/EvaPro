import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EngagementSurvey } from './entities/engagement-survey.entity';
import { SurveyQuestion } from './entities/survey-question.entity';
import { SurveyResponse } from './entities/survey-response.entity';
import { SurveyAssignment } from './entities/survey-assignment.entity';
import { User } from '../users/entities/user.entity';
import { SurveysService } from './surveys.service';
import { SurveysController } from './surveys.controller';
import { AuditModule } from '../audit/audit.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiInsightsModule } from '../ai-insights/ai-insights.module';
import { OrgDevelopmentModule } from '../org-development/org-development.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EngagementSurvey,
      SurveyQuestion,
      SurveyResponse,
      SurveyAssignment,
      User,
    ]),
    AuditModule,
    SubscriptionsModule,
    NotificationsModule,
    AiInsightsModule,
    OrgDevelopmentModule,
  ],
  controllers: [SurveysController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
