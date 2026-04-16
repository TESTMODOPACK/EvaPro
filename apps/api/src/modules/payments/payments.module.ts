import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentSession } from './entities/payment-session.entity';
import { Invoice } from '../subscriptions/entities/invoice.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { WebhooksController } from './webhooks.controller';
import { StripeProvider } from './providers/stripe-provider';
import { MercadoPagoProvider } from './providers/mercadopago-provider';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

/**
 * Payments module — thin orchestration layer on top of two provider adapters
 * (Stripe, MercadoPago). Exposes:
 *   - `POST /payments/checkout`        — create a checkout session (JWT)
 *   - `GET  /payments/sessions/:id`    — poll session status (JWT)
 *   - `GET  /payments/providers`       — list enabled providers (JWT)
 *   - `POST /webhooks/stripe`          — provider webhook (PUBLIC, raw body)
 *   - `POST /webhooks/mercadopago`     — provider webhook (PUBLIC, raw body)
 *
 * AuditModule is @Global so AuditService is available via plain DI.
 * SubscriptionsModule is imported via forwardRef to reuse InvoicesService
 * (which in turn imports NotificationsModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentSession, Invoice, User, Tenant]),
    NotificationsModule,
    forwardRef(() => SubscriptionsModule),
  ],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService, StripeProvider, MercadoPagoProvider],
})
export class PaymentsModule {}
