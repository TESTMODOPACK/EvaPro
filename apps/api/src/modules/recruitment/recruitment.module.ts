import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecruitmentProcess } from './entities/recruitment-process.entity';
import { RecruitmentCandidate } from './entities/recruitment-candidate.entity';
import { RecruitmentEvaluator } from './entities/recruitment-evaluator.entity';
import { RecruitmentInterview } from './entities/recruitment-interview.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { Competency } from '../development/entities/competency.entity';
import { RecruitmentService } from './recruitment.service';
import { RecruitmentController } from './recruitment.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AuditModule } from '../audit/audit.module';
import { AiInsightsModule } from '../ai-insights/ai-insights.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecruitmentProcess,
      RecruitmentCandidate,
      RecruitmentEvaluator,
      RecruitmentInterview,
      User,
      EvaluationAssignment,
      EvaluationResponse,
      TalentAssessment,
      Competency,
    ]),
    SubscriptionsModule,
    AuditModule,
    AiInsightsModule,
  ],
  controllers: [RecruitmentController],
  providers: [RecruitmentService],
  exports: [RecruitmentService],
})
export class RecruitmentModule {}
