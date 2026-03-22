import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EvaluationCycle } from './entities/evaluation-cycle.entity';
import { EvaluationAssignment } from './entities/evaluation-assignment.entity';
import { EvaluationResponse } from './entities/evaluation-response.entity';
import { FormTemplate } from '../templates/entities/form-template.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationsService } from './evaluations.service';
import { EvaluationsController } from './evaluations.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EvaluationCycle,
      EvaluationAssignment,
      EvaluationResponse,
      FormTemplate,
      User,
    ]),
    AuditModule,
  ],
  controllers: [EvaluationsController],
  providers: [EvaluationsService],
  exports: [EvaluationsService],
})
export class EvaluationsModule {}
