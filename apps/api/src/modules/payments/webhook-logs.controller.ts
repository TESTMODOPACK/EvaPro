import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WebhookLogsService } from './webhook-logs.service';
import { PaymentsService } from './payments.service';
import { WebhookEventLogStatus } from './entities/webhook-event-log.entity';

/**
 * Fase 4 / Tarea 4.6 — Endpoints super_admin para visualizar y replay
 * webhooks recibidos. Util para reconciliacion con providers.
 */
@Controller('webhook-logs')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class WebhookLogsController {
  constructor(
    private readonly svc: WebhookLogsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get()
  list(
    @Query('provider') provider?: 'stripe' | 'mercadopago',
    @Query('status') status?: WebhookEventLogStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.list({
      provider,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findById(id);
  }

  /**
   * Replay manual: re-ejecuta el handler con el payload guardado.
   * Util cuando un evento fallo por error transitorio o cuando se
   * necesita re-procesar tras un fix.
   *
   * Reglas:
   *   - Bloquea replay de invalid_signature (vector de bypass).
   *   - Audit log obligatorio (webhook.replay_initiated).
   *   - Idempotencia heredada de los handlers (atomic UPDATE WHERE
   *     status='pending' previene duplicados).
   */
  @Post(':id/replay')
  @HttpCode(HttpStatus.OK)
  async replay(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const original = await this.svc.prepareReplay(
      id,
      req.user.userId || req.user.id,
    );
    // Re-extract WebhookEvent shape de la payload y reprocesar via
    // applyWebhookEvent. Si el payload no se serializo bien, fallaremos
    // graceful con un audit log de fallo.
    const provider = original.provider;
    // Construir WebhookEvent minimo desde el payload guardado.
    // Para Stripe: ya tenemos `eventType` y datos en payload.data.object.
    // Para MP: similar.
    // Aqui caemos directo al handler con un shape simulado.
    if (original.eventType && original.externalEventId) {
      // Reusa la logica de PaymentsService — si no es procesable por
      // el formato del payload, applyWebhookEvent lo dira en su
      // respuesta {handled:false, reason}.
      const event = {
        type: this.mapEventType(original.eventType),
        externalId: original.externalEventId,
        isIgnorable: false,
      } as any;
      const result = await this.paymentsService.applyWebhookEvent(
        provider,
        event,
      );
      return {
        replayed: true,
        originalId: id,
        result,
      };
    }
    return {
      replayed: false,
      reason: 'Payload sin event_type o external_event_id (no replayable).',
    };
  }

  /**
   * Mapea el event_type guardado (provider-specific) a nuestro enum
   * normalizado. Solo cubre los tipos comunes; para replay de eventos
   * raros caera a 'unknown' y el handler lo ignorara.
   */
  private mapEventType(eventType: string): string {
    // Stripe
    if (
      eventType === 'checkout.session.completed' ||
      eventType === 'checkout.session.async_payment_succeeded'
    )
      return 'payment.succeeded';
    if (
      eventType === 'checkout.session.async_payment_failed' ||
      eventType === 'payment_intent.payment_failed'
    )
      return 'payment.failed';
    if (eventType === 'checkout.session.expired') return 'payment.cancelled';
    if (eventType === 'charge.refunded') return 'payment.refunded';
    if (eventType === 'charge.dispute.created') return 'payment.disputed';
    // MP
    if (eventType === 'payment') return 'payment.succeeded';
    return 'unknown';
  }
}
