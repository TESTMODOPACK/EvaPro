import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { PaymentHistory } from './entities/payment-history.entity';
import { SubscriptionRequest } from './entities/subscription-request.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, SubscriptionPlan, PaymentHistory, SubscriptionRequest, Invoice, InvoiceLine, Tenant, User, EvaluationCycle]),
    AuditModule,
    NotificationsModule,
  ],
  controllers: [SubscriptionsController, InvoicesController],
  providers: [SubscriptionsService, InvoicesService],
  exports: [SubscriptionsService, InvoicesService],
})
export class SubscriptionsModule {}
