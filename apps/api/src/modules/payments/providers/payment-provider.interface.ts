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
  type:
    | 'payment.succeeded'
    | 'payment.failed'
    | 'payment.cancelled'
    // Fase 0 / Tarea 0.4 — Post-payment events. Pre-fix, MercadoPago
    // mapeaba `refunded` y `charged_back` a `payment.cancelled`,
    // confundiendo refunds y disputas con cancelaciones de checkout.
    // Resultado contable y operativo incorrecto: refunds invisibles,
    // chargebacks sin alerta, dunning siguiendo en facturas pagadas.
    | 'payment.refunded'
    | 'payment.disputed'
    // Fase 3 / Tarea 3.4 — Saved payment methods lifecycle.
    | 'setup_intent.succeeded'
    | 'payment_method.detached'
    | 'unknown';
  externalId: string;
  amount?: number;
  currency?: string;
  failureReason?: string;
  /** True if we parsed the payload but the event type is not in our vocabulary.
   *  Callers should 200-OK without side-effects. */
  isIgnorable?: boolean;
  /**
   * Fase 3 / Tarea 3.4 — Payload extra para eventos de payment_methods.
   * En `setup_intent.succeeded`: paymentMethodId final + customerId.
   * En `payment_method.detached`: paymentMethodId.
   */
  paymentMethodId?: string;
  customerId?: string;
  cardBrand?: string;
  cardLast4?: string;
  cardExpMonth?: number;
  cardExpYear?: number;
}

/**
 * Fase 2 / Tarea 2.3.1 — Input para emitir un refund en el provider.
 * `externalChargeId` es el id de la transaccion original (Stripe charge
 * id derivado de la session, MP payment id). `amount` opcional para
 * refund parcial — si se omite, refund total.
 */
export interface RefundInput {
  externalChargeId: string;
  amount?: number;
  reason?: string;
  /** Idempotency key para que reintentos del refund no creen duplicados. */
  idempotencyKey: string;
}

export interface RefundResult {
  /** ID del refund en el provider (Stripe `re_...`, MP refund id). */
  refundId: string;
  status: 'succeeded' | 'pending' | 'failed';
  amount: number;
  currency: string;
  /** Mensaje detallado si status='failed'. */
  failureReason?: string;
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
  /**
   * Fase 2 / Tarea 2.3.1 — Emite un refund (parcial o total) sobre una
   * transaccion previa. Opcional: providers que no implementen retornan
   * `undefined` y el caller debe manualmente registrar el refund sin
   * llamar al provider (e.g. transferencia manual).
   *
   * MUST ser idempotente respecto a `idempotencyKey`: si el mismo key
   * llega 2 veces, el provider debe responder con el refund existente
   * en vez de duplicarlo.
   */
  refundPayment?(input: RefundInput): Promise<RefundResult>;

  // ─── Fase 3 / Tarea 3.4 — Saved payment methods ────────────────────

  /**
   * Crea (o retorna existente) un Customer en el provider para este
   * tenant. Idempotente por `tenantId` — caller debe pasar el
   * customerId existente si lo tiene para evitar duplicados.
   */
  ensureCustomer?(input: {
    tenantId: string;
    tenantName: string;
    email: string;
    existingCustomerId?: string | null;
  }): Promise<{ customerId: string }>;

  /**
   * Inicia un Checkout en mode='setup' (Stripe). Retorna URL hosted que
   * captura la tarjeta sin cobrar. Webhook `checkout.session.completed`
   * con mode='setup' confirma + entrega el `payment_method` id final.
   * Mas simple que SetupIntent + Elements: 0 deps frontend nuevas,
   * mismo patron de redirect que checkout de pago.
   */
  createSetupIntent?(input: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ setupIntentId: string; checkoutUrl: string }>;

  /**
   * Cobra usando un payment_method previamente guardado (off_session=true).
   * Para retries automaticos de dunning, renovaciones, etc. NO crea un
   * checkout — el cobro es directo, el cliente no esta presente.
   */
  chargeStoredMethod?(input: {
    customerId: string;
    paymentMethodId: string;
    amount: number;
    currency: 'CLP' | 'USD';
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{
    chargeId: string;
    status: 'succeeded' | 'requires_action' | 'failed';
    failureReason?: string;
  }>;

  /**
   * Borra un payment_method del provider (revoca el token). Idempotente:
   * si ya esta detached, retorna OK silenciosamente.
   */
  detachPaymentMethod?(paymentMethodId: string): Promise<void>;
}
