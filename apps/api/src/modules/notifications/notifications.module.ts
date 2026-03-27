import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { EmailService } from './email.service';
import { RemindersService } from './reminders.service';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { Objective } from '../objectives/entities/objective.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { CheckIn } from '../feedback/entities/checkin.entity';
import { User } from '../users/entities/user.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      EvaluationAssignment,
      EvaluationCycle,
      Objective,
      DevelopmentAction,
      DevelopmentPlan,
      CheckIn,
      User,
    ]),
    SubscriptionsModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, RemindersService, EmailService],
  exports: [NotificationsService, EmailService],
})
export class NotificationsModule {}
