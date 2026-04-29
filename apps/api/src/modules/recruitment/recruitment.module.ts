import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecruitmentProcess } from './entities/recruitment-process.entity';
import { RecruitmentCandidate } from './entities/recruitment-candidate.entity';
import { RecruitmentEvaluator } from './entities/recruitment-evaluator.entity';
import { RecruitmentInterview } from './entities/recruitment-interview.entity';
import { User } from '../users/entities/user.entity';
import { UserMovement } from '../users/entities/user-movement.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { Competency } from '../development/entities/competency.entity';
import { Department } from '../tenants/entities/department.entity';
import { Position } from '../tenants/entities/position.entity';
import { RecruitmentService } from './recruitment.service';
import { RecruitmentController } from './recruitment.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AuditModule } from '../audit/audit.module';
import { AiInsightsModule } from '../ai-insights/ai-insights.module';
import { RlsModule } from '../../common/rls/rls.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecruitmentProcess,
      RecruitmentCandidate,
      RecruitmentEvaluator,
      RecruitmentInterview,
      User,
      // S1.2 Hire flow: la transaccion de hireCandidate inserta filas
      // en user_movements para registrar la cascada (PROMOTION/
      // LATERAL_TRANSFER/DEPARTMENT_CHANGE/etc.) en interno y "ingreso"
      // (POSITION_CHANGE con from=null) en externo.
      UserMovement,
      EvaluationAssignment,
      EvaluationResponse,
      TalentAssessment,
      Competency,
      Department,
      Position,
    ]),
    SubscriptionsModule,
    AuditModule,
    AiInsightsModule,
    RlsModule,
  ],
  controllers: [RecruitmentController],
  providers: [RecruitmentService],
  exports: [RecruitmentService],
})
export class RecruitmentModule {}
