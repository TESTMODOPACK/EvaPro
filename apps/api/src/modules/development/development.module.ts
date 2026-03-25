import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Competency } from './entities/competency.entity';
import { RoleCompetency } from './entities/role-competency.entity';
import { DevelopmentPlan } from './entities/development-plan.entity';
import { DevelopmentAction } from './entities/development-action.entity';
import { DevelopmentComment } from './entities/development-comment.entity';
import { User } from '../users/entities/user.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { DevelopmentService } from './development.service';
import { DevelopmentController } from './development.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Competency, RoleCompetency, DevelopmentPlan, DevelopmentAction, DevelopmentComment, User, TalentAssessment])],
  controllers: [DevelopmentController],
  providers: [DevelopmentService],
  exports: [DevelopmentService],
})
export class DevelopmentModule {}
