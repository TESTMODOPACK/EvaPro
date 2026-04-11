import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrgDevelopmentController } from './org-development.controller';
import { OrgDevelopmentService } from './org-development.service';
import { OrgDevelopmentPlan } from './entities/org-development-plan.entity';
import { OrgDevelopmentInitiative } from './entities/org-development-initiative.entity';
import { OrgDevelopmentAction } from './entities/org-development-action.entity';
import { OrgDevInitiativeParticipant } from './entities/org-development-participant.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { User } from '../users/entities/user.entity';
import { Department } from '../tenants/entities/department.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrgDevelopmentPlan,
      OrgDevelopmentInitiative,
      OrgDevelopmentAction,
      OrgDevInitiativeParticipant,
      DevelopmentPlan,
      User,
      Department,
    ]),
    NotificationsModule,
  ],
  controllers: [OrgDevelopmentController],
  providers: [OrgDevelopmentService],
  exports: [OrgDevelopmentService],
})
export class OrgDevelopmentModule {}
