import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  PaymentProviderName,
  WebhookEvent,
} from './payment-provider.interface';

// Stripe's CJS typings only expose the constructor under the default import;
// the instance type lives at `Stripe.Stripe`. Event/resource payloads we
// receive from webhooks we treat as opaque shapes — the signature check
// already guarantees authenticity, and we only read a handful of fields.
type StripeClient = Stripe.Stripe;

/**
 * Stripe Checkout adapter. We use Checkout Sessions in `mode: 'payment'`
 * (one-time charge) rather than `mode: 'subscription'` because our
 * SubscriptionsService already owns the lifecycle (proration, renewal,
 * add-ons). Stripe here is just a payment rail.
 *
 * Configuration (env):
 *   STRIPE_SECRET_KEY       — secret key starting with `sk_...`
 *   STRIPE_WEBHOOK_SECRET   — endpoint secret for verifying signatures
 *
 * If either is missing, `isEnabled` returns false and the module refuses to
 * offer Stripe in the checkout modal. This is SAFE to deploy without keys.
 */
@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'stripe';
  private readonly logger = new Logger(StripeProvider.name);
  private readonly client: StripeClient | null;
  private readonly webhookSecret: string;

  constructor() {
    const secret = process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    if (!secret) {
      this.logger.warn('STRIPE_SECRET_KEY not set — Stripe provider is DISABLED');
      this.client = null;
      return;
    }
    this.client = new Stripe(secret, {
      // Pin apiVersion to avoid silent breaking changes when the library updates.
      // `any` cast is required because TS types are tied to a specific pinned version.
      apiVersion: '2024-12-18.acacia' as any,
      // Short timeouts — we'd rather fail fast than block a user's checkout click.
      timeout: 10_000,
      telemetry: false,
    });
    this.logger.log('Stripe provider ready');
  }

  get isEnabled(): boolean {
    return this.client !== null && this.webhookSecret.length > 0;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    if (!this.client) throw new Error('Stripe no está configurado.');

    // Stripe expects the unit_amount in the SMALLEST currency unit. CLP has
    // no sub-units (no cents in Chilean pesos), so the number we send is the
    // integer amount of pesos. USD gets multiplied by 100.
    //
    // See: https://stripe.com/docs/currencies#zero-decimal
    const zeroDecimal = input.currency === 'CLP';
    const unitAmount = zeroDecimal ? Math.round(input.amount) : Math.round(input.amount * 100);

    const session = await this.client.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: unitAmount,
            product_data: {
              name: `Factura ${input.invoiceNumber} — ${input.tenantName}`,
              description: `Pago de suscripción Eva360`,
            },
          },
        },
      ],
      // success_url gets `session_id={CHECKOUT_SESSION_ID}` appended so our page
      // can cross-check. cancel_url is used for user-initiated cancellations;
      // failure_url is purely informational here (Stripe doesn't redirect on
      // failed card auth — it shows an inline error in Checkout).
      success_url: `${input.successUrl}${input.successUrl.includes('?') ? '&' : '?'}sessionId=${encodeURIComponent(input.metadata.payment_session_id ?? '')}`,
      cancel_url: input.cancelUrl,
      customer_email: input.payerEmail,
      // payment_intent_data.metadata flows into the PaymentIntent; keeping
      // session-level metadata makes the webhook lookup simpler.
      metadata: input.metadata,
      payment_intent_data: {
        metadata: input.metadata,
        description: `Eva360 — Factura ${input.invoiceNumber}`,
      },
      // 24h expiry — shorter than Stripe's default 24h; matches our invoice TTL.
      expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    });

    if (!session.id || !session.url) {
      throw new Error('Stripe checkout session created without id or url');
    }
    return { externalId: session.id, checkoutUrl: session.url };
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookEvent | null> {
    if (!this.client) return null;
    if (!signature) return null;
    // We accept the event as a loose shape — signature check already ran.
    let event: any;
    try {
      event = this.client.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err: any) {
      this.logger.warn(`Stripe webhook signature verification failed: ${err?.message}`);
      return null;
    }

    // Map Stripe event types to our normalized vocabulary. Only a small
    // subset is meaningful for one-time payments via Checkout.
    //
    // `checkout.session.completed`          → user paid, may be pending confirmation for some bank methods
    // `checkout.session.async_payment_succeeded` → bank-backed methods finally confirmed
    // `checkout.session.async_payment_failed`    → bank-backed methods rejected after the fact
    // `checkout.session.expired`            → session timed out without payment
    // `payment_intent.payment_failed`       → card declined / 3DS failed
    //
    // We treat `checkout.session.completed` as success IF payment_status === 'paid'.
    // Async pending ("unpaid") is also success for our purposes — we'll flip
    // to failed via the subsequent async_payment_failed event if that occurs.
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const s = event.data.object as any;
        const paid = s.payment_status === 'paid' || s.payment_status === 'no_payment_required';
        return {
          type: paid ? 'payment.succeeded' : 'unknown',
          externalId: s.id,
          amount: s.amount_total ?? undefined,
          currency: s.currency?.toUpperCase(),
          isIgnorable: !paid,
        };
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const s = event.data.object as any;
        return {
          type: event.type === 'checkout.session.expired' ? 'payment.cancelled' : 'payment.failed',
          externalId: s.id,
          failureReason: event.type === 'checkout.session.expired' ? 'session_expired' : 'async_payment_failed',
        };
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as any;
        // We can't look up by payment_intent id directly (we keyed by
        // checkout session id); the metadata carries the session id.
        const sessionId = (pi.metadata && pi.metadata.stripe_checkout_session_id) || '';
        return {
          type: 'payment.failed',
          externalId: sessionId,
          failureReason: pi.last_payment_error?.message || 'payment_failed',
          isIgnorable: !sessionId,
        };
      }
      default:
        return { type: 'unknown', externalId: '', isIgnorable: true };
    }
  }
}
