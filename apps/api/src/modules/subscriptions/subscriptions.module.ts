import { Module, forwardRef } from '@nestjs/common';
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
import { BillingMetricsService } from './billing-metrics.service';
import { PriceOverridesService } from './price-overrides.service';
import { SubscriptionPriceOverride } from './entities/subscription-price-override.entity';
import { BillingSettingsService } from './billing-settings.service';
import { BillingSettings } from './entities/billing-settings.entity';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, SubscriptionPlan, PaymentHistory, SubscriptionRequest, Invoice, InvoiceLine, Tenant, User, EvaluationCycle, SubscriptionPriceOverride, BillingSettings]),
    AuditModule,
    forwardRef(() => NotificationsModule),
    // Fase 3 / Tarea 1.3 (reincorporada) — PaymentMethodsService usado
    // por processAutoRenewals para cobrar automaticamente la factura
    // del nuevo periodo con la tarjeta guardada por default.
    forwardRef(() => PaymentsModule),
  ],
  controllers: [SubscriptionsController, InvoicesController],
  providers: [SubscriptionsService, InvoicesService, BillingMetricsService, PriceOverridesService, BillingSettingsService],
  exports: [SubscriptionsService, InvoicesService],
})
export class SubscriptionsModule {}
