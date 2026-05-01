import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecruitmentProcess } from './entities/recruitment-process.entity';
import { RecruitmentCandidate } from './entities/recruitment-candidate.entity';
import { RecruitmentEvaluator } from './entities/recruitment-evaluator.entity';
import { RecruitmentInterview } from './entities/recruitment-interview.entity';
import { RecruitmentCandidateStageHistory } from './entities/recruitment-candidate-stage-history.entity';
import { User } from '../users/entities/user.entity';
import { UserMovement } from '../users/entities/user-movement.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { Competency } from '../development/entities/competency.entity';
import { Department } from '../tenants/entities/department.entity';
import { Position } from '../tenants/entities/position.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { RecruitmentService } from './recruitment.service';
import { RecruitmentController } from './recruitment.controller';
import { PublicJobsController } from './public-jobs.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AuditModule } from '../audit/audit.module';
import { AiInsightsModule } from '../ai-insights/ai-insights.module';
import { UsersModule } from '../users/users.module';
import { RlsModule } from '../../common/rls/rls.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecruitmentProcess,
      RecruitmentCandidate,
      RecruitmentEvaluator,
      RecruitmentInterview,
      // S6.1 — historial de transiciones de stage para metricas (S6.3).
      RecruitmentCandidateStageHistory,
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
      // S5.1 — para resolver tenantName en el email de bienvenida
      // del hire externo.
      Tenant,
    ]),
    SubscriptionsModule,
    AuditModule,
    AiInsightsModule,
    // S2.1 — para inyectar UsersService.transferUser y centralizar
    // la cascada de cambio de dept/cargo/manager + emit del evento
    // user.transferred (listeners reaccionan en otros modulos).
    UsersModule,
    RlsModule,
    // S4.3 — para enviar notificacion al tenant_admin cuando un proceso
    // legacy (pre-S1) tiene candidato 'hired' sin cascada al User.
    NotificationsModule,
  ],
  controllers: [RecruitmentController, PublicJobsController],
  providers: [RecruitmentService],
  exports: [RecruitmentService],
})
export class RecruitmentModule {}
