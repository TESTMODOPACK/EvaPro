import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  WebhookEventLog,
  WebhookEventLogStatus,
} from './entities/webhook-event-log.entity';
import { AuditService } from '../audit/audit.service';

/**
 * Fase 4 / Tarea 4.6 — Servicio de log + replay de webhooks.
 *
 * Reglas de negocio:
 *   - Persistencia ANTES de procesar. Asi tenemos rastro incluso si
 *     el handler crashea.
 *   - Sanitizacion del payload: max 50KB, sin PAN/CVV. Defer Fase 5:
 *     redaccion automatica de campos sensibles del provider.
 *   - Solo super_admin lista/replay (no es endpoint del cliente).
 *   - Replay re-ejecuta el handler con el payload guardado. La
 *     idempotencia de webhook events (atomic UPDATE WHERE status=
 *     'pending' en applyPaymentSucceeded etc.) asegura que un replay
 *     no duplica side-effects.
 *   - Audit log de replay con `webhook.replayed` action.
 */
@Injectable()
export class WebhookLogsService {
  private readonly logger = new Logger(WebhookLogsService.name);
  private static readonly MAX_PAYLOAD_KB = 50;

  constructor(
    @InjectRepository(WebhookEventLog)
    private readonly repo: Repository<WebhookEventLog>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Registra recepcion de un webhook. Llamado ANTES de procesar.
   * Retorna el id para que el caller pueda update status despues.
   */
  async record(input: {
    provider: 'stripe' | 'mercadopago';
    externalEventId?: string | null;
    eventType?: string | null;
    payload?: any;
  }): Promise<string> {
    // Sanitizar payload: stringify, truncar a 50KB. JSON-quote-friendly.
    let safePayload: any = null;
    if (input.payload !== undefined && input.payload !== null) {
      try {
        const str = JSON.stringify(input.payload);
        if (str.length > WebhookLogsService.MAX_PAYLOAD_KB * 1024) {
          // Truncate; preservar topo-level keys con marker.
          safePayload = {
            _truncated: true,
            _originalSize: str.length,
            preview: str.slice(0, 5000),
          };
        } else {
          safePayload = input.payload;
        }
      } catch {
        safePayload = { _serialization_error: true };
      }
    }

    const entity = this.repo.create({
      provider: input.provider,
      externalEventId: input.externalEventId ?? null,
      eventType: input.eventType ?? null,
      status: 'received' as WebhookEventLogStatus,
      payload: safePayload,
    });
    const saved = await this.repo.save(entity);
    return saved.id;
  }

  /**
   * Update status tras el handler. processingMs ayuda a detectar
   * handlers lentos.
   */
  async updateStatus(
    id: string,
    status: WebhookEventLogStatus,
    opts: {
      reason?: string;
      paymentSessionId?: string;
      processingMs?: number;
    } = {},
  ): Promise<void> {
    await this.repo.update(id, {
      status,
      reason: opts.reason ?? null,
      paymentSessionId: opts.paymentSessionId ?? null,
      processingMs: opts.processingMs ?? null,
    });
  }

  /** Listado para super_admin. Paginado + filtros simples. */
  async list(filters: {
    provider?: 'stripe' | 'mercadopago';
    status?: WebhookEventLogStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ data: WebhookEventLog[]; total: number }> {
    const limit = Math.min(Math.max(1, filters.limit || 50), 200);
    const offset = Math.max(0, filters.offset || 0);
    const where: any = {};
    if (filters.provider) where.provider = filters.provider;
    if (filters.status) where.status = filters.status;
    const [data, total] = await this.repo.findAndCount({
      where,
      order: { receivedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, total };
  }

  /** Detalle (admin clickea un row para ver payload completo). */
  async findById(id: string): Promise<WebhookEventLog> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Webhook event no encontrado.');
    return row;
  }

  /**
   * Marca como pendiente de replay. El caller (controller) debe
   * re-ejecutar el handler. Retorna el payload original.
   */
  async prepareReplay(id: string, userId: string): Promise<WebhookEventLog> {
    const row = await this.findById(id);
    if (row.status === 'invalid_signature') {
      // Replay de invalid_signature es sospechoso: alguien lo marco asi
      // por algo. Bloqueamos para evitar bypass de seguridad.
      throw new NotFoundException(
        'No se puede replay un webhook con firma invalida.',
      );
    }
    await this.auditService
      .log(null, userId, 'webhook.replay_initiated', 'webhook_event_log', id, {
        provider: row.provider,
        eventType: row.eventType,
        externalEventId: row.externalEventId,
        originalStatus: row.status,
      })
      .catch(() => undefined);
    return row;
  }

  /**
   * Defer Fase 5: purga > 90 dias.
   * Esquema esbozado aqui para que el cron lo implemente cuando se
   * agregue.
   */
  async purgeOlderThan(daysBack: number): Promise<{ purged: number }> {
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('received_at < :cutoff', { cutoff })
      .execute();
    return { purged: result.affected ?? 0 };
  }
}
