import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvaluationCycle } from './entities/evaluation-cycle.entity';
import { EvaluationAssignment } from './entities/evaluation-assignment.entity';
import { EvaluationResponse } from './entities/evaluation-response.entity';
import { PeerAssignment } from './entities/peer-assignment.entity';
import { CycleStage } from './entities/cycle-stage.entity';
import { CycleOrgSnapshot } from './entities/cycle-org-snapshot.entity';
import { CycleEvaluateeWeight } from './entities/cycle-evaluatee-weight.entity';
import { FormTemplate } from '../templates/entities/form-template.entity';
import { FormSubTemplate } from '../templates/entities/form-sub-template.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationsService } from './evaluations.service';
import { EvaluationsController } from './evaluations.controller';
import { UserTransferredListener } from './listeners/user-transferred.listener';
import { AuditModule } from '../audit/audit.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Objective } from '../objectives/entities/objective.entity';
import { KeyResult } from '../objectives/entities/key-result.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EvaluationCycle,
      EvaluationAssignment,
      EvaluationResponse,
      PeerAssignment,
      CycleStage,
      CycleOrgSnapshot,
      CycleEvaluateeWeight,
      FormTemplate,
      FormSubTemplate,
      User,
      Objective,
      KeyResult,
      AuditLog,
    ]),
    AuditModule,
    SubscriptionsModule,
    NotificationsModule,
  ],
  controllers: [EvaluationsController],
  providers: [
    EvaluationsService,
    // S2.2 — listener async de user.transferred. Se registra como
    // provider para que NestJS lo instancie y los @OnEvent decorators
    // queden conectados al event bus al arranque.
    UserTransferredListener,
  ],
  exports: [EvaluationsService],
})
export class EvaluationsModule {}
