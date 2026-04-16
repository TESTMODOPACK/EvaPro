import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  PaymentProviderName,
  WebhookEvent,
} from './payment-provider.interface';

/**
 * MercadoPago "Preferences" adapter.
 *
 * Model:
 *   - We create a `Preference` (equivalent of a Stripe CheckoutSession) with
 *     one item = the invoice total.
 *   - MP responds with an `init_point` URL we redirect the user to.
 *   - On payment, MP hits our webhook at `/webhooks/mercadopago?type=payment&data.id=xxx`.
 *   - We verify the signature header manually (the SDK does not do this
 *     out of the box), then fetch the Payment by id to get its status.
 *
 * Configuration (env):
 *   MERCADOPAGO_ACCESS_TOKEN   — account access token (`APP_USR-...`)
 *   MERCADOPAGO_WEBHOOK_SECRET — signing secret configured in the MP dashboard
 *
 * Both missing → `isEnabled=false`, module stays dormant.
 */
@Injectable()
export class MercadoPagoProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'mercadopago';
  private readonly logger = new Logger(MercadoPagoProvider.name);
  private readonly accessToken: string;
  private readonly webhookSecret: string;
  // Lazy import to avoid crashing at load time if the lib has a stale native
  // binding that conflicts on Windows dev boxes (the SDK is CJS + ESM split).
  private mp: any = null;

  constructor() {
    this.accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    this.webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
    if (!this.accessToken) {
      this.logger.warn('MERCADOPAGO_ACCESS_TOKEN not set — MercadoPago provider is DISABLED');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mp = require('mercadopago');
      // v2 API: `new MercadoPagoConfig({ accessToken })` + `new Preference(client)`.
      this.mp = {
        config: new mp.MercadoPagoConfig({ accessToken: this.accessToken }),
        Preference: mp.Preference,
        Payment: mp.Payment,
      };
      this.logger.log('MercadoPago provider ready');
    } catch (err: any) {
      this.logger.warn(`mercadopago SDK failed to load: ${err?.message} — MercadoPago disabled`);
    }
  }

  get isEnabled(): boolean {
    return this.mp !== null && this.accessToken.length > 0;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    if (!this.mp) throw new Error('MercadoPago no está configurado.');
    if (input.currency !== 'CLP') {
      // Our MP integration targets Chile only in v1; other markets require
      // a per-country account (MP doesn't route across currencies).
      throw new Error(`MercadoPago solo soporta CLP; llegó ${input.currency}.`);
    }
    // MercadoPago rejects preferences with a missing/invalid notification_url.
    // Fail loud here rather than let the provider return an opaque error.
    const apiUrl = process.env.API_URL;
    if (!apiUrl || !/^https?:\/\//.test(apiUrl)) {
      throw new Error(
        'MercadoPago requires API_URL env var (fully-qualified, with scheme) for webhook delivery.',
      );
    }

    // External reference = our PaymentSession id. The webhook uses it to
    // find the session faster than doing a round-trip metadata lookup.
    const externalRef = input.metadata.payment_session_id || input.invoiceId;

    const preference = new this.mp.Preference(this.mp.config);
    const body = {
      items: [
        {
          id: input.invoiceId,
          title: `Factura ${input.invoiceNumber} — ${input.tenantName}`,
          description: 'Pago de suscripción Eva360',
          category_id: 'services',
          quantity: 1,
          currency_id: 'CLP',
          unit_price: Math.round(input.amount),
        },
      ],
      payer: { email: input.payerEmail },
      back_urls: {
        success: input.successUrl,
        pending: input.successUrl,
        failure: input.failureUrl,
      },
      // `auto_return: 'approved'` tells MP to auto-redirect back to us after
      // a successful payment. Without it the user sees MP's final screen.
      auto_return: 'approved',
      notification_url: `${process.env.API_URL || ''}/webhooks/mercadopago`,
      external_reference: externalRef,
      metadata: input.metadata,
      // Restrict to a single installment by default — suitable for B2B
      // monthly billing. For annual/enterprise plans we could relax this.
      payment_methods: {
        installments: 1,
      },
      statement_descriptor: 'EVA360',
      expires: true,
      expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    const res = await preference.create({ body });
    if (!res?.id || !res?.init_point) {
      throw new Error('MercadoPago preference created without id or init_point');
    }
    return { externalId: String(res.id), checkoutUrl: String(res.init_point) };
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookEvent | null> {
    if (!this.mp) return null;
    if (!this.webhookSecret) {
      // Without a secret we can't trust the payload — refuse and log.
      this.logger.warn('MP webhook received but MERCADOPAGO_WEBHOOK_SECRET is not set; rejecting');
      return null;
    }
    if (!signature) return null;

    // MP sends signature in the header `x-signature` with format:
    //   ts=1234567890,v1=<hmac-sha256-hex>
    // Plus a `x-request-id` header. The signed payload is:
    //   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
    // We validate against `x-signature` using the webhook secret.
    //
    // BUT the request-id is lost here because we only get the body+sig header.
    // The caller must pass the full signature value (ts=...,v1=...) concatenated
    // with the request id it received so we can rebuild the manifest.
    //
    // Practical approach: the controller reads `x-signature` + `x-request-id`
    // + the data.id from query string, and calls us with a composite signature
    // string `"<ts>|<requestId>|<dataId>|<v1>"`.
    const parts = signature.split('|');
    if (parts.length !== 4) {
      this.logger.warn('MP webhook composite signature malformed');
      return null;
    }
    const [ts, requestId, dataId, v1] = parts;
    if (!ts || !v1 || !dataId) return null;
    // Reject if the timestamp is more than 5 minutes old — protects against
    // replay attacks where an attacker captures a valid request and replays it.
    const tsNum = parseInt(ts, 10);
    if (!isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
      this.logger.warn(`MP webhook timestamp out of window: ${ts}`);
      return null;
    }

    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expectedHex = createHmac('sha256', this.webhookSecret).update(manifest).digest('hex');
    let received: Buffer, expected: Buffer;
    try {
      received = Buffer.from(v1, 'hex');
      expected = Buffer.from(expectedHex, 'hex');
    } catch {
      return null;
    }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      this.logger.warn('MP webhook signature mismatch');
      return null;
    }

    // Signature validated — now fetch the payment to determine status.
    // (MP webhooks send only the id; the status must be resolved via API.)
    try {
      const payment = new this.mp.Payment(this.mp.config);
      const p = await payment.get({ id: dataId });
      const externalRef = String(p?.external_reference || '');
      // MP statuses: approved, pending, in_process, authorized, rejected, cancelled, refunded, charged_back
      const status: string = String(p?.status || '');
      let type: WebhookEvent['type'] = 'unknown';
      if (status === 'approved' || status === 'authorized') type = 'payment.succeeded';
      else if (status === 'rejected') type = 'payment.failed';
      else if (status === 'cancelled' || status === 'refunded' || status === 'charged_back') type = 'payment.cancelled';
      return {
        type,
        externalId: externalRef,
        amount: typeof p?.transaction_amount === 'number' ? p.transaction_amount : undefined,
        currency: typeof p?.currency_id === 'string' ? String(p.currency_id) : undefined,
        failureReason: p?.status_detail ? String(p.status_detail) : undefined,
        isIgnorable: type === 'unknown',
      };
    } catch (err: any) {
      this.logger.warn(`MP webhook payment fetch failed: ${err?.message}`);
      return null;
    }
  }
}
