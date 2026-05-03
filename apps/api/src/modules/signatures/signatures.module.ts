import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSignature } from './entities/document-signature.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { SignaturesService } from './signatures.service';
import { SignaturesController } from './signatures.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { EvaluationsModule } from '../evaluations/evaluations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentSignature, User,
      EvaluationCycle, EvaluationResponse, EvaluationAssignment,
      DevelopmentPlan, DevelopmentAction, Contract,
    ]),
    NotificationsModule,
    AuditModule,
    // T5.3 — para invocar captureAssignmentObjectiveSnapshot al firmar
    // un evaluation_response, freezando el estado de los objetivos del
    // evaluado en el momento exacto de la firma.
    EvaluationsModule,
  ],
  controllers: [SignaturesController],
  providers: [SignaturesService],
  exports: [SignaturesService],
})
export class SignaturesModule {}
