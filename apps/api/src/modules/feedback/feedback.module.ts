import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckIn } from './entities/checkin.entity';
import { QuickFeedback } from './entities/quick-feedback.entity';
import { MeetingLocation } from './entities/meeting-location.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    AuditModule,
    SubscriptionsModule,
    TypeOrmModule.forFeature([CheckIn, QuickFeedback, MeetingLocation, User, Tenant]),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
