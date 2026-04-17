import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentSession, PaymentProviderName } from './entities/payment-session.entity';
import { Invoice, InvoiceStatus } from '../subscriptions/entities/invoice.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { StripeProvider } from './providers/stripe-provider';
import { MercadoPagoProvider } from './providers/mercadopago-provider';
import { PaymentProvider, WebhookEvent } from './providers/payment-provider.interface';
import { convertToCLP } from '../../common/utils/currency-converter';
import { InvoicesService } from '../subscriptions/invoices.service';
import { EmailService } from '../notifications/email.service';
import { AuditService } from '../audit/audit.service';

/** Public info about a provider — used by the UI to only show available options. */
export interface ProviderInfo {
  name: PaymentProviderName;
  enabled: boolean;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://evaascenda.netlify.app';

  constructor(
    @InjectRepository(PaymentSession) private readonly sessionRepo: Repository<PaymentSession>,
    @InjectRepository(Invoice) private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly stripe: StripeProvider,
    private readonly mercadopago: MercadoPagoProvider,
    private readonly invoicesService: InvoicesService,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
  ) {}

  /** Lookup a provider adapter by name. Throws if not enabled. */
  private getProvider(name: PaymentProviderName): PaymentProvider {
    const map: Record<PaymentProviderName, PaymentProvider> = {
      stripe: this.stripe,
      mercadopago: this.mercadopago,
    };
    const p = map[name];
    if (!p) throw new BadRequestException(`Proveedor desconocido: ${name}`);
    if (!p.isEnabled) throw new BadRequestException(`El proveedor ${name} no está configurado.`);
    return p;
  }

  /** List providers configured in this deployment — used by the UI. */
  listProviders(): ProviderInfo[] {
    return [
      { name: 'stripe', enabled: this.stripe.isEnabled },
      { name: 'mercadopago', enabled: this.mercadopago.isEnabled },
    ];
  }

  /**
   * Start a checkout session for the given invoice. Returns a URL the UI
   * redirects to. Idempotent for short windows: if the caller spams the
   * button, we reuse an existing `pending` session instead of creating a
   * second one (prevents double-charges).
   */
  async createCheckout(
    userId: string,
    tenantId: string,
    invoiceId: string,
    provider: PaymentProviderName,
    ipAddress?: string,
  ): Promise<{ sessionId: string; checkoutUrl: string; provider: PaymentProviderName }> {
    // 1. Find + authorize the invoice.
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Factura no encontrada.');
    if (invoice.tenantId !== tenantId) {
      throw new ForbiddenException('No puedes pagar facturas de otro tenant.');
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Esta factura ya fue pagada.');
    }
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Esta factura está cancelada.');
    }

    // 2. If a session is still pending for the same invoice, reuse it —
    //    avoids two parallel Checkouts for the same money.
    const pending = await this.sessionRepo.findOne({
      where: { invoiceId, status: 'pending', provider },
      order: { createdAt: 'DESC' },
    });
    if (pending && pending.checkoutUrl && pending.createdAt.getTime() > Date.now() - 60 * 60 * 1000) {
      // Younger than 1h — reuse.
      return { sessionId: pending.id, checkoutUrl: pending.checkoutUrl, provider };
    }

    // 3. Load payer + tenant for the checkout display.
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado.');

    // 4. Convert invoice.total → provider currency (CLP today).
    const conversion = await convertToCLP(Number(invoice.total), invoice.currency);

    // 5. Create our session row FIRST (status=pending, no external_id yet).
    //    We populate external_id after the provider confirms the checkout
    //    was created successfully.
    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        tenantId,
        invoiceId,
        initiatedBy: userId,
        provider,
        amount: String(conversion.amount),
        currency: conversion.currency,
        status: 'pending',
        metadata: {
          originalAmount: conversion.originalAmount,
          originalCurrency: conversion.originalCurrency,
          conversionRate: conversion.rate,
          invoiceNumber: invoice.invoiceNumber,
        },
      }),
    );

    // 6. Call the provider. If it throws, mark our session failed so a
    //    retry creates a fresh one.
    try {
      const providerAdapter = this.getProvider(provider);
      const res = await providerAdapter.createCheckout({
        amount: conversion.amount,
        currency: conversion.currency,
        successUrl: `${this.appUrl}/pago/exitoso`,
        cancelUrl: `${this.appUrl}/pago/fallido?reason=cancelled`,
        failureUrl: `${this.appUrl}/pago/fallido`,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        tenantName: tenant.name,
        payerEmail: user.email,
        metadata: {
          payment_session_id: session.id,
          invoice_id: invoice.id,
          invoice_number: invoice.invoiceNumber,
          tenant_id: tenantId,
        },
      });
      session.externalId = res.externalId;
      session.checkoutUrl = res.checkoutUrl;
      await this.sessionRepo.save(session);

      this.auditService
        .log(tenantId, userId, 'payment.checkout_created', 'PaymentSession', session.id, {
          provider,
          invoiceId,
          amount: conversion.amount,
          currency: conversion.currency,
        }, ipAddress)
        .catch(() => undefined);

      return { sessionId: session.id, checkoutUrl: res.checkoutUrl, provider };
    } catch (err: any) {
      session.status = 'failed';
      session.failureReason = `provider_error: ${String(err?.message || err).slice(0, 400)}`;
      await this.sessionRepo.save(session);
      this.logger.error(`Checkout creation failed on ${provider}: ${err?.message}`);
      throw new BadRequestException('No pudimos iniciar el pago. Intenta de nuevo.');
    }
  }

  /** Read a session for polling from the /pago/exitoso page. */
  async getSession(sessionId: string, userId: string, tenantId: string): Promise<PaymentSession> {
    const s = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('Sesión no encontrada.');
    // Only the tenant that initiated can inspect it. Tenant scoping is the
    // first line of defense against session id enumeration.
    if (s.tenantId !== tenantId) throw new ForbiddenException('No puedes ver esta sesión.');
    return s;
  }

  /**
   * Apply a webhook event to a session. Este es el path que finaliza un
   * pago — marca sesión + factura + envía email. Diseñado para ser
   * idempotente y seguro frente a:
   *
   *  - **Retries de Stripe/MP** (3x con backoff por event). La atomic
   *    UPDATE "WHERE status='pending'" garantiza que solo un webhook
   *    gana la transición; los demás ven affected=0 y retornan handled
   *    sin side-effects (sin email duplicado, sin markAsPaid 2x).
   *
   *  - **markAsPaid falla después del lock**. Si después de adquirir el
   *    lock (session → paid) el `invoicesService.markAsPaid()` lanza,
   *    revertimos la session a 'pending' y re-throw. Así el próximo
   *    webhook puede reintentar sin quedar con estado inconsistente
   *    (session=paid + invoice=SENT + dunning cobrando).
   *
   *  - **Out-of-order events** (payment.failed llega antes que el
   *    payment.succeeded real): terminal states rechazan downgrades.
   */
  async applyWebhookEvent(
    provider: PaymentProviderName,
    event: WebhookEvent,
  ): Promise<{ handled: boolean; reason?: string }> {
    if (event.isIgnorable || event.type === 'unknown') {
      return { handled: false, reason: 'event type not relevant' };
    }
    if (!event.externalId) {
      return { handled: false, reason: 'event missing externalId' };
    }
    const session = await this.sessionRepo.findOne({
      where: { provider, externalId: event.externalId },
    });
    if (!session) {
      this.logger.warn(`Webhook event with no matching session: ${provider} ${event.externalId}`);
      return { handled: false, reason: 'session not found' };
    }

    // Idempotency fast-path: si ya es terminal con el outcome matching, noop.
    if (session.status === 'paid' && event.type === 'payment.succeeded') return { handled: true };
    if (session.status === 'failed' && event.type === 'payment.failed') return { handled: true };
    if (session.status === 'cancelled' && event.type === 'payment.cancelled') return { handled: true };
    // No permitir downgrades desde terminal (e.g. paid → failed).
    if (['paid', 'failed', 'cancelled', 'expired'].includes(session.status)) {
      this.logger.warn(
        `Webhook tried to transition session ${session.id} from ${session.status} to ${event.type}; ignoring`,
      );
      return { handled: false, reason: 'session already terminal' };
    }

    if (event.type === 'payment.succeeded') {
      return this.applyPaymentSucceeded(provider, event, session);
    }

    if (event.type === 'payment.failed' || event.type === 'payment.cancelled') {
      return this.applyPaymentFailedOrCancelled(provider, event, session);
    }

    return { handled: false, reason: 'unhandled event type' };
  }

  /**
   * Handler de payment.succeeded. Acquire atomic del lock via UPDATE WHERE
   * status='pending'; si no lo gana, asume que otro webhook concurrente lo
   * tomó (idempotente). Si gana, ejecuta markAsPaid — si falla, revierte.
   */
  private async applyPaymentSucceeded(
    provider: PaymentProviderName,
    event: WebhookEvent,
    session: PaymentSession,
  ): Promise<{ handled: boolean; reason?: string }> {
    // Atomic acquire: solo gana el webhook que logra pasar pending → paid.
    // Los concurrentes ven affected=0 y salen sin side-effects.
    const result = await this.sessionRepo
      .createQueryBuilder()
      .update(PaymentSession)
      .set({ status: 'paid', completedAt: new Date() })
      .where('id = :id AND status = :prev', { id: session.id, prev: 'pending' })
      .execute();

    if ((result.affected ?? 0) === 0) {
      // Otro webhook ya ganó la transición. Noop idempotente — el trabajo
      // (markAsPaid, email) lo hace el ganador.
      this.logger.log(
        `Session ${session.id} already transitioned to paid by a concurrent webhook; skipping duplicate side-effects`,
      );
      return { handled: true, reason: 'concurrent webhook already processed' };
    }

    // Somos el ganador del lock. Ejecutar markAsPaid.
    try {
      await this.invoicesService.markAsPaid(session.invoiceId, {
        paymentMethod: provider,
        transactionRef: event.externalId!,
        notes: `Pago procesado vía ${provider}`,
      }, session.initiatedBy);
    } catch (err: any) {
      // CRÍTICO: markAsPaid falló DESPUÉS de que ya marcamos la session
      // como paid. Si dejamos así, dunning seguirá enviando emails al
      // cliente que ya pagó (invoice queda en SENT). Revertimos el lock
      // para que el próximo retry del webhook pueda tomarlo de nuevo.
      await this.sessionRepo
        .createQueryBuilder()
        .update(PaymentSession)
        .set({ status: 'pending', completedAt: null })
        .where('id = :id', { id: session.id })
        .execute();
      this.logger.error(
        `markAsPaid failed for invoice ${session.invoiceId} after session lock; reverted session ${session.id} to pending for retry. Err: ${err?.message}`,
      );
      // Re-throw para que el webhook controller devuelva 5xx y el provider
      // reintente. Stripe/MP hacen hasta 3 reintentos con backoff — darle la
      // oportunidad a la DB/servicio de recuperarse.
      throw err;
    }

    // Post-commit: email + audit (fire-and-forget OK; si fallan, el estado
    // persistente ya quedó consistente — el email a lo sumo se pierde, no
    // corrompe data).
    const user = await this.userRepo.findOne({ where: { id: session.initiatedBy } });
    const tenant = await this.tenantRepo.findOne({ where: { id: session.tenantId } });
    if (user?.email) {
      this.emailService
        .sendPaymentReceived(user.email, {
          firstName: user.firstName,
          orgName: tenant?.name || '',
          amount: Number(session.amount),
          currency: session.currency,
          invoiceNumber: String(session.metadata?.invoiceNumber || ''),
          tenantId: session.tenantId,
        })
        .catch((err) => this.logger.warn(`Payment-received email failed: ${err?.message}`));
    }

    this.auditService
      .log(session.tenantId, session.initiatedBy, 'payment.succeeded', 'PaymentSession', session.id, {
        provider,
        invoiceId: session.invoiceId,
        amount: session.amount,
        currency: session.currency,
      })
      .catch(() => undefined);
    return { handled: true };
  }

  /**
   * Handler de payment.failed / payment.cancelled. Mismo patrón de
   * atomic acquire para prevenir emails duplicados en retries concurrentes.
   */
  private async applyPaymentFailedOrCancelled(
    provider: PaymentProviderName,
    event: WebhookEvent,
    session: PaymentSession,
  ): Promise<{ handled: boolean; reason?: string }> {
    const newStatus = event.type === 'payment.failed' ? 'failed' : 'cancelled';
    const result = await this.sessionRepo
      .createQueryBuilder()
      .update(PaymentSession)
      .set({
        status: newStatus,
        failureReason: event.failureReason || null,
        completedAt: new Date(),
      })
      .where('id = :id AND status = :prev', { id: session.id, prev: 'pending' })
      .execute();

    if ((result.affected ?? 0) === 0) {
      this.logger.log(
        `Session ${session.id} already transitioned by a concurrent webhook; skipping duplicate side-effects`,
      );
      return { handled: true, reason: 'concurrent webhook already processed' };
    }

    if (event.type === 'payment.failed') {
      const user = await this.userRepo.findOne({ where: { id: session.initiatedBy } });
      const tenant = await this.tenantRepo.findOne({ where: { id: session.tenantId } });
      if (user?.email) {
        this.emailService
          .sendPaymentFailed(user.email, {
            firstName: user.firstName,
            orgName: tenant?.name || '',
            amount: Number(session.amount),
            currency: session.currency,
            invoiceNumber: String(session.metadata?.invoiceNumber || ''),
            failureReason: event.failureReason || 'Pago rechazado por el proveedor',
            retryUrl: `${this.appUrl}/dashboard/mi-suscripcion`,
            tenantId: session.tenantId,
          })
          .catch((err) => this.logger.warn(`Payment-failed email failed: ${err?.message}`));
      }
    }

    this.auditService
      .log(session.tenantId, session.initiatedBy, `payment.${event.type.split('.')[1]}`, 'PaymentSession', session.id, {
        provider,
        invoiceId: session.invoiceId,
        reason: event.failureReason ?? null,
      })
      .catch(() => undefined);

    return { handled: true };
  }
}
