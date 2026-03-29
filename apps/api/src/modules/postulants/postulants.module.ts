import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostulantsController } from './postulants.controller';
import { PostulantsService } from './postulants.service';
import { Postulant } from './entities/postulant.entity';
import { PostulantProcess } from './entities/postulant-process.entity';
import { PostulantProcessEntry } from './entities/postulant-process-entry.entity';
import { PostulantProcessEvaluator } from './entities/postulant-process-evaluator.entity';
import { PostulantAssessment } from './entities/postulant-assessment.entity';
import { User } from '../users/entities/user.entity';
import { RoleCompetency } from '../development/entities/role-competency.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Postulant,
      PostulantProcess,
      PostulantProcessEntry,
      PostulantProcessEvaluator,
      PostulantAssessment,
      User,
      RoleCompetency,
      TalentAssessment,
    ]),
    SubscriptionsModule,
  ],
  controllers: [PostulantsController],
  providers: [PostulantsService],
  exports: [PostulantsService],
})
export class PostulantsModule {}
