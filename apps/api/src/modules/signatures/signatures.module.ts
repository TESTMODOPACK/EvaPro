import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSignature } from './entities/document-signature.entity';
import { SignatureOtpToken } from './entities/signature-otp-token.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { CalibrationSession } from '../talent/entities/calibration-session.entity';
import { CalibrationEntry } from '../talent/entities/calibration-entry.entity';
import { SignaturesService } from './signatures.service';
import { SignaturesController } from './signatures.controller';
import { SignatureAuthorizationService } from './services/signature-authorization.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentSignature, SignatureOtpToken, User,
      EvaluationCycle, EvaluationResponse, EvaluationAssignment,
      DevelopmentPlan, DevelopmentAction, Contract,
      CalibrationSession, CalibrationEntry,
    ]),
    NotificationsModule,
    AuditModule,
  ],
  controllers: [SignaturesController],
  providers: [SignaturesService, SignatureAuthorizationService],
  exports: [SignaturesService, SignatureAuthorizationService],
})
export class SignaturesModule {}
