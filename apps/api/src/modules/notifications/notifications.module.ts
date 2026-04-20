import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { EmailService } from './email.service';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { RemindersService } from './reminders.service';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { Objective } from '../objectives/entities/objective.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { CheckIn } from '../feedback/entities/checkin.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ReportsModule } from '../reports/reports.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      PushSubscription,
      EvaluationAssignment,
      EvaluationCycle,
      Objective,
      DevelopmentAction,
      DevelopmentPlan,
      CheckIn,
      User,
      Tenant,
      Subscription,
    ]),
    forwardRef(() => SubscriptionsModule),
    forwardRef(() => ReportsModule),
    AuditModule,
  ],
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService, RemindersService, EmailService, PushService],
  exports: [NotificationsService, EmailService, PushService],
})
export class NotificationsModule {}
