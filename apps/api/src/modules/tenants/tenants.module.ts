import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';
import { SupportTicket } from './entities/support-ticket.entity';
import { AiInsight } from '../ai-insights/entities/ai-insight.entity';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, User, AuditLog, Subscription, SubscriptionPlan, SupportTicket, AiInsight]),
    NotificationsModule,
  ],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
