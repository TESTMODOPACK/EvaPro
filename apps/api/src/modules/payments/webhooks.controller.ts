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
import { WebhookLogsService } from './webhook-logs.service';

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
    // Fase 4 / T4.6 — Log de eventos para forensia + replay.
    private readonly logsSvc: WebhookLogsService,
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripe(
    @Req() req: any,
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody: Buffer = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      this.logger.error('Stripe webhook body is not a Buffer — express.raw() missing?');
      throw new BadRequestException('raw body required');
    }

    // Fase 4 / T4.6 — Persistir el evento ANTES de procesar.
    let parsedPayload: any = null;
    try {
      parsedPayload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      // Body malformado; lo registramos igual con payload null.
    }
    const logId = await this.logsSvc.record({
      provider: 'stripe',
      externalEventId: parsedPayload?.id ?? null,
      eventType: parsedPayload?.type ?? null,
      payload: parsedPayload,
    });

    const startedAt = Date.now();
    const event = await this.stripeProvider.verifyWebhook(rawBody, signature || '');
    if (!event) {
      await this.logsSvc.updateStatus(logId, 'invalid_signature', {
        reason: 'HMAC failed',
        processingMs: Date.now() - startedAt,
      });
      throw new BadRequestException('invalid signature');
    }
    try {
      const result = await this.svc.applyWebhookEvent('stripe', event);
      await this.logsSvc.updateStatus(
        logId,
        result.handled ? 'processed' : 'ignored',
        {
          reason: result.reason,
          processingMs: Date.now() - startedAt,
        },
      );
    } catch (err: any) {
      await this.logsSvc.updateStatus(logId, 'failed', {
        reason: String(err?.message || err).slice(0, 500),
        processingMs: Date.now() - startedAt,
      });
      throw err;
    }
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
    // Fase 4 / T4.6 — Loguear ANTES de cualquier procesamiento.
    let parsedPayload: any = null;
    try {
      parsedPayload = JSON.parse(rawBody.toString('utf8'));
    } catch {}
    const logId = await this.logsSvc.record({
      provider: 'mercadopago',
      externalEventId: dataId ?? null,
      eventType: type ?? null,
      payload: parsedPayload,
    });

    if (type !== 'payment') {
      await this.logsSvc.updateStatus(logId, 'ignored', {
        reason: `tipo ${type} no relevante`,
      });
      return { received: true, ignored: true };
    }
    if (!xSignature || !xRequestId || xRequestId.trim() === '' || !dataId) {
      await this.logsSvc.updateStatus(logId, 'invalid_signature', {
        reason: 'missing signature headers',
      });
      throw new BadRequestException('missing signature headers');
    }
    const map: Record<string, string> = {};
    xSignature.split(',').forEach((part) => {
      const [k, v] = part.split('=').map((s) => s.trim());
      if (k && v) map[k] = v;
    });
    const ts = map.ts;
    const v1 = map.v1;
    if (!ts || !v1) {
      await this.logsSvc.updateStatus(logId, 'invalid_signature', {
        reason: 'bad x-signature format',
      });
      throw new BadRequestException('bad x-signature format');
    }
    const composite = `${ts}|${xRequestId}|${dataId}|${v1}`;
    const startedAt = Date.now();
    const event = await this.mpProvider.verifyWebhook(rawBody, composite);
    if (!event) {
      await this.logsSvc.updateStatus(logId, 'invalid_signature', {
        reason: 'HMAC failed',
        processingMs: Date.now() - startedAt,
      });
      throw new BadRequestException('invalid signature');
    }
    try {
      const result = await this.svc.applyWebhookEvent('mercadopago', event);
      await this.logsSvc.updateStatus(
        logId,
        result.handled ? 'processed' : 'ignored',
        {
          reason: result.reason,
          processingMs: Date.now() - startedAt,
        },
      );
    } catch (err: any) {
      await this.logsSvc.updateStatus(logId, 'failed', {
        reason: String(err?.message || err).slice(0, 500),
        processingMs: Date.now() - startedAt,
      });
      throw err;
    }
    return { received: true };
  }
}
