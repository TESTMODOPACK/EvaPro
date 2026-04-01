import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostulantsController } from './postulants.controller';
import { PostulantsService } from './postulants.service';
import { Postulant } from './entities/postulant.entity';
import { PostulantProcess } from './entities/postulant-process.entity';
import { PostulantProcessEntry } from './entities/postulant-process-entry.entity';
import { PostulantProcessEvaluator } from './entities/postulant-process-evaluator.entity';
import { PostulantAssessment } from './entities/postulant-assessment.entity';
import { PostulantRequirementCheck } from './entities/postulant-requirement-check.entity';
import { User } from '../users/entities/user.entity';
import { RoleCompetency } from '../development/entities/role-competency.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { Objective } from '../objectives/entities/objective.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Postulant,
      PostulantProcess,
      PostulantProcessEntry,
      PostulantProcessEvaluator,
      PostulantAssessment,
      PostulantRequirementCheck,
      User,
      RoleCompetency,
      TalentAssessment,
      EvaluationAssignment,
      EvaluationResponse,
      Objective,
    ]),
    SubscriptionsModule,
  ],
  controllers: [PostulantsController],
  providers: [PostulantsService],
  exports: [PostulantsService],
})
export class PostulantsModule {}
