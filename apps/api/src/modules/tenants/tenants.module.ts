import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { SubscriptionPlan } from '../subscriptions/entities/subscription-plan.entity';
import { SupportTicket } from './entities/support-ticket.entity';
import { Department } from './entities/department.entity';
import { Position } from './entities/position.entity';
import { AiInsight } from '../ai-insights/entities/ai-insight.entity';
import { AiCallLog } from '../ai-insights/entities/ai-call-log.entity';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, User, AuditLog, Subscription, SubscriptionPlan, SupportTicket, AiInsight, AiCallLog, Department, Position]),
    NotificationsModule,
    // Fase 3 / Tarea 3.3 — exporta AuditService para registrar cambios
    // SII-criticos en billing info via updateBillingInfo.
    AuditModule,
  ],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
