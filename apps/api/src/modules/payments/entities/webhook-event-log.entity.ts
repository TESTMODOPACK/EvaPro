import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Fase 4 / Tarea 4.6 — Log de webhooks recibidos para forensia +
 * reconciliacion con providers.
 *
 * Reglas de negocio:
 *   - Todo webhook que llega a /webhooks/stripe o /webhooks/mercadopago
 *     se persiste aqui (signature valida o invalida) ANTES de procesar.
 *   - Payload sanitizado: nunca PAN/CVV; sensitive fields del provider
 *     que no necesitamos se omiten.
 *   - status: 'received' (entro) | 'processed' (handled OK) | 'failed'
 *     (handler arrojo error) | 'invalid_signature' | 'ignored' (no
 *     relevante para nosotros).
 *   - Permite REPLAY manual por super_admin si un webhook falla.
 *   - Retention: 90 dias (suficiente para SII + ops); defer purga cron
 *     a Fase 5.
 */
export type WebhookEventLogStatus =
  | 'received'
  | 'processed'
  | 'failed'
  | 'invalid_signature'
  | 'ignored';

@Entity('webhook_event_log')
@Index('idx_wel_received', ['receivedAt'])
@Index('idx_wel_provider_external', ['provider', 'externalEventId'])
@Index('idx_wel_status', ['status'])
export class WebhookEventLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  provider: 'stripe' | 'mercadopago';

  /** Event id del provider (Stripe `evt_...`, MP request id).
   *  UNIQUE (provider, externalEventId) hubiera sido lo ideal pero MP
   *  no garantiza event id estable -> solo index. */
  @Column({ type: 'varchar', length: 200, name: 'external_event_id', nullable: true })
  externalEventId: string | null;

  /** Tipo del evento: 'payment.succeeded', 'charge.refunded', etc. */
  @Column({ type: 'varchar', length: 100, name: 'event_type', nullable: true })
  eventType: string | null;

  @Column({ type: 'varchar', length: 30 })
  status: WebhookEventLogStatus;

  /** Razon del status (e.g. "session not found", "invalid signature"). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  /** Body del webhook sanitizado para forensia. Max 50KB (truncamos). */
  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  /** ID de PaymentSession matcheada (si aplica). */
  @Column({ type: 'uuid', name: 'payment_session_id', nullable: true })
  paymentSessionId: string | null;

  /** Tiempo de proceso: para detectar handlers lentos. */
  @Column({ type: 'int', name: 'processing_ms', nullable: true })
  processingMs: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'received_at' })
  receivedAt: Date;
}
