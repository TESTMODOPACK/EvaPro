import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckIn } from './entities/checkin.entity';
import { QuickFeedback } from './entities/quick-feedback.entity';
import { MeetingLocation } from './entities/meeting-location.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
// v3.1 F1 — Agenda Mágica lee de estas entidades para armar el snapshot.
import { Objective } from '../objectives/entities/objective.entity';
import { Recognition } from '../recognition/entities/recognition.entity';
import { Competency } from '../development/entities/competency.entity';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AuditModule } from '../audit/audit.module';
// v3.1 F1 — opcional (degradación graceful si el tenant no tiene AI_INSIGHTS)
import { AiInsightsModule } from '../ai-insights/ai-insights.module';
import { RlsModule } from '../../common/rls/rls.module';

@Module({
  imports: [
    AuditModule,
    SubscriptionsModule,
    TypeOrmModule.forFeature([
      CheckIn,
      QuickFeedback,
      MeetingLocation,
      User,
      Tenant,
      Objective,
      Recognition,
      Competency,
    ]),
    forwardRef(() => NotificationsModule),
    forwardRef(() => AiInsightsModule),
    RlsModule,
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
