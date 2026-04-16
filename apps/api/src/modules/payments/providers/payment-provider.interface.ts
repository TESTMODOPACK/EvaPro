/**
 * Contract every payment provider (Stripe, MercadoPago, …) must satisfy.
 *
 * The rest of the app interacts with payments strictly through this interface,
 * so adding a new provider means implementing `createCheckout` + `verifyWebhook`
 * and registering it in `PaymentsModule`. Nothing else needs to change.
 *
 * This is NOT a subscription API — we only kick off one-time charges per
 * invoice. The server-side lifecycle (next billing date, renewals, proration)
 * stays in our domain (`SubscriptionsService`).
 */

export type PaymentProviderName = 'stripe' | 'mercadopago';

export interface CreateCheckoutInput {
  /** Amount charged in the provider's currency unit.
   *  For CLP this is an integer number of pesos (no decimals).
   *  For USD, a number with up to two decimals (we multiply x100 before sending to Stripe internally). */
  amount: number;
  currency: 'CLP' | 'USD';
  /** Callback URLs must be fully-qualified HTTPS in production. */
  successUrl: string;
  cancelUrl: string;
  failureUrl: string;
  invoiceId: string;
  invoiceNumber: string;
  tenantName: string;
  payerEmail: string;
  /** Arbitrary k/v sent to the provider so the webhook can round-trip it
   *  back without us having to keep a side-table. Use snake_case keys. */
  metadata: Record<string, string>;
}

export interface CreateCheckoutResult {
  /** Stripe CheckoutSession id / MercadoPago Preference id. */
  externalId: string;
  /** URL the client redirects to so the user can complete payment. */
  checkoutUrl: string;
}

/**
 * Normalized webhook event. We translate provider-specific event types into
 * this narrow set so `WebhooksController` stays provider-agnostic.
 * Unknown events map to `'unknown'` and are logged + 200-ok'd (provider won't
 * retry unknown-kind events endlessly).
 */
export interface WebhookEvent {
  type: 'payment.succeeded' | 'payment.failed' | 'payment.cancelled' | 'unknown';
  externalId: string;
  amount?: number;
  currency?: string;
  failureReason?: string;
  /** True if we parsed the payload but the event type is not in our vocabulary.
   *  Callers should 200-OK without side-effects. */
  isIgnorable?: boolean;
}

export interface PaymentProvider {
  /** Compile-time identifier. Matches the `provider` column in `payment_sessions`. */
  readonly name: PaymentProviderName;
  /** Is this provider fully configured (env vars present)? If false, it
   *  should NOT be offered to the user in the checkout modal. */
  readonly isEnabled: boolean;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  /** Verify signature and decode the webhook body.
   *  MUST return `null` if the signature is invalid — caller will 400.
   *  Returns a normalized event on success.
   *
   *  `rawBody` is the exact bytes received on the wire; any body-parser must
   *  be bypassed for webhook routes or Stripe's signature check will fail. */
  verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookEvent | null>;
}
