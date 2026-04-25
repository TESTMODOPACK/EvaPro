import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { StripeProvider } from './providers/stripe-provider';
import { MercadoPagoProvider } from './providers/mercadopago-provider';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Public, unauthenticated endpoints that receive webhook callbacks from
 * Stripe and MercadoPago. Marcado @Public a nivel clase para bypassar el
 * JwtAuthGuard global — los providers no envian bearer token. La auth real
 * vive en la verificacion de firma HMAC del provider (handleStripe /
 * handleMercadoPago).
 *
 * Both endpoints:
 *  - Expect the request body as raw bytes (configured via express.raw in
 *    main.ts; otherwise Stripe's signature check fails).
 *  - Verify the provider-specific signature.
 *  - On success, delegate to `PaymentsService.applyWebhookEvent()` which
 *    handles idempotency + side-effects.
 *  - Always respond 200 for events we recognized but can't act on (e.g.
 *    unknown type), so the provider doesn't retry forever. Return 400
 *    only when the signature is invalid (malicious / misconfigured).
 */
@Controller('webhooks')
@Public()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly svc: PaymentsService,
    private readonly stripeProvider: StripeProvider,
    private readonly mpProvider: MercadoPagoProvider,
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripe(
    @Req() req: any,
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody: Buffer = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      // Safety: if global body parser stole the body, we can't validate.
      this.logger.error('Stripe webhook body is not a Buffer — express.raw() missing?');
      throw new BadRequestException('raw body required');
    }
    const event = await this.stripeProvider.verifyWebhook(rawBody, signature || '');
    if (!event) throw new BadRequestException('invalid signature');
    await this.svc.applyWebhookEvent('stripe', event);
    return { received: true };
  }

  /**
   * MercadoPago sends:
   *   - Query: ?type=payment&data.id=<paymentId>
   *   - Headers: x-signature: "ts=...,v1=..."
   *              x-request-id: <uuid>
   *
   * We combine ts + request-id + data.id + v1 into a composite signature
   * string before invoking `verifyWebhook()` — the provider adapter rebuilds
   * MP's signature manifest from those pieces.
   */
  @Post('mercadopago')
  @HttpCode(HttpStatus.OK)
  async handleMercadoPago(
    @Req() req: any,
    @Headers('x-signature') xSignature: string,
    @Headers('x-request-id') xRequestId: string,
    @Query('type') type: string,
    @Query('data.id') dataId: string,
  ) {
    const rawBody: Buffer = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      this.logger.error('MP webhook body is not a Buffer — express.raw() missing?');
      throw new BadRequestException('raw body required');
    }
    if (type !== 'payment') {
      // MP sends many event categories (chargebacks, merchant orders, etc.);
      // we only care about `payment` today. Ack with 200 so MP stops retrying.
      return { received: true, ignored: true };
    }
    // Reject empty strings too — a missing x-request-id (stripped by a WAF
    // or proxy) would otherwise produce a valid-but-incomplete signature.
    if (!xSignature || !xRequestId || xRequestId.trim() === '' || !dataId) {
      throw new BadRequestException('missing signature headers');
    }
    // Parse "ts=...,v1=..." into a composite "ts|requestId|dataId|v1" that
    // the provider adapter knows how to validate.
    const map: Record<string, string> = {};
    xSignature.split(',').forEach((part) => {
      const [k, v] = part.split('=').map((s) => s.trim());
      if (k && v) map[k] = v;
    });
    const ts = map.ts;
    const v1 = map.v1;
    if (!ts || !v1) throw new BadRequestException('bad x-signature format');
    const composite = `${ts}|${xRequestId}|${dataId}|${v1}`;
    const event = await this.mpProvider.verifyWebhook(rawBody, composite);
    if (!event) throw new BadRequestException('invalid signature');
    await this.svc.applyWebhookEvent('mercadopago', event);
    return { received: true };
  }
}
