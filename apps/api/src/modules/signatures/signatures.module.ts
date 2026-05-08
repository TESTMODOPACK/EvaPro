import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSignature } from './entities/document-signature.entity';
import { SignatureOtpToken } from './entities/signature-otp-token.entity';
import { SignatureReminderSent } from './entities/signature-reminder-sent.entity';
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
import { SignatureRemindersService } from './services/signature-reminders.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { EvaluationsModule } from '../evaluations/evaluations.module';
// Mejora #5 — RlsModule expone TenantCronRunner que necesita
// SignatureRemindersService para iterar tenants en el cron diario
// con app.current_tenant_id seteado (defense vs RLS).
import { RlsModule } from '../../common/rls/rls.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DocumentSignature, SignatureOtpToken, SignatureReminderSent, User,
      EvaluationCycle, EvaluationResponse, EvaluationAssignment,
      DevelopmentPlan, DevelopmentAction, Contract,
      CalibrationSession, CalibrationEntry,
    ]),
    NotificationsModule,
    AuditModule,
    // T5.3 — para invocar captureAssignmentObjectiveSnapshot al firmar
    // un evaluation_response, freezando el estado de los objetivos del
    // evaluado en el momento exacto de la firma.
    EvaluationsModule,
    // Mejora #5 — TenantCronRunner para el cron diario.
    RlsModule,
  ],
  controllers: [SignaturesController],
  providers: [SignaturesService, SignatureAuthorizationService, SignatureRemindersService],
  exports: [SignaturesService, SignatureAuthorizationService, SignatureRemindersService],
})
export class SignaturesModule {}
