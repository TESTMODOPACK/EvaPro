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
import { PaymentProvider, RefundResult, WebhookEvent } from './providers/payment-provider.interface';
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
    if (session.status === 'refunded' && event.type === 'payment.refunded') return { handled: true };
    if (session.status === 'disputed' && event.type === 'payment.disputed') return { handled: true };

    // Fase 0 / Tarea 0.4.4 — Post-payment events son extensiones legitimas
    // del lifecycle, NO downgrades. Una session en 'paid' puede recibir
    // 'payment.refunded' o 'payment.disputed' validamente. Pre-fix las
    // bloqueabamos como "terminal" (porque 'paid' estaba en la lista).
    const isPostPaymentEvent =
      event.type === 'payment.refunded' || event.type === 'payment.disputed';

    // No permitir downgrades genuinos (e.g. paid → failed) ni transiciones
    // imposibles (e.g. cancelled → refunded — no se puede refund algo no
    // pagado). Solo aceptamos refund/dispute si la session paso por 'paid'.
    if (isPostPaymentEvent) {
      if (session.status !== 'paid' && session.status !== 'refunded' && session.status !== 'disputed') {
        this.logger.warn(
          `Webhook ${event.type} on session ${session.id} but status='${session.status}' (expected 'paid'); ignoring`,
        );
        return { handled: false, reason: 'cannot refund/dispute a non-paid session' };
      }
    } else if (['paid', 'failed', 'cancelled', 'expired', 'refunded', 'disputed'].includes(session.status)) {
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

    if (event.type === 'payment.refunded') {
      return this.applyPaymentRefunded(provider, event, session);
    }

    if (event.type === 'payment.disputed') {
      return this.applyPaymentDisputed(provider, event, session);
    }

    return { handled: false, reason: 'unhandled event type' };
  }

  /**
   * Handler de payment.refunded (Fase 0 / Tarea 0.4.4 — alcance MINIMO).
   *
   * Acciones P0:
   *   - atomic acquire del lock (paid -> refunded) para idempotencia.
   *   - audit log `payment.refunded` con monto y razon (para reconciliacion
   *     contable y SII Chile retention 6 anos).
   *   - log warning visible para que ops detecte el caso.
   *
   * Lo que NO hacemos aqui (defer Fase 2 / Tarea 2.3):
   *   - revertir invoice.status PAID -> CREDIT_NOTE (requiere flujo de
   *     credit notes que aun no existe).
   *   - email al cliente notificando el reembolso (depende de plantilla).
   *   - revertir lastPaymentAmount de la subscription.
   *   - alerta in-app al super_admin (notifications integradas vienen en
   *     Fase 4).
   *
   * Por ahora el efecto practico es: la PaymentSession refleja el evento,
   * el audit log queda con todo el detalle, y el super_admin tiene visibilidad
   * via /dashboard/audit-log para investigar y emitir credit note manual.
   */
  private async applyPaymentRefunded(
    provider: PaymentProviderName,
    event: WebhookEvent,
    session: PaymentSession,
  ): Promise<{ handled: boolean; reason?: string }> {
    const result = await this.sessionRepo
      .createQueryBuilder()
      .update(PaymentSession)
      .set({
        status: 'refunded',
        // No piso completedAt — preservo el momento del pago original;
        // refundedAt vive en metadata.
        metadata: () => `metadata || '${JSON.stringify({
          refundedAt: new Date().toISOString(),
          refundAmount: event.amount ?? null,
          refundCurrency: event.currency ?? null,
        }).replace(/'/g, "''")}'::jsonb`,
      })
      .where('id = :id AND status = :prev', { id: session.id, prev: 'paid' })
      .execute();

    if ((result.affected ?? 0) === 0) {
      // Fase 2 / Tarea 2.3.5 — DEDUPE. Si la session ya estaba en
      // 'refunded' es porque el refund manual via Eva360
      // (PaymentsService.refundInvoice) la transitiono primero y ya
      // creo la credit note. NO emitir otra para evitar duplicado.
      this.logger.log(
        `Session ${session.id} refund noop — webhook llego despues del refund manual (credit note ya emitida).`,
      );
      return { handled: true, reason: 'refund already processed manually' };
    }

    this.logger.warn(
      `[Refund] Session ${session.id} (invoice ${session.invoiceId}, tenant ${session.tenantId}) refunded via ${provider} (webhook-originated, NO manual call) — amount=${event.amount} ${event.currency}.`,
    );

    // Fase 2 / Tarea 2.3.5 — Auto-emitir credit note cuando el webhook
    // llega ANTES del refund manual (caso: super_admin emitio refund
    // desde dashboard del provider, no via Eva360). Aqui Eva360 se
    // entera del refund por webhook y debe materializar la NC para
    // mantener consistencia contable.
    //
    // Si llamar issueCreditNote falla (e.g. invoice no en PAID porque
    // markAsPaid nunca ocurrio, raro), audit log + flag manual para
    // que ops investigue. NO revertimos session.status — el dinero ya
    // se movio en el provider.
    let creditNoteId: string | null = null;
    let creditNoteNumber: string | null = null;
    try {
      // Provider envia amount en unidades del provider (CLP entero, USD
      // x100). Para Stripe charge.refunded el amount viene en
      // smallest currency unit; para CLP equivale a peso integer ya.
      const refundAmountForNc = event.amount ?? Number(session.amount);
      const cn = await this.invoicesService.issueCreditNote(
        session.invoiceId,
        {
          amount: refundAmountForNc,
          reason: `Refund recibido via webhook ${provider} (originado en dashboard del provider)`,
          notes: `Provider event externalId: ${event.externalId}`,
        },
        // userId='system' — el refund no tiene actor humano del lado
        // Eva360. Audit log queda con system para distinguir de
        // refunds manuales gatillados por super_admin.
        'system',
        session.tenantId,
      );
      creditNoteId = cn.id;
      creditNoteNumber = cn.invoiceNumber;
    } catch (err: any) {
      this.logger.error(
        `[Refund] Webhook OK pero issueCreditNote fallo para invoice ${session.invoiceId}: ${err?.message}. ` +
          'MANUAL: super_admin debe emitir credit note via POST /invoices/:id/credit-notes.',
      );
      await this.auditService
        .log(session.tenantId, null, 'invoice.credit_note_pending_manual', 'invoice', session.invoiceId, {
          providerEventId: event.externalId,
          amount: event.amount ?? null,
          error: String(err?.message || err).slice(0, 500),
          requiresImmediateAction: true,
        })
        .catch(() => undefined);
    }

    await this.auditService
      .log(session.tenantId, session.initiatedBy, 'payment.refunded', 'PaymentSession', session.id, {
        provider,
        invoiceId: session.invoiceId,
        amount: event.amount ?? null,
        currency: event.currency ?? null,
        originalAmount: session.amount,
        originalCurrency: session.currency,
        creditNoteId,
        creditNoteNumber,
        // false = refund originado en webhook del provider, NO en Eva360.
        manualRefund: false,
        // Si la NC se emitio OK, no requiere accion. Si fallo, queda en true.
        requiresManualCreditNote: creditNoteId === null,
      })
      .catch(() => undefined);

    return { handled: true };
  }

  /**
   * Handler de payment.disputed (Fase 0 / Tarea 0.4.4 — alcance MINIMO).
   *
   * Una disputa / chargeback significa que el cliente o su banco
   * reclamaron el cobro al provider. El dinero queda congelado hasta que
   * el super_admin responda con evidencia (factura, T&C, prueba de
   * servicio prestado) y el provider resuelva.
   *
   * Acciones P0:
   *   - atomic acquire del lock (paid -> disputed).
   *   - audit log `payment.disputed` con razon — accion CRITICAL para
   *     retention 6 anos (SII Chile).
   *   - log warning visible para alerta inmediata via Sentry/logs.
   *
   * Lo que NO hacemos aqui (defer Fase 2/4):
   *   - email/notif al super_admin (notifications de operacion en Fase 4).
   *   - freno del cobro automatico de la sub asociada (Fase 1 dunning).
   *   - upload de evidencia automatico al provider (Fase 5 hardening).
   */
  private async applyPaymentDisputed(
    provider: PaymentProviderName,
    event: WebhookEvent,
    session: PaymentSession,
  ): Promise<{ handled: boolean; reason?: string }> {
    const result = await this.sessionRepo
      .createQueryBuilder()
      .update(PaymentSession)
      .set({
        status: 'disputed',
        metadata: () => `metadata || '${JSON.stringify({
          disputedAt: new Date().toISOString(),
          disputeReason: event.failureReason ?? null,
          disputeAmount: event.amount ?? null,
        }).replace(/'/g, "''")}'::jsonb`,
      })
      .where('id = :id AND status = :prev', { id: session.id, prev: 'paid' })
      .execute();

    if ((result.affected ?? 0) === 0) {
      this.logger.log(
        `Session ${session.id} dispute ignored — status already moved by concurrent webhook`,
      );
      return { handled: true, reason: 'concurrent webhook already processed' };
    }

    this.logger.error(
      `[DISPUTE] CRITICAL — Session ${session.id} (invoice ${session.invoiceId}, tenant ${session.tenantId}) DISPUTED via ${provider}. ` +
        `Reason: ${event.failureReason || 'no_reason_provided'}. Amount=${event.amount} ${event.currency}. ` +
        `Super_admin debe revisar en dashboard del provider y aportar evidencia para responder a la disputa.`,
    );

    await this.auditService
      .log(session.tenantId, session.initiatedBy, 'payment.disputed', 'PaymentSession', session.id, {
        provider,
        invoiceId: session.invoiceId,
        amount: event.amount ?? null,
        currency: event.currency ?? null,
        reason: event.failureReason ?? null,
        // Flag para escalacion ops.
        requiresImmediateAction: true,
      })
      .catch(() => undefined);

    return { handled: true };
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

  // ─── Refunds (Fase 2 / Tarea 2.3) ────────────────────────────────────

  /**
   * Emite un refund total o parcial sobre una invoice ya pagada.
   *
   * Flujo:
   *   1. Validar invoice existe, esta PAID, pertenece al tenant.
   *   2. Buscar payment_session 'paid' para esa invoice (la que registra
   *      el cobro real).
   *   3. Validar amount (default total si no se pasa).
   *   4. Llamar provider.refundPayment con idempotencyKey deterministica
   *      basada en (paymentSessionId, amount, attempt).
   *   5. Actualizar paymentSession.status -> 'refunded' (atomicamente con
   *      patch UPDATE WHERE status='paid' para evitar doble-refund).
   *   6. Auto-emitir credit note vinculada a la invoice (T2.3.3).
   *   7. Audit log payment.refunded con flag manualRefund=true para
   *      diferenciar de refunds que llegan via webhook desde el
   *      dashboard del provider.
   *
   * Si despues de hacer este refund manual llega un webhook
   * payment.refunded del provider para el mismo charge, el handler
   * debe deduplicar (T2.3.5) — la session ya esta en 'refunded'.
   *
   * Idempotency: si el caller invoca dos veces con `idempotencyKey`
   * unico (o sin pasarlo), el provider rechaza el 2do o retorna el
   * mismo refund (depende del provider).
   */
  async refundInvoice(
    invoiceId: string,
    dto: { amount?: number; reason: string; idempotencyKey?: string },
    userId: string,
    tenantId?: string,
  ): Promise<{
    refundId: string;
    status: 'succeeded' | 'pending' | 'failed';
    amount: number;
    creditNoteId: string;
    creditNoteNumber: string;
  }> {
    if (!dto.reason || dto.reason.trim().length < 3) {
      throw new BadRequestException('reason es obligatorio (min 3 chars).');
    }

    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Factura no encontrada.');
    if (tenantId && invoice.tenantId !== tenantId) {
      throw new ForbiddenException('La factura no pertenece al tenant indicado.');
    }
    if (invoice.status !== InvoiceStatus.PAID) {
      throw new BadRequestException(
        `Solo facturas pagadas admiten refund (estado actual: ${invoice.status}).`,
      );
    }

    // Buscar payment_session que registro el cobro. Si hay varias
    // (caso raro, intentos previos failed), tomamos la PAID — el unico
    // candidato valido para refund.
    const session = await this.sessionRepo.findOne({
      where: { invoiceId: invoice.id, status: 'paid' },
      order: { completedAt: 'DESC' },
    });
    if (!session) {
      throw new BadRequestException(
        'No se encontro payment_session pagada asociada a esta factura. ' +
          'Si el pago fue manual (transferencia/efectivo), use issueCreditNote en su lugar.',
      );
    }
    if (!session.externalId) {
      throw new BadRequestException(
        'La sesion de pago no tiene externalId — no se puede refund via provider.',
      );
    }

    const refundAmount = dto.amount ?? Number(session.amount);
    if (refundAmount <= 0) {
      throw new BadRequestException('amount debe ser > 0.');
    }
    if (refundAmount > Number(session.amount) + 0.001) {
      throw new BadRequestException(
        `amount (${refundAmount}) excede el monto cobrado (${session.amount}).`,
      );
    }

    const provider = this.getProvider(session.provider);
    if (!provider.refundPayment) {
      throw new BadRequestException(
        `El provider ${session.provider} no soporta refund automatico. ` +
          'Emita el refund manualmente en el dashboard y registre con issueCreditNote.',
      );
    }

    // Idempotency key deterministico: si el caller no provee, generamos
    // basado en (sessionId, amount). Multiples retries del mismo refund
    // -> mismo key -> provider retorna el refund existente.
    const idempotencyKey =
      dto.idempotencyKey || `refund-${session.id}-${Math.round(refundAmount * 100)}`;

    let refundResult: RefundResult;
    try {
      refundResult = await provider.refundPayment({
        externalChargeId: session.externalId,
        amount: refundAmount,
        reason: dto.reason,
        idempotencyKey,
      });
    } catch (err: any) {
      this.logger.error(
        `Refund provider call failed for session=${session.id}: ${err?.message}`,
      );
      await this.auditService
        .log(session.tenantId, userId, 'payment.refund_failed', 'PaymentSession', session.id, {
          provider: session.provider,
          invoiceId: invoice.id,
          amount: refundAmount,
          error: String(err?.message || err).slice(0, 500),
        })
        .catch(() => undefined);
      throw new BadRequestException(
        `Refund rechazado por el proveedor: ${err?.message || 'desconocido'}.`,
      );
    }

    // Si el provider responde 'failed', no creamos credit note y
    // dejamos audit log para que ops investigue.
    if (refundResult.status === 'failed') {
      await this.auditService
        .log(session.tenantId, userId, 'payment.refund_failed', 'PaymentSession', session.id, {
          provider: session.provider,
          invoiceId: invoice.id,
          amount: refundAmount,
          providerRefundId: refundResult.refundId,
          providerReason: refundResult.failureReason,
        })
        .catch(() => undefined);
      throw new BadRequestException(
        `Refund rechazado por el proveedor: ${refundResult.failureReason || 'sin detalle'}.`,
      );
    }

    // Atomic: marcar sesion como refunded SOLO si esta en 'paid'.
    // Si el webhook concurrente la transitiona primero, esto es noop.
    const updateRes = await this.sessionRepo
      .createQueryBuilder()
      .update(PaymentSession)
      .set({
        status: 'refunded',
        metadata: () =>
          `metadata || '${JSON.stringify({
            refundedAt: new Date().toISOString(),
            refundAmount,
            refundCurrency: refundResult.currency,
            providerRefundId: refundResult.refundId,
            manualRefund: true,
            reason: dto.reason,
          }).replace(/'/g, "''")}'::jsonb`,
      })
      .where('id = :id AND status = :prev', { id: session.id, prev: 'paid' })
      .execute();

    if ((updateRes.affected ?? 0) === 0) {
      this.logger.log(
        `Session ${session.id} ya estaba en estado != 'paid' al intentar refund — webhook concurrente probablemente lo movio primero. ` +
          'Continuando con la creacion de credit note (idempotente por providerRefundId).',
      );
    }

    // Auto-emitir credit note vinculada (T2.3.3). InvoicesService es
    // responsable del enum/numeracion/PDF.
    let creditNote;
    try {
      creditNote = await this.invoicesService.issueCreditNote(
        invoice.id,
        {
          amount: refundAmount,
          reason: `Refund automatico via ${session.provider}: ${dto.reason}`,
          notes: `Provider refund id: ${refundResult.refundId}`,
        },
        userId,
        invoice.tenantId,
      );
    } catch (err: any) {
      // Si la credit note falla, NO revertimos el refund del provider —
      // el dinero ya se movio. Audit + alerta para que super_admin la
      // emita manualmente.
      this.logger.error(
        `Refund OK en provider pero issueCreditNote fallo: ${err?.message}. ` +
          `MANUAL action requerida: emitir credit note para invoice ${invoice.id}.`,
      );
      await this.auditService
        .log(session.tenantId, userId, 'invoice.credit_note_pending_manual', 'invoice', invoice.id, {
          providerRefundId: refundResult.refundId,
          amount: refundAmount,
          error: String(err?.message || err).slice(0, 500),
          requiresImmediateAction: true,
        })
        .catch(() => undefined);
      // Re-throw para que el caller sepa que el refund fue parcialmente OK.
      throw new BadRequestException(
        `Refund procesado por el proveedor (${refundResult.refundId}) pero ` +
          'la generacion automatica de credit note fallo. Emitirla manualmente.',
      );
    }

    await this.auditService
      .log(session.tenantId, userId, 'payment.refunded', 'PaymentSession', session.id, {
        provider: session.provider,
        invoiceId: invoice.id,
        amount: refundAmount,
        currency: refundResult.currency,
        providerRefundId: refundResult.refundId,
        creditNoteId: creditNote.id,
        creditNoteNumber: creditNote.invoiceNumber,
        reason: dto.reason,
        manualRefund: true,
      })
      .catch(() => undefined);

    return {
      refundId: refundResult.refundId,
      status: refundResult.status,
      amount: refundAmount,
      creditNoteId: creditNote.id,
      creditNoteNumber: creditNote.invoiceNumber,
    };
  }
}
