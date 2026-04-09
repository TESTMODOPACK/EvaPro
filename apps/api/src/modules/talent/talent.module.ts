import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TalentAssessment } from './entities/talent-assessment.entity';
import { CalibrationSession } from './entities/calibration-session.entity';
import { CalibrationEntry } from './entities/calibration-entry.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { User } from '../users/entities/user.entity';
import { Department } from '../tenants/entities/department.entity';
import { TalentService } from './talent.service';
import { TalentController } from './talent.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    AuditModule,
    SubscriptionsModule,
    TypeOrmModule.forFeature([
      TalentAssessment,
      CalibrationSession,
      CalibrationEntry,
      EvaluationAssignment,
      EvaluationResponse,
      User,
      Department,
    ]),
  ],
  controllers: [TalentController],
  providers: [TalentService],
  exports: [TalentService],
})
export class TalentModule {}
